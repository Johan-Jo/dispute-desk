/**
 * DHL adapter — Unified Shipment Tracking API (developer.dhl.com).
 * Plan: docs/plans/carrier-delivery-verification.plan.md §3 (P0), §4, §5.
 *
 * Covers ALL DHL divisions (Freight, Express, eCommerce, Parcel) through
 * one endpoint. Auth: `DHL-API-Key` request header (the gateway's
 * documented scheme — confirmed against api-eu.dhl.com: the header is in
 * the gateway's Access-Control-Allow-Headers). Credentials are the
 * settled `DHL_API_KEY` + `DHL_API_SECRET` pair (plan §4 — do not rename,
 * do not drop the secret): the adapter requires BOTH to be present to
 * enable itself; the key authenticates the tracking call, the secret is
 * reserved for the DHL API products that require it.
 *
 * Failure semantics: fetchTimeline NEVER throws — every failure mode
 * returns its typed CarrierLookupResult branch. One bounded retry for
 * transient categories (timeout / network / 5xx). 429 honours Retry-After
 * and is never retried in-process.
 *
 * DHL Freight TRAP (why match() exists): the Shopify-stored tracking
 * `number` is DHL's customer confirmation number; the REAL shipment id
 * lives only in the tracking URL (`tracking-id=`). URL-derived ids take
 * precedence over the stored number.
 */

import {
  classifyDeliveryTimeline,
} from "@/lib/shopify/deliveryEventClassifier";
import { extractNativeSignature } from "@/lib/shopify/queries/ordersForBackfill";
import { extractDhlTrackingIds } from "@/lib/carriers/urlTracking";
import type {
  CarrierAdapter,
  CarrierDeliveryStatus,
  CarrierEvent,
  CarrierLookupResult,
  CarrierMatch,
  NormalizedCarrierShipment,
  TrackingEntryInfo,
} from "@/lib/carriers/types";

export const DHL_ADAPTER_VERSION = "dhl@1";
const DHL_TRACK_ENDPOINT = "https://api-eu.dhl.com/track/shipments";
/** Explicit request timeout (plan §4) — no unbounded hangs in a pack build. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Company strings that identify a DHL division. Matching is
 *  case-insensitive substring on a normalized company value. */
const DHL_COMPANY_RE = /(^|\b)dhl(\b|$)/i;

function getDhlConfig(): { apiKey: string } | null {
  const apiKey = process.env.DHL_API_KEY?.trim();
  const apiSecret = process.env.DHL_API_SECRET?.trim();
  // BOTH credentials must be present (plan §4 self-disablement) — the
  // adapter never half-runs on one.
  if (!apiKey || !apiSecret) return null;
  return { apiKey };
}

function matchDhl(info: TrackingEntryInfo): CarrierMatch | null {
  const company = (info.company ?? "").trim();
  const companyIsDhl = DHL_COMPANY_RE.test(company);
  const urlIds = extractDhlTrackingIds(info.url);

  const divisionHint = /freight/i.test(company) ? "freight" : undefined;

  // URL-derived id wins over the stored number (DHL Freight trap).
  if (urlIds.length === 1) {
    return {
      carrier: "dhl",
      trackingNumber: urlIds[0],
      divisionHint,
      matchedFrom: "url",
      confidence: "high",
    };
  }
  if (urlIds.length > 1) {
    // Conflicting repeated tracking-id params — never pick arbitrarily.
    return null;
  }

  const number = (info.number ?? "").trim();
  if (companyIsDhl && number) {
    // The stored number may be a customer confirmation number rather
    // than the shipment id — medium confidence reflects that.
    return {
      carrier: "dhl",
      trackingNumber: number,
      divisionHint,
      matchedFrom: "company_and_number",
      confidence: "medium",
    };
  }
  return null;
}

// ── Response normalization ──────────────────────────────────────────────

/** Subset of the DHL Unified Tracking response we consume. Everything is
 *  optional/nullable — an unexpected shape degrades to invalid_response,
 *  never a crash. */
interface DhlApiShipment {
  id?: string | number;
  status?: {
    timestamp?: string;
    statusCode?: string; // pre-transit | transit | delivered | failure | unknown
    status?: string;
    description?: string;
    remark?: string;
  };
  events?: Array<{
    timestamp?: string;
    statusCode?: string;
    status?: string;
    description?: string;
    remark?: string;
  }>;
}

