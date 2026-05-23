/**
 * Demo mode detection.
 *
 * Demo mode shows a healthy, scripted merchant for App Store screenshots
 * and product videos. It NEVER touches real Shopify data, real Supabase
 * data, or the real automation pipeline.
 *
 * Activation:
 *   1. `?demo=true` query param on any embedded route, or
 *   2. `NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE=true` env at build time
 *      (intended for staging only — never set in production).
 *
 * Detection is intentionally lenient ("true", "1", "yes" all activate)
 * so docs and shareable links don't trip over casing.
 */
import type { NextRequest } from "next/server";

export const DEMO_SHOP_ID = "demo";
export const DEMO_QUERY_KEY = "demo";
const DEMO_SESSION_KEY = "dd_demo_mode";

function truthy(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function offSentinel(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === "off" || s === "false" || s === "0" || s === "no";
}

function envFlagEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return truthy(process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE);
}

function readSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSession(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) window.sessionStorage.setItem(DEMO_SESSION_KEY, "1");
    else window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    // ignore — sessionStorage may be blocked by browser settings
  }
}

/**
 * Client-side demo-mode check. Reads the current URL's query string in
 * the browser, falls back to sessionStorage (sticky across in-app
 * navigation that drops query params — Shopify Admin's `<s-app-nav>`
 * sidebar rewrites the iframe URL without carrying our `demo` flag),
 * then to the build-time env flag.
 *
 * Side effect: when `?demo=true` is present we persist to sessionStorage
 * so subsequent calls (after the sidebar nav strips the query) still
 * return true. When `?demo=off` is present we clear it — an explicit
 * exit. Safe to call in SSR (returns env-flag-only — no window access).
 */
export function isDemoMode(searchParams?: URLSearchParams | null): boolean {
  // 1. Explicit OFF wins over everything else (so an operator can exit
  //    cleanly without clearing storage by hand).
  if (searchParams && offSentinel(searchParams.get(DEMO_QUERY_KEY))) {
    writeSession(false);
    return envFlagEnabled();
  }

  // 2. Query param ON — persist for the rest of the session.
  if (searchParams && truthy(searchParams.get(DEMO_QUERY_KEY))) {
    writeSession(true);
    return true;
  }

  // 3. window.location fallback (used in SSR-rendered components that
  //    don't have a useSearchParams hook).
  if (typeof window !== "undefined") {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (offSentinel(sp.get(DEMO_QUERY_KEY))) {
        writeSession(false);
        return envFlagEnabled();
      }
      if (truthy(sp.get(DEMO_QUERY_KEY))) {
        writeSession(true);
        return true;
      }
    } catch {
      // ignore
    }
  }

  // 4. Sticky session.
  if (readSession()) return true;

  // 5. Build-time env flag.
  return envFlagEnabled();
}

/** Clear the sticky demo-mode flag from sessionStorage. */
export function clearDemoMode(): void {
  writeSession(false);
}

/**
 * Server-side demo-mode check. Used in API routes as a defense-in-depth
 * gate against mutations: when `?demo=true` is on the request URL, the
 * route refuses to touch the database and returns a simulated success.
 *
 * Also honors `x-dd-demo: true` so the client-side fetch interceptor can
 * forward a header even if it didn't append the query param.
 */
export function isDemoRequest(req: NextRequest): boolean {
  if (truthy(req.nextUrl.searchParams.get(DEMO_QUERY_KEY))) return true;
  if (truthy(req.headers.get("x-dd-demo"))) return true;
  return envFlagEnabled();
}
