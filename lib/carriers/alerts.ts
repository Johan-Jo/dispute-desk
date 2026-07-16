/**
 * Carrier support notifications + structured observability — plan §6–§8.
 *
 * Contracts (non-negotiable):
 *  - NOTHING in this module ever throws to a caller: a failure to record
 *    or notify is logged as `notification_error` and swallowed — the
 *    evidence-pack build must never break because alerting hiccuped.
 *  - Dedup state lives in `carrier_alert_incidents` via the atomic
 *    `carrier_alert_touch` RPC — serverless workers share no process
 *    memory, so in-memory suppression alone is forbidden.
 *  - Emails carry operational context ONLY. Never: full tracking numbers
 *    (masked to last 4), recipient/customer data, addresses, signatures,
 *    raw carrier payloads, credentials, auth headers, or full tracking
 *    URLs (hostname only).
 *  - Reuses the shared Resend admin-email helper (`sendAdminEmail`),
 *    which swallows its own delivery errors.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { sendAdminEmail } from "@/lib/email/adminEmail";

/** All alertable categories — operational API failures (§6.2) plus the
 *  non-API detection categories (§7). */
export type CarrierAlertCategory =
  | "authentication_error"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "not_found"
  | "ambiguous_match"
  | "invalid_response"
  | "carrier_unavailable"
  | "configuration_missing"
  | "unexpected_error"
  | "notification_error"
  | "unsupported_carrier"
  | "unknown_carrier";

/** Destination for carrier operational notifications. Config value —
 *  correcting it is a one-line env change. */
const CARRIER_ALERT_EMAIL =
  process.env.CARRIER_ALERT_EMAIL ?? "support@disputedesk.app";

/** Suppression windows (seconds). Operational errors re-alert after 6h;
 *  unsupported-carrier alerts are per merchant+carrier and much quieter
 *  (7 days), with 10/100/1000 threshold re-alerts handled by the RPC. */
const SUPPRESS_OPERATIONAL_S = 6 * 60 * 60;
const SUPPRESS_UNSUPPORTED_S = 7 * 24 * 60 * 60;

export function getCarrierAlertEnvironment(): "development" | "preview" | "production" {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return vercelEnv;
  if (vercelEnv === "development") return "development";
  return process.env.APP_ENV === "production" ? "production" : "development";
}

/** Mask a tracking reference to its last 4 characters ("…0574"). */
export function maskTrackingRef(ref: string | null | undefined): string | null {
  const v = (ref ?? "").trim();
  if (!v) return null;
  return `…${v.slice(-4)}`;
}

/** Hostname-only view of a tracking URL (never the path/query). */
export function trackingUrlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return null;
  }
}

/** Structured observability line (§8). Single JSON line under a stable
 *  prefix so log-based metrics can count events. Callers pass only safe
 *  fields — full tracking numbers/customer data must be masked upstream. */
export function logCarrierEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const payload: Record<string, unknown> = { event };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) payload[k] = v;
  }
  console.info(`[carriers] ${JSON.stringify(payload)}`);
}

// ── Incident recording + notification ───────────────────────────────────

interface TouchArgs {
  incidentKey: string;
  environment: string;
  carrier: string | null;
  shopId: string | null;
  category: CarrierAlertCategory;
  correlationId: string;
  suppressSeconds: number;
}

/** Atomic occurrence-record + notify-decision. Returns whether THIS
 *  caller won the notification slot. Failure → false + notification_error
 *  log (never throws). */
