/**
 * ParcelPanel delivery-state source.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §7, §8, §9.
 *
 * ── Contract: THREE outcomes, never two ──────────────────────────────
 *
 *   signal            — a terminal state was elected
 *   no_terminal_state — we looked, the parcel is still moving (a FACT)
 *   unavailable       — we could not find out (an ABSENCE OF KNOWLEDGE)
 *
 * Conflating the last two is the original bug wearing a different hat. A
 * failed lookup must never read as "no return"; callers treat `unavailable`
 * as a reason to stop, not as evidence.
 *
 * ── Why 403 can never be a fact ──────────────────────────────────────
 *
 * Probed 2026-09-16: a NONEXISTENT tracking number returns **403**, and so
 * does a throttled request for a number that succeeded seconds earlier. The
 * status code cannot distinguish "no such parcel" from "slow down". So every
 * 403 is `unavailable`. This single observation is why the outcome union has
 * three members.
 *
 * ── Pacing: MEASURED, not guessed ────────────────────────────────────
 *
 * An earlier draft proposed "≥1s between calls" on no evidence. Characterised
 * against the live endpoint on 2026-09-16:
 *
 *   12 requests, no pacing  → 403 partway through
 *   12 requests @ 2s        → 12/12 OK
 *   40 requests @ 2s        → throttled at request 29
 *   40 requests @ 4s        → 40/40 OK
 *
 * So 4s is the measured sustainable rate and 2s is not. `MIN_REQUEST_INTERVAL_MS`
 * is 5s — a margin below the measured boundary, because the budget's shape
 * (window, quota, per-IP vs per-shop) is still unknown and the cost of being
 * wrong is a throttle that reads as `unavailable` and parks a pack.
 *
 * The limiter is per shop domain and process-local. It does not survive a
 * serverless cold start, so a burst across concurrent lambdas can still
 * throttle — which fails closed, by design.
 *
 * ── Endpoint provenance ──────────────────────────────────────────────
 *
 * Undocumented. Found by reading the minified bundle the merchant's tracking
 * page loads (`pp-proxy.parcelwill.com/js/app.*.js`), which calls
 * `v2/tracking-info` through the Shopify app proxy on the shop's own domain.
 * It is gated on Origin/Referer; the direct `pp-proxy.parcelwill.com/api/`
 * host returns 403 regardless. It can change without notice — hence the
 * shape validation below, and the canary the plan calls for.
 *
 * Every probe used one shop (`6a8848-dd` / `meinmaison.de`). Whether the path
 * and params generalise to other ParcelPanel merchants is UNVERIFIED — we have
 * no second ParcelPanel shop. Treat shop configuration as discovered, and fail
 * to `unavailable` rather than assuming.
 */

import { electSignal, type ParcelPanelCheckpoint } from "./parcelPanelMap";
import type { CarrierDeliveryStatus } from "@/lib/carriers/types";

export type TrackingAppUnavailableReason =
  | "http_403"
  | "http_5xx"
  | "http_other"
  | "timeout"
  | "network"
  | "shape_mismatch";

export type TrackingAppResult =
  | {
      outcome: "signal";
      status: CarrierDeliveryStatus;
      /** `date_carbon` of the electing checkpoint, verbatim (naive local). */
      at: string;
      source: "tracking_app_parcelpanel";
    }
  | { outcome: "no_terminal_state"; source: "tracking_app_parcelpanel" }
  | {
      outcome: "unavailable";
      reason: TrackingAppUnavailableReason;
      source: "tracking_app_parcelpanel";
    };

const SOURCE = "tracking_app_parcelpanel" as const;

/** See the pacing note in the module header. Below the measured 4s boundary,
 *  with margin, because the budget's shape is unknown. */
export const MIN_REQUEST_INTERVAL_MS = 5_000;

const REQUEST_TIMEOUT_MS = 20_000;

/** Last request time per shop domain. Process-local by design — see header. */
const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialise per shop domain at the measured rate. */
async function pace(shopDomain: string): Promise<void> {
  const prev = lastRequestAt.get(shopDomain);
  const now = Date.now();
  if (prev !== undefined) {
    const wait = prev + MIN_REQUEST_INTERVAL_MS - now;
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(shopDomain, Date.now());
}

/** Test seam — reset the limiter between cases. */
export function resetPacingForTest(): void {
  lastRequestAt.clear();
}

export interface FetchParcelPanelInput {
  /** The storefront domain the app proxy is mounted on — the merchant's
   *  CUSTOM domain (e.g. `meinmaison.de`), not `*.myshopify.com`. */
  shopDomain: string;
  trackingNumber: string;
  /** ISO-3166-1 alpha-2, forwarded as the page would. Optional. */
  country?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Validate the envelope before trusting anything inside it. A changed or
 * replaced endpoint must degrade to `unavailable`, never to a confident
 * wrong answer.
 */
function readCheckpoints(body: unknown): ParcelPanelCheckpoint[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { code?: unknown; data?: unknown };
  if (b.code !== 200) return null;
  const data = b.data;
  if (!data || typeof data !== "object") return null;
  const tracking = (data as { tracking?: unknown }).tracking;
  if (!Array.isArray(tracking) || tracking.length === 0) return null;
  const first = tracking[0];
  if (!first || typeof first !== "object") return null;
  const info = (first as { trackinfo?: unknown }).trackinfo;
  // An empty timeline is a valid shape — the parcel simply has no events.
  if (!Array.isArray(info)) return null;
  return info as ParcelPanelCheckpoint[];
}

export async function fetchParcelPanelState(
  input: FetchParcelPanelInput,
): Promise<TrackingAppResult> {
  const { shopDomain, trackingNumber } = input;
  const doFetch = input.fetchImpl ?? fetch;

  const qs = new URLSearchParams({
    track_number: trackingNumber,
    order: "",
    email: "",
    shop: shopDomain,
    lang: "en",
    country: input.country ?? "",
  });
  const url = `https://${shopDomain}/apps/parcelpanel/api/v2/tracking-info?${qs.toString()}`;

  await pace(shopDomain);

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "GET",
      headers: {
        // The proxy gates on a browser-shaped request with same-origin
        // Referer/Origin. Without these it answers 403 for every number.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: `https://${shopDomain}/apps/parcelpanel?nums=${encodeURIComponent(trackingNumber)}`,
        Origin: `https://${shopDomain}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { outcome: "unavailable", reason: timedOut ? "timeout" : "network", source: SOURCE };
  }

  if (res.status === 403) {
    // Throttle OR unknown parcel — indistinguishable. Never a fact.
    return { outcome: "unavailable", reason: "http_403", source: SOURCE };
  }
  if (res.status >= 500) {
    return { outcome: "unavailable", reason: "http_5xx", source: SOURCE };
  }
  if (!res.ok) {
    return { outcome: "unavailable", reason: "http_other", source: SOURCE };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { outcome: "unavailable", reason: "shape_mismatch", source: SOURCE };
  }

  const checkpoints = readCheckpoints(body);
  if (!checkpoints) {
    return { outcome: "unavailable", reason: "shape_mismatch", source: SOURCE };
  }

  const elected = electSignal(checkpoints);
  if (elected.conflict) {
    // Two mapped events at one timestamp that contradict each other. We know
    // the lookup worked but not what it means — that is absence of knowledge,
    // not a parcel in transit.
    return { outcome: "unavailable", reason: "shape_mismatch", source: SOURCE };
  }
  if (!elected.status || !elected.at) {
    return { outcome: "no_terminal_state", source: SOURCE };
  }
  return { outcome: "signal", status: elected.status, at: elected.at, source: SOURCE };
}
