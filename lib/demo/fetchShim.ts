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

  // ── Rules list — empty (no custom rules in demo)
  {
    match: (u) => u.pathname === "/api/rules",
    respond: () => jsonResponse([]),
  },

  // ── Packs library — four templates the merchant could install
  {
    match: (u) => u.pathname === "/api/packs",
    respond: () => jsonResponse({
      packs: [
        { id: "pk-fraud", name: "Fraudulent — verified cardholder", dispute_type: "fraudulent", status: "active", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z" },
        { id: "pk-pnr", name: "Product not received — tracked delivery", dispute_type: "product_not_received", status: "active", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z" },
        { id: "pk-sub", name: "Subscription canceled — policy + history", dispute_type: "subscription_canceled", status: "active", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z" },
        { id: "pk-dup", name: "Duplicate charge — payment reconciliation", dispute_type: "duplicate", status: "draft", locale: "en", version: 1, updated_at: "2026-01-10T10:00:00Z" },
      ],
    }),
  },

  // ── Reason mappings — empty so coverage page doesn't crash
  {
    match: (u) => u.pathname === "/api/reason-mappings",
    respond: () => jsonResponse({ mappings: [] }),
  },

  // ── Setup automation — empty active packs + empty modes
  {
    match: (u) => u.pathname === "/api/setup/automation",
    respond: () => jsonResponse({
      activePacks: [],
      installedTemplateIds: [],
      pack_modes: {},
      packAutomation: true,
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

  // ── Insights initial analysis — minimal shape, enough to render
  {
    match: (u) => u.pathname === "/api/dashboard/insights/initial-analysis",
    respond: () => jsonResponse({
      ordersAnalyzed: 1432,
      historicalImportStatus: "complete",
      deliveryOps: {
        trackingCoverage: 92,
        avgFulfillmentHours: 18,
        signedDeliveryRate: 38,
        deliveryFailureRate: 1.2,
      },
      paymentVerification: {
        avs3dsBoth: 71,
        cvvAvailability: 88,
      },
      fraudRisk: {
        sessionCoverage: 86,
        riskClassifications: { low: 1120, medium: 248, high: 64 },
        chargebacksByRisk: { low: 1, medium: 3, high: 2 },
      },
      operationalCheckpoints: {
        webhooksHealthy: true,
        shopifyProtectActive: true,
        threeDsEnabled: true,
      },
      liabilityShift: {
        coveragePercent: 71,
        recoveredCount: 14,
        recoveredAmount: 4287.5,
        currency: "USD",
      },
      chargebackRate: 0.42,
      chargebackBand: "healthy",
      sparkline: [3, 5, 4, 6, 4, 3, 5, 4, 6, 5, 4, 6],
    }),
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
