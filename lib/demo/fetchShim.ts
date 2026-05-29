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
    respond: () => jsonResponse({
      disputes: DEMO_DISPUTES.map((d) => ({
        id: d.id,
        dispute_gid: `gid://shopify/DisputeEvidence/${d.id}`,
        order_gid: `gid://shopify/Order/${d.orderName.replace("#", "")}`,
        order_name: d.orderName,
        customer_display_name: d.customerName,
        amount: d.amount,
        currency_code: d.currency,
        reason: d.reasonFamily,
        phase: "chargeback",
        status: d.status,
        normalized_status: d.status,
        submission_state: d.status === "submitted" ? "submitted" : "not_submitted",
        due_at: d.dueAt,
        opened_at: d.openedAt,
        submitted_at: null,
        closed_at: null,
        final_outcome: null,
        outcome_amount_recovered: null,
        outcome_amount_lost: null,
        last_event_at: d.timeline[d.timeline.length - 1]?.at ?? d.openedAt,
      })),
      pagination: { page: 1, per_page: 25, total: DEMO_DISPUTES.length, total_pages: 1 },
    }),
  },

  // ── Dispute detail — supports any of the 6 fixture IDs
  {
    match: (u) => /^\/api\/disputes\/dp-\d+$/.test(u.pathname),
    respond: (u) => {
      const id = u.pathname.split("/").pop()!;
      const d = DEMO_DISPUTES.find((x) => x.id === id);
      if (!d) return jsonResponse({ error: "not found" }, 404);
      return jsonResponse(d);
    },
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
