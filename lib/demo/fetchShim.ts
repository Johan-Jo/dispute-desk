/**
 * Client-side fetch interceptor for the public demo route group.
 *
 * Wraps `window.fetch` and routes `/api/*` requests to fixture responses
 * when the current pathname is under `/demo`. Everything else passes
 * through to the real fetch so static assets, _next chunks, and tests
 * continue to work.
 *
 * IMPORTANT — this is the only bridge between the real embedded React
 * components (which fetch live data) and our fixture data. Every API
 * endpoint that any mirrored demo page hits MUST have a handler here,
 * or the page will show its loading spinner forever.
 *
 * Installed exactly once via `useFetchShim()` in the demo layout.
 */

import { DEMO_DISPUTES } from "./fixtures/disputes";
import { DEMO_DASHBOARD_STATS_REAL, DEMO_RECENT_ACTIVITY_REAL } from "./fixtures/realDashboardStats";
import { buildWorkspaceData } from "./fixtures/workspaceData";
import { buildDemoPresentation } from "./fixtures/presentation";

const ORIGINAL_FETCH = typeof window !== "undefined" ? window.fetch.bind(window) : null;

/** Build a Response from JSON data. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Handler {
  /** Returns true if this handler claims the request. */
  match: (url: URL, init?: RequestInit) => boolean;
  /** Returns the canned response. */
  respond: (url: URL, init?: RequestInit) => Response | Promise<Response>;
}

