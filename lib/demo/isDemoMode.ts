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

function truthy(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function envFlagEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return truthy(process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE);
}

/**
 * Client-side demo-mode check. Reads the current URL's query string in
 * the browser, falls back to the build-time env flag. Safe to call in
 * SSR (returns env-flag-only — no window access).
 */
export function isDemoMode(searchParams?: URLSearchParams | null): boolean {
  if (searchParams && truthy(searchParams.get(DEMO_QUERY_KEY))) return true;

  if (typeof window !== "undefined") {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (truthy(sp.get(DEMO_QUERY_KEY))) return true;
    } catch {
      // ignore
    }
  }

  return envFlagEnabled();
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