async function touchIncident(args: TouchArgs): Promise<boolean> {
  try {
    const sb = getServiceClient();
    const { data, error } = await sb.rpc("carrier_alert_touch", {
      p_incident_key: args.incidentKey,
      p_environment: args.environment,
      p_carrier: args.carrier,
      p_shop_id: args.shopId,
      p_category: args.category,
      p_correlation_id: args.correlationId,
      p_suppress_seconds: args.suppressSeconds,
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (err) {
    logCarrierEvent("notification_error", {
      stage: "touch_incident",
      category: args.category,
      correlationId: args.correlationId,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function emailBlock(rows: Array<[string, string | number | boolean | null | undefined]>): {
  text: string;
  html: string;
} {
  const present = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  const text = present.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html = `<table>${present
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0"><strong>${k}</strong></td><td>${String(
          v,
        )}</td></tr>`,
    )
    .join("")}</table>`;
  return { text, html };
}

/** Operational carrier-API failure notification (§6). The caller has
 *  already classified the error and decided it is email-worthy (§6.5 —
 *  e.g. isolated not_found is log/metric only). Never throws. */
export async function reportCarrierFailure(input: {
  category: Exclude<CarrierAlertCategory, "unsupported_carrier" | "unknown_carrier">;
  carrier: string | null;
  adapterName?: string;
  adapterVersion?: string;
  shopId: string | null;
  orderGid?: string | null;
  disputeId?: string | null;
  fulfillmentId?: string | null;
  correlationId: string;
  httpStatus?: number;
  retryable?: boolean;
  /** Pre-sanitized error message — no secrets, no payload dumps. */
  sanitizedMessage?: string;
  /** FULL tracking reference — masked internally before any output. */
  trackingRef?: string | null;
  adminUrl?: string | null;
}): Promise<void> {
  const environment = getCarrierAlertEnvironment();
  const masked = maskTrackingRef(input.trackingRef);
  const incidentKey = [
    environment,
    input.carrier ?? "unknown",
    input.shopId ?? "-",
    input.fulfillmentId ?? masked ?? "-",
    input.category,
  ].join("|");

  logCarrierEvent("carrier_failure", {
    category: input.category,
    carrier: input.carrier,
    adapter: input.adapterName,
    adapterVersion: input.adapterVersion,
    shopId: input.shopId,
    orderGid: input.orderGid,
    disputeId: input.disputeId,
    fulfillmentId: input.fulfillmentId,
    correlationId: input.correlationId,
    httpStatus: input.httpStatus,
    retryable: input.retryable,
    trackingRef: masked,
    environment,
  });

  const shouldNotify = await touchIncident({
    incidentKey,
    environment,
    carrier: input.carrier,
    shopId: input.shopId,
    category: input.category,
    correlationId: input.correlationId,
    suppressSeconds: SUPPRESS_OPERATIONAL_S,
  });
  if (!shouldNotify) {
    logCarrierEvent("carrier_alert_email_suppressed", {
      category: input.category,
      correlationId: input.correlationId,
    });
    return;
  }

  const { text, html } = emailBlock([
    ["Environment", environment],
    ["Carrier", input.carrier ?? "unknown"],
    ["Adapter", input.adapterName],
    ["Adapter version", input.adapterVersion],
    ["Error category", input.category],
    ["HTTP status", input.httpStatus],
    ["Shop", input.shopId],
    ["Shopify order", input.orderGid],
    ["Dispute", input.disputeId],
    ["Fulfillment", input.fulfillmentId],
    ["Correlation ID", input.correlationId],
    ["Lookup timestamp", new Date().toISOString()],
    ["Retryable", input.retryable],
    ["Error", input.sanitizedMessage],
    ["Tracking ref (masked)", masked],
    ["Admin", input.adminUrl],
  ]);

  try {
    await sendAdminEmail({
      to: CARRIER_ALERT_EMAIL,
      subject: `[DisputeDesk] Carrier ${input.carrier ?? "unknown"} ${input.category} (${environment})`,
      text,
      html,
      logTag: "carrier-alert",
    });
    logCarrierEvent("carrier_alert_email_sent", {
      category: input.category,
      correlationId: input.correlationId,
    });
  } catch (err) {
    // sendAdminEmail swallows its own errors; this is belt-and-braces —
    // a notification failure is logged and NEVER breaks the pack build.
    logCarrierEvent("notification_error", {
      stage: "send_email",
      category: input.category,
      correlationId: input.correlationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Unsupported-carrier notification (§7): a recognizable carrier with no
 *  registered adapter. NOT an API failure — no request was attempted.
 *  Dedup key is per merchant+carrier (not per order). Never throws. */
export async function reportUnsupportedCarrier(input: {
  carrier: string;
  companyRaw?: string | null;
  identifiedFrom: "company" | "url";
  trackingUrl?: string | null;
  shopId: string | null;
  orderGid?: string | null;
  disputeId?: string | null;
  fulfillmentId?: string | null;
  correlationId: string;
  adminUrl?: string | null;
}): Promise<void> {
  const environment = getCarrierAlertEnvironment();
  const incidentKey = [
    environment,
    "unsupported_carrier",
    input.carrier,
    input.shopId ?? "-",
  ].join("|");
  const urlHost = trackingUrlHost(input.trackingUrl);

  logCarrierEvent("unsupported_carrier_detected", {
    carrier: input.carrier,
    identifiedFrom: input.identifiedFrom,
    shopId: input.shopId,
    orderGid: input.orderGid,
    disputeId: input.disputeId,
    fulfillmentId: input.fulfillmentId,
    correlationId: input.correlationId,
    urlHost,
    environment,
  });

  const shouldNotify = await touchIncident({
    incidentKey,
    environment,
    carrier: input.carrier,
    shopId: input.shopId,
    category: "unsupported_carrier",
    correlationId: input.correlationId,
    suppressSeconds: SUPPRESS_UNSUPPORTED_S,
  });
  if (!shouldNotify) {
    logCarrierEvent("unsupported_carrier_email_suppressed", {
      carrier: input.carrier,
      shopId: input.shopId,
      correlationId: input.correlationId,
    });
    return;
  }

  const { text, html } = emailBlock([
    ["Environment", environment],
    ["Detected carrier", input.carrier],
    ["Shopify carrier value", (input.companyRaw ?? "").trim() || null],
    ["Identified from", input.identifiedFrom],
    ["Tracking URL host", urlHost],
    ["Shop", input.shopId],
    ["Shopify order", input.orderGid],
    ["Dispute", input.disputeId],
    ["Fulfillment", input.fulfillmentId],
    ["Correlation ID", input.correlationId],
    ["Detected at", new Date().toISOString()],
    ["Admin", input.adminUrl],
    [
      "Note",
      "No DisputeDesk carrier adapter currently supports this carrier — delivery verification for this shipment relies on Shopify-native / tracking-app data only.",
    ],
  ]);

  try {
    await sendAdminEmail({
      to: CARRIER_ALERT_EMAIL,
      subject: `[DisputeDesk] Unsupported carrier detected: ${input.carrier}`,
      text,
      html,
      logTag: "carrier-unsupported",
    });
    logCarrierEvent("unsupported_carrier_email_sent", {
      carrier: input.carrier,
      shopId: input.shopId,
      correlationId: input.correlationId,
    });
  } catch (err) {
    logCarrierEvent("unsupported_carrier_email_failed", {
      carrier: input.carrier,
      correlationId: input.correlationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