const HANDLERS: Handler[] = [
  // ── Setup state — used by Dashboard to decide whether to redirect to /app/setup
  {
    match: (u) => u.pathname === "/api/setup/state",
    respond: () => jsonResponse({ allDone: true, shopId: "demo" }),
  },

  // ── Dashboard stats — the headline data for the dashboard
  {
    match: (u) => u.pathname === "/api/dashboard/stats",
    respond: () => jsonResponse(DEMO_DASHBOARD_STATS_REAL),
  },

  // ── Shop preferences — used by disputes list for the "alerts nudge" banner
  {
    match: (u) => u.pathname === "/api/shop/preferences",
    respond: () => jsonResponse({ teamEmail: "ops@your-store.com", notifications: {} }),
  },

  // ── Feedback eligibility — EmbeddedAppChrome calls this; we always return ineligible
  {
    match: (u) => u.pathname === "/api/feedback/eligibility",
    respond: () => jsonResponse({ eligible: false }),
  },

  // ── Disputes list
  {
    match: (u) => u.pathname === "/api/disputes",
    respond: () => {
      // Anchor dates relative to NOW so urgency badges look right
      // regardless of when the demo is viewed. Fixture stores days-from-
      // anchor offsets; rebase each dispute against today.
      const now = Date.now();
      const FIXTURE_ANCHOR = new Date("2026-01-15T10:00:00Z").getTime();
      const rebase = (iso: string) => new Date(now + (new Date(iso).getTime() - FIXTURE_ANCHOR)).toISOString();

      // Strength snapshot per fixture dispute. Map our `strength` field
      // to the `caseStrength` shape the embedded list expects (drives
      // the pill + "N strong signals" subtitle in DesktopDisputesTable).
      const strengthFor = (d: typeof DEMO_DISPUTES[number]) => {
        if (d.strength === "strong") {
          const strongCount = d.evidence.filter((e) => e.group === "strong").length;
          const moderateCount = d.evidence.filter((e) => e.group === "moderate").length;
          return { overall: "strong" as const, strongCount, moderateCount, supportingCount: d.evidence.length };
        }
        if (d.strength === "moderate") {
          return { overall: "moderate" as const, strongCount: 0, moderateCount: d.evidence.filter((e) => e.group !== "supplemental").length, supportingCount: d.evidence.length };
        }
        if (d.strength === "weak") {
          return { overall: "weak" as const, strongCount: 0, moderateCount: 0, supportingCount: d.evidence.length };
        }
        // covered + fatal_loss render no strength pill — match prod where
        // the underlying pack was never built.
        return null;
      };

      return jsonResponse({
        disputes: DEMO_DISPUTES.map((d) => {
          // Map fixture-local statuses to real normalizedStatuses keys
          // (see messages/en.json normalizedStatuses). `covered` and
          // `blocked` aren't real normalized statuses — they're demo
          // flags that drive banner rendering — so emit `needs_review`
          // and `action_needed` respectively to keep the i18n lookup
          // sane.
          const normalizedStatus =
            d.status === "covered" ? "needs_review" :
            d.status === "blocked" ? "action_needed" :
            d.status;
          return {
            id: d.id,
            dispute_gid: `gid://shopify/DisputeEvidence/${d.id}`,
            order_gid: `gid://shopify/Order/${d.orderName.replace("#", "")}`,
            order_name: d.orderName,
            customer_display_name: d.customerName,
            amount: d.amount,
            currency_code: d.currency,
            // i18n keys under `disputeReasons.*` use the Shopify uppercase
            // reason codes (FRAUDULENT, PRODUCT_NOT_RECEIVED, etc) — see
            // messages/en.json. Fixture stores them lower-cased for code
            // ergonomics; upper-case at the shim boundary so the embedded
            // translateReason() lookup hits a real key.
            reason: d.reasonFamily.toUpperCase(),
            phase: "chargeback",
            status: normalizedStatus,
            normalized_status: normalizedStatus,
            submission_state: d.status === "submitted" ? "submitted" : "not_submitted",
            due_at: rebase(d.dueAt),
            initiated_at: rebase(d.openedAt),
            opened_at: rebase(d.openedAt),
            needs_review: d.status === "needs_review",
            last_synced_at: new Date(now).toISOString(),
            submitted_at: null,
            closed_at: null,
            final_outcome: null,
            outcome_amount_recovered: null,
            outcome_amount_lost: null,
            last_event_at: rebase(d.timeline[d.timeline.length - 1]?.at ?? d.openedAt),
            caseStrength: strengthFor(d),
            // The 4-dimension presentation model (PR#410). Absent, every
            // status cell silently falls back to the legacy normalized-status
            // Badge instead of the designed lifecycle chip — see
            // DashboardRecentDisputesPreview.tsx:161 and lib/demo/fixtures/presentation.ts.
            presentation: buildDemoPresentation(d),
          };
        }),
        pagination: { page: 1, per_page: 25, total: DEMO_DISPUTES.length, total_pages: 1 },
      });
    },
  },

  // ── Dispute detail (legacy demo route) — supports any of the 6 fixture IDs
  {
    match: (u) => /^\/api\/disputes\/dp-\d+$/.test(u.pathname),
    respond: (u) => {
      const id = u.pathname.split("/").pop()!;
      const d = DEMO_DISPUTES.find((x) => x.id === id);
      if (!d) return jsonResponse({ error: "not found" }, 404);
      return jsonResponse(d);
    },
  },

  // ── Dispute workspace — drives the real WorkspaceShell (3-tab Polaris UI)
  // The hook fetches /api/disputes/[id]/workspace?locale=en and feeds the
  // response through useDisputeWorkspace. See lib/demo/fixtures/workspaceData.ts.
  {
    match: (u) => /^\/api\/disputes\/dp-\d+\/workspace$/.test(u.pathname),
    respond: (u) => {
      const id = u.pathname.split("/").slice(-2, -1)[0];
      const data = buildWorkspaceData(id);
      if (!data) return jsonResponse({ error: "Dispute not found" }, 404);
      return jsonResponse(data);
    },
  },

  // ── Pack-level no-op endpoints (regenerate / save / waive / etc).
  // Real workspace hook POSTs to many /api/packs/[id]/* endpoints. None of
  // them need to do anything in demo — return ok so the UI's optimistic
  // updates land cleanly.
  {
    match: (u) => /^\/api\/packs\/[^/]+\//.test(u.pathname),
    respond: () => jsonResponse({ ok: true }),
  },

  // ── Defence package endpoints (regenerate / finalize / submit / preview)
  {
    match: (u) => /^\/api\/defence-packages\/[^/]+\//.test(u.pathname),
    respond: () => jsonResponse({ ok: true }),
  },

  // ── Dispute-scoped packs endpoint (used by workspace hook to enqueue rebuild)
  {
    match: (u) => /^\/api\/disputes\/dp-\d+\/packs$/.test(u.pathname),
    respond: () => jsonResponse({ ok: true, packId: "pack-demo" }),
  },

  // ── Dispute-scoped sync trigger (per-dispute, distinct from /api/disputes/sync)
  {
    match: (u) => /^\/api\/disputes\/dp-\d+\/sync$/.test(u.pathname),
    respond: () => jsonResponse({ ok: true }),
  },

  // ── Recent activity feed (used by some dashboard widgets)
  {
    match: (u) => u.pathname === "/api/dashboard/activity",
    respond: () => jsonResponse({ activity: DEMO_RECENT_ACTIVITY_REAL }),
  },

  // ── Sync trigger — pretend it succeeded
  {
    match: (u) => u.pathname === "/api/disputes/sync",
    respond: () => jsonResponse({ ok: true, synced: 0 }),
  },

  // ── Rules list — one rule per dispute family covering both phases,
  //    so the Coverage page renders all 7 families as fully configured.
  //    Rule shape per RuleInput in lib/coverage/deriveLifecycleCoverage.ts.
  {
    match: (u) => u.pathname === "/api/rules",
    respond: () => jsonResponse([
      { id: "rule-fraud", enabled: true, priority: 1, match: { reason: ["FRAUDULENT", "UNRECOGNIZED"], phase: ["inquiry", "chargeback"] }, action: { mode: "automated", pack_template_id: "tpl-fraud" } },
      { id: "rule-pnr", enabled: true, priority: 2, match: { reason: ["PRODUCT_NOT_RECEIVED"], phase: ["inquiry", "chargeback"] }, action: { mode: "automated", pack_template_id: "tpl-pnr" } },
      { id: "rule-nad", enabled: true, priority: 3, match: { reason: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"], phase: ["inquiry", "chargeback"] }, action: { mode: "review_first", pack_template_id: "tpl-nad" } },
      { id: "rule-sub", enabled: true, priority: 4, match: { reason: ["SUBSCRIPTION_CANCELLED"], phase: ["inquiry", "chargeback"] }, action: { mode: "automated", pack_template_id: "tpl-sub" } },
      { id: "rule-refund", enabled: true, priority: 5, match: { reason: ["CREDIT_NOT_PROCESSED"], phase: ["inquiry", "chargeback"] }, action: { mode: "review_first", pack_template_id: "tpl-refund" } },
      { id: "rule-dup", enabled: true, priority: 6, match: { reason: ["DUPLICATE"], phase: ["inquiry", "chargeback"] }, action: { mode: "automated", pack_template_id: "tpl-dup" } },
      { id: "rule-general", enabled: true, priority: 7, match: { reason: ["GENERAL"], phase: ["inquiry", "chargeback"] }, action: { mode: "review_first", pack_template_id: "tpl-general" } },
    ]),
  },

  // ── Packs library — ACTIVE packs per family. dispute_type uses
  //    canonical Shopify reason codes (matched in deriveLifecycleCoverage's
  //    packMatchesFamily). status must be uppercase ACTIVE — the coverage
  //    page filters on p.status === "ACTIVE".
  {
    match: (u) => u.pathname === "/api/packs",
    respond: () => jsonResponse({
      packs: [
        { id: "pk-fraud", name: "Fraudulent — verified cardholder", dispute_type: "FRAUDULENT", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-fraud" },
        { id: "pk-pnr", name: "Product not received — tracked delivery", dispute_type: "PRODUCT_NOT_RECEIVED", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-pnr" },
        { id: "pk-nad", name: "Product not as described — listing snapshot", dispute_type: "PRODUCT_UNACCEPTABLE", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-nad" },
        { id: "pk-sub", name: "Subscription canceled — policy + history", dispute_type: "SUBSCRIPTION_CANCELLED", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-sub" },
        { id: "pk-refund", name: "Credit not processed — refund timeline", dispute_type: "CREDIT_NOT_PROCESSED", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-refund" },
        { id: "pk-dup", name: "Duplicate charge — payment reconciliation", dispute_type: "DUPLICATE", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-dup" },
        { id: "pk-general", name: "General — best-effort evidence pack", dispute_type: "GENERAL", status: "ACTIVE", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z", template_id: "tpl-general" },
      ],
    }),
  },

  // ── Reason mappings — one per family per phase. template_id must be
  //    non-null so deriveLifecycleCoverage treats the phase as configured.
  {
    match: (u) => u.pathname === "/api/reason-mappings",
    respond: () => {
      const families: Array<[string, string]> = [
        ["FRAUDULENT", "tpl-fraud"],
        ["UNRECOGNIZED", "tpl-fraud"],
        ["PRODUCT_NOT_RECEIVED", "tpl-pnr"],
        ["PRODUCT_UNACCEPTABLE", "tpl-nad"],
        ["SUBSCRIPTION_CANCELLED", "tpl-sub"],
        ["CREDIT_NOT_PROCESSED", "tpl-refund"],
        ["DUPLICATE", "tpl-dup"],
        ["GENERAL", "tpl-general"],
      ];
      const phases: Array<"inquiry" | "chargeback"> = ["inquiry", "chargeback"];
      const mappings = families.flatMap(([reason, templateId]) =>
        phases.map((phase) => ({
          reason_code: reason,
          dispute_phase: phase,
          template_id: templateId,
          template_name: reason.replace(/_/g, " ").toLowerCase(),
          family: reason.toLowerCase(),
          is_active: true,
        })),
      );
      return jsonResponse({ mappings });
    },
  },

  // ── Setup automation — read-only templates/packs. `pack_modes` and
  //    `packAutomation` were dropped when per-pack rules were removed;
  //    the store-wide mode now lives at /api/automation/store below.
  {
    match: (u) => u.pathname === "/api/setup/automation",
    respond: () => jsonResponse({
      activePacks: [],
      installedTemplateIds: [],
      rulesAccess: { allowed: true, reason: null },
    }),
  },

  // ── Store-wide automation switch. Without this entry the fetch falls
  //    through, `saveMode` stays null, and NEITHER radio renders selected
  //    on the demo Settings page (same for /app/rules).
  {
    match: (u) => u.pathname === "/api/automation/store",
    respond: () => jsonResponse({
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      rulesAccess: { allowed: true, reason: null },
    }),
  },

  // ── Templates library — empty so the install modal opens cleanly
  {
    match: (u) => u.pathname === "/api/templates",
    respond: () => jsonResponse({ templates: [] }),
  },

  // ── Automation settings — demo defaults (auto-build on, review mode)
  {
    match: (u) => u.pathname === "/api/automation/settings",
    respond: () => jsonResponse({
      shop_id: "demo",
      auto_build_enabled: true,
      auto_save_enabled: false,
      auto_save_min_score: 80,
      enforce_no_blockers: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-15T10:00:00Z",
    }),
  },

  // ── Billing usage — Growth plan, 34/100 packs used
  {
    match: (u) => u.pathname === "/api/billing/usage",
    respond: () => jsonResponse({
      plan: {
        id: "growth",
        name: "Growth",
        price: 129,
        packsPerMonth: 100,
        autoPack: true,
        rules: true,
      },
      usage: { packsUsed: 34, packsLimit: 100, packsRemaining: 66 },
      topups: [],
      trialEligible: false,
      shop_domain: "demo-store.myshopify.com",
    }),
  },

  // ── Insights initial analysis — full InsightsResponse shape per
  //    app/(embedded)/app/insights/initial-analysis/page.tsx:54
  {
    match: (u) => u.pathname === "/api/dashboard/insights/initial-analysis",
    respond: () => {
      const periodWindow = {
        ordersTotal: 482,
        acceptanceRatePct: 91.4,
        highRiskPct: 4.2,
        fulfilledHighRiskPct: 1.1,
        fraudDisputeRatePct: 0.4,
        shopifyProtectCoveragePct: 71,
        chargebackRatePct: 0.42,
        chargebackOrders: 2,
        threeDsAuthRatePct: 88,
        threeDsAuthOrders: 425,
        threeDsAuthEligibleOrders: 482,
        medianFulfillmentHours: 18,
        fulfilledOrdersCount: 478,
        confirmedDeliveryRatePct: 92,
        confirmedDeliveryOrders: 439,
        fulfilledForDeliveryCount: 478,
        signedForRatePct: 38,
        signedForOrders: 182,
      };
      return jsonResponse({
        available: true,
        ordersAnalyzed: 1432,
        windowStart90d: "2025-10-17T00:00:00Z",
        highRiskPct: 4.2,
        fulfilledHighRiskPct: 1.1,
        acceptanceRatePct: 91.4,
        fraudDisputeRatePct: 0.4,
        shopifyProtectCoveragePct: 71,
        chargebackRate90d: 0.42,
        chargebackHealth: "good",
        chargebackHealthAvailable: true,
        chargebackOrders90d: 6,
        chargebackCount90d: 1,
        windowStart30d: "2025-12-17T00:00:00Z",
        windowStart30dPrior: "2025-11-17T00:00:00Z",
        current30d: periodWindow,
        prior30d: { ...periodWindow, ordersTotal: 401, chargebackRatePct: 0.75, chargebackOrders: 3 },
        chargebackRateSparklineWeekly: [
          { weekStart: "2025-11-03", rate: 0.6, orderCount: 38 },
          { weekStart: "2025-11-10", rate: 0.5, orderCount: 42 },
          { weekStart: "2025-11-17", rate: 0.8, orderCount: 46 },
          { weekStart: "2025-11-24", rate: 0.7, orderCount: 44 },
          { weekStart: "2025-12-01", rate: 0.5, orderCount: 51 },
          { weekStart: "2025-12-08", rate: 0.4, orderCount: 48 },
          { weekStart: "2025-12-15", rate: 0.3, orderCount: 39 },
          { weekStart: "2025-12-22", rate: 0.4, orderCount: 36 },
          { weekStart: "2025-12-29", rate: 0.5, orderCount: 42 },
          { weekStart: "2026-01-05", rate: 0.4, orderCount: 47 },
          { weekStart: "2026-01-12", rate: 0.3, orderCount: 44 },
        ],
        riskBreakdown: { low: 1120, medium: 184, high: 64, none: 48, pending: 16 },
        riskToDisputeConversion: {
          high: { orders: 64, disputes: 2, conversionPct: 3.1 },
          medium: { orders: 184, disputes: 3, conversionPct: 1.6 },
          low: { orders: 1120, disputes: 1, conversionPct: 0.09 },
          none: { orders: 48, disputes: 0, conversionPct: 0 },
          pending: { orders: 16, disputes: 0, conversionPct: 0 },
        },
        historicalImportStatus: "complete",
        historicalImportOrdersTotal: 1432,
        historicalImportSinceDate: "2025-10-17T00:00:00Z",
        historicalImportScopeGranted: "read_all_orders",
        historicalImportCompletedAt: "2026-01-15T08:30:00Z",
        // Hide the "Unlock your full order history" upsell banner —
        // demo store is on read_all_orders so the banner self-hides
        // (see DashboardScopeUpgradeBanner.tsx:77).
        currentScopeGrant: "read_all_orders",
        dismissedBanners: {},
        recommendation: null,
      });
    },
  },

  // ── Feedback submit — pretend success
  {
    match: (u) => u.pathname === "/api/feedback",
    respond: () => jsonResponse({ ok: true }),
  },
];

/**
 * Install the fetch shim. Safe to call multiple times — idempotent.
 *
 * Installation timing matters: React child effects run BEFORE parent
 * effects, so installing from a layout `useEffect` is too late — the
 * dashboard's data-fetch effects fire first. Either (a) call this at
 * module top level from a client component imported by the layout (so
 * it runs during first script eval, before any effects), or (b) call
 * from a render-phase side effect (not idiomatic but works).
 *
 * The shim only intercepts requests when `window.location.pathname`
 * starts with `/demo`, so leaving it installed across SPA navigations
 * to non-demo routes is harmless.
 */
export function installFetchShim(): () => void {
  if (typeof window === "undefined" || !ORIGINAL_FETCH) return () => {};
  // Idempotent — if already installed, do nothing
  if ((window as unknown as { __ddDemoFetchInstalled?: boolean }).__ddDemoFetchInstalled) {
    return () => {};
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Resolve relative URLs against the current origin
    const url = new URL(urlString, window.location.origin);

    // Only intercept /api/* requests when on a /demo page
    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/") &&
      window.location.pathname.startsWith("/demo")
    ) {
      for (const handler of HANDLERS) {
        if (handler.match(url, init)) {
          return handler.respond(url, init);
        }
      }
      // Unmatched /api/* on demo: return empty so loading spinners resolve
      // instead of hanging. Helpful while iterating — flips visible failures
      // (broken UI) into invisible ones (empty data) intentionally so the
      // demo never breaks while a fixture is incomplete.
      console.warn(`[demo fetch shim] no handler for ${url.pathname} — returning {}`);
      return jsonResponse({});
    }

    return ORIGINAL_FETCH(input, init);
  };

  (window as unknown as { __ddDemoFetchInstalled?: boolean }).__ddDemoFetchInstalled = true;

  return () => {
    if (ORIGINAL_FETCH) window.fetch = ORIGINAL_FETCH;
    delete (window as unknown as { __ddDemoFetchInstalled?: boolean }).__ddDemoFetchInstalled;
  };
}
