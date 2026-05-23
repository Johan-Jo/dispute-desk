/**
 * Client-side fetch interceptor for demo mode.
 *
 * Installed on mount by `<DemoModeProvider>` when demo mode is active.
 * Every supported read endpoint returns a healthy-merchant fixture from
 * `lib/demo/demoData.ts`; every supported mutation returns a simulated
 * success response and dispatches a `dd:demo-mutation` CustomEvent so a
 * toast can surface the no-op.
 *
 * Unrecognized URLs fall through to the real `fetch` — this lets next-intl,
 * static assets, telemetry, and other infrastructure keep working in demo
 * mode without us having to enumerate them.
 */

import {
  DEMO_DISPUTE_ID,
  getDemoAutomation,
  getDemoBillingUsage,
  getDemoDashboardStats,
  getDemoDisputes,
  getDemoInsights,
  getDemoOperationalInsightsStrip,
  getDemoRules,
  getDemoSetupState,
  getDemoWorkspace,
} from "@/lib/demo/demoData";

type Json = unknown;

export const DEMO_MUTATION_EVENT = "dd:demo-mutation";

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dispatchMutation(label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(DEMO_MUTATION_EVENT, { detail: { label } }),
    );
  } catch {
    // ignore
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function pathnameAndSearch(rawUrl: string): { pathname: string; search: URLSearchParams } {
  try {
    const u = new URL(rawUrl, typeof window === "undefined" ? "http://demo.local" : window.location.origin);
    return { pathname: u.pathname, search: u.searchParams };
  } catch {
    const [p, q] = rawUrl.split("?", 2);
    return { pathname: p, search: new URLSearchParams(q ?? "") };
  }
}

interface RouteOutcome {
  response: Response;
  /** Truthy when this was a simulated mutation — caller dispatches the toast event. */
  mutationLabel?: string;
}

/**
 * Decide whether a given request should be served from demo data.
 * Returns null when the interceptor doesn't recognize the URL — caller
 * falls through to real fetch.
 */
function routeDemo(method: string, pathname: string, search: URLSearchParams): RouteOutcome | null {
  /* ── Read endpoints ─────────────────────────────────────────────── */

  if (method === "GET" && pathname === "/api/setup/state") {
    return { response: jsonResponse(getDemoSetupState()) };
  }

  if (method === "GET" && pathname === "/api/dashboard/stats") {
    const period = (search.get("period") as Parameters<typeof getDemoDashboardStats>[0]) ?? "30d";
    return { response: jsonResponse(getDemoDashboardStats(period)) };
  }

  if (method === "GET" && pathname === "/api/dashboard/insights/initial-analysis") {
    return { response: jsonResponse(getDemoInsights()) };
  }

  if (method === "GET" && pathname === "/api/dashboard/insights/strip") {
    return { response: jsonResponse(getDemoOperationalInsightsStrip()) };
  }

  if (method === "GET" && pathname === "/api/disputes") {
    return { response: jsonResponse(getDemoDisputes()) };
  }

  if (method === "GET" && /^\/api\/disputes\/[^/]+\/workspace$/.test(pathname)) {
    const idMatch = pathname.match(/^\/api\/disputes\/([^/]+)\/workspace$/);
    const id = idMatch ? idMatch[1] : DEMO_DISPUTE_ID;
    return { response: jsonResponse(getDemoWorkspace(id)) };
  }

  if (method === "GET" && pathname === "/api/setup/automation") {
    return { response: jsonResponse(getDemoAutomation()) };
  }

  if (method === "GET" && pathname === "/api/rules") {
    return { response: jsonResponse(getDemoRules()) };
  }

  if (method === "GET" && pathname === "/api/billing/usage") {
    return { response: jsonResponse(getDemoBillingUsage()) };
  }

  /* ── Mutation endpoints (simulate success + toast) ──────────────── */

  const mutation = (label: string, body: Json = { ok: true, demo: true, simulated: true }) =>
    ({ response: jsonResponse(body), mutationLabel: label } as RouteOutcome);

  if (method === "POST" && pathname === "/api/setup/automation") {
    return mutation("Automation settings");
  }

  if ((method === "POST" || method === "PATCH" || method === "DELETE") && pathname.startsWith("/api/rules")) {
    return mutation("Automation rule");
  }

  if (method === "POST" && /^\/api\/disputes\/[^/]+\/packs$/.test(pathname)) {
    return mutation("Build defence package", {
      ok: true,
      demo: true,
      pack: { id: "demo-pack-7f8247d3", status: "ready" },
    });
  }

  if (method === "POST" && /^\/api\/disputes\/[^/]+\/sync$/.test(pathname)) {
    return mutation("Resync from Shopify");
  }

  if (
    (method === "POST" || method === "PATCH") &&
    /^\/api\/packs\/[^/]+\/(save-to-shopify|regenerate|upload|waive|render-pdf|cardholder-acknowledgement)/.test(pathname)
  ) {
    const action = pathname.split("/").slice(4).join("/");
    const label =
      action.startsWith("save-to-shopify")
        ? "Save evidence to Shopify"
        : action.startsWith("regenerate")
          ? "Regenerate defence package"
          : action.startsWith("upload")
            ? "Upload evidence"
            : action.startsWith("waive")
              ? "Waive evidence item"
              : action.startsWith("render-pdf")
                ? "Render PDF"
                : "Cardholder acknowledgement";
    return mutation(label);
  }

  if (
    (method === "POST" || method === "PATCH") &&
    pathname.startsWith("/api/onboarding")
  ) {
    return mutation("Onboarding step");
  }

  return null;
}

let installed = false;
let originalFetch: typeof fetch | null = null;

/**
 * Install the demo-mode fetch interceptor on the global `window.fetch`.
 * Idempotent — safe to call multiple times. Returns the uninstall function.
 */
export function installDemoFetchInterceptor(): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed) return () => {};

  originalFetch = window.fetch.bind(window);
  installed = true;

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = urlOf(input);
      const method = methodOf(input, init);
      const { pathname, search } = pathnameAndSearch(url);

      const outcome = routeDemo(method, pathname, search);
      if (outcome) {
        if (outcome.mutationLabel) {
          dispatchMutation(outcome.mutationLabel);
        }
        return outcome.response;
      }
    } catch {
      // Fall through to real fetch on any interceptor error — never
      // break the embedded app because of demo wiring.
    }

    return originalFetch!(input, init);
  }) as typeof fetch;

  return () => {
    if (originalFetch) {
      window.fetch = originalFetch;
    }
    installed = false;
  };
}