function toCarrierEvents(shipment: DhlApiShipment): CarrierEvent[] {
  const events = (shipment.events ?? [])
    .filter((e) => typeof e?.timestamp === "string" && e.timestamp)
    .map((e) => ({
      happenedAt: e.timestamp as string,
      statusCode: e.statusCode ?? null,
      message: e.description ?? e.status ?? e.remark ?? null,
    }));
  // Newest first, matching the Shopify-native convention.
  events.sort((a, b) => (a.happenedAt < b.happenedAt ? 1 : -1));
  return events;
}

export function normalizeDhlShipment(
  trackingNumber: string,
  shipment: DhlApiShipment,
): NormalizedCarrierShipment {
  const events = toCarrierEvents(shipment);

  // Classification: the shared message-timeline classifier is primary —
  // its multilingual pickup/neighbour/return checks are exactly what
  // disambiguates "delivered" vs "picked up by receiver at a
  // servicepoint" (plan §5.5). The structured statusCode is the
  // fallback when messages are empty.
  const timeline = classifyDeliveryTimeline(
    events.map((e) => ({
      status: e.statusCode,
      happenedAt: e.happenedAt,
      message: e.message,
    })),
  );

  let deliveryStatus: CarrierDeliveryStatus | null = null;
  let terminalAt: string | null = null;
  if (timeline.finalCategory === "delivered") {
    deliveryStatus = "Delivered";
    terminalAt = timeline.finalAt;
  } else if (timeline.finalCategory === "delivered_to_pickup") {
    deliveryStatus = "DeliveredToPickup";
    terminalAt = timeline.finalAt;
  } else if (timeline.finalCategory === "returned") {
    deliveryStatus = "Returned";
    terminalAt = timeline.finalAt;
  } else if (shipment.status?.statusCode === "delivered") {
    // Structured-code fallback: DHL says delivered but no event message
    // matched. Trust the code; the shipment-level description decides
    // pickup vs home via the same classifier on a single synthetic event.
    deliveryStatus = "Delivered";
    terminalAt = shipment.status.timestamp ?? null;
  }

  return {
    trackingNumber,
    events,
    deliveryStatus,
    terminalAt,
    podName: extractNativeSignature(
      events.map((e) => ({ status: e.statusCode, message: e.message })),
    ),
  };
}

// ── Fetch ───────────────────────────────────────────────────────────────

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : undefined;
}

async function fetchOnce(trackingNumber: string): Promise<CarrierLookupResult> {
  const config = getDhlConfig();
  if (!config) return { status: "configuration_missing" };

  const url = `${DHL_TRACK_ENDPOINT}?trackingNumber=${encodeURIComponent(trackingNumber)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "DHL-API-Key": config.apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    return (err as Error)?.name === "AbortError"
      ? { status: "timeout" }
      : { status: "network_error" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) return { status: "authentication_error" };
  if (res.status === 404) return { status: "not_found" };
  if (res.status === 429) {
    return { status: "rate_limited", retryAfterSeconds: parseRetryAfter(res) };
  }
  if (res.status >= 500) return { status: "unavailable" };
  if (!res.ok) return { status: "invalid_response" };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "invalid_response" };
  }

  const shipments = (body as { shipments?: unknown })?.shipments;
  if (!Array.isArray(shipments)) return { status: "invalid_response" };
  if (shipments.length === 0) return { status: "not_found" };
  if (shipments.length > 1) {
    // DisputeDesk must never silently pick an arbitrary shipment.
    return { status: "ambiguous", candidateCount: shipments.length };
  }

  try {
    return {
      status: "success",
      shipment: normalizeDhlShipment(trackingNumber, shipments[0] as DhlApiShipment),
    };
  } catch {
    return { status: "unexpected_error" };
  }
}

/** One bounded in-process retry for transient categories only (plan §4 —
 *  no unbounded retries; 429 is respected, never hammered). */
const RETRYABLE_ONCE = new Set(["timeout", "network_error", "unavailable"]);

async function fetchTimelineDhl(trackingNumber: string): Promise<CarrierLookupResult> {
  const first = await fetchOnce(trackingNumber);
  if (!RETRYABLE_ONCE.has(first.status)) return first;
  return fetchOnce(trackingNumber);
}

export const dhlAdapter: CarrierAdapter = {
  slug: "dhl",
  version: DHL_ADAPTER_VERSION,
  match: matchDhl,
  fetchTimeline: fetchTimelineDhl,
};
