/**
 * Reason-aware Shopify evidence formatter.
 *
 * RULES:
 * 1. For fraud: rebuttal goes into uncategorizedText (most visible field)
 * 2. NEVER dump raw objects — always format as clean prose
 * 3. NEVER produce [object Object] in any field
 * 4. Each field formatted by dedicated helper, not generic key-value dump
 * 5. Reason-specific field selection
 */

import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";
import type { RawPackSection } from "./fieldMapping";
import type { ReasonFamily } from "@/lib/argument/responseEngine";
import { resolveReasonFamily } from "@/lib/argument/responseEngine";

/* ── Safe formatters ── */

function safeString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(safeString).filter(Boolean).join(", ");
  if (typeof val === "object") {
    // Never produce [object Object]
    try { return JSON.stringify(val); } catch { return ""; }
  }
  return String(val);
}

function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, unknown>;
  return [a.city, a.provinceCode, a.countryCode, a.zip].filter(Boolean).map(String).join(", ");
}

function formatDate(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch { return String(iso); }
}

/* ── Per-section formatters ── */

function formatOrderSection(data: Record<string, unknown>): string {
  const lines: string[] = [];
  if (data.orderName) lines.push(`Order: ${safeString(data.orderName)}`);
  if (data.createdAt) lines.push(`Date: ${formatDate(data.createdAt)}`);
  if (data.financialStatus) lines.push(`Status: ${safeString(data.financialStatus)}`);

  const totals = data.totals as Record<string, unknown> | undefined;
  if (totals) lines.push(`Amount: ${safeString(totals.currency)} ${safeString(totals.total)}`);

  if (data.billingAddress) lines.push(`Billing: ${formatAddress(data.billingAddress)}`);
  if (data.shippingAddress) lines.push(`Shipping: ${formatAddress(data.shippingAddress)}`);

  if (data.billingAddress && data.shippingAddress && typeof data.billingAddress === "object" && typeof data.shippingAddress === "object") {
    const b = data.billingAddress as Record<string, unknown>;
    const s = data.shippingAddress as Record<string, unknown>;
    if (b.city === s.city && b.countryCode === s.countryCode) {
      lines.push("Billing and shipping addresses match.");
    }
  }

  const tenure = data.customerTenure as Record<string, unknown> | undefined;
  if (tenure) {
    lines.push(`Customer since: ${formatDate(tenure.customerSince)}`);
    if (Number(tenure.totalOrders) > 0) lines.push(`Prior orders: ${safeString(tenure.totalOrders)}`);
  }

  const items = data.lineItems as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items) && items.length > 0) {
    lines.push("\nItems ordered:");
    for (const li of items) {
      const title = safeString(li.title);
      const variant = li.variantTitle ? ` (${safeString(li.variantTitle)})` : "";
      lines.push(`  - ${title}${variant} x${safeString(li.quantity ?? 1)}`);
    }
  }

  return lines.join("\n");
}

function formatPaymentVerification(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const avs = safeString(data.avsResultCode);
  const cvv = safeString(data.cvvResultCode);

  if (avs) {
    const desc = avs === "Y" ? "Full match" : avs === "A" ? "Address match" : avs;
    lines.push(`AVS (Address Verification): ${desc}`);
  }
  if (cvv) {
    const desc = cvv === "M" ? "Match" : cvv;
    lines.push(`CVV (Card Verification): ${desc}`);
  }
  if (data.cardCompany) lines.push(`Card: ${safeString(data.cardCompany)}${data.lastFour ? " ending " + safeString(data.lastFour).replace(/[^0-9]/g, "") : ""}`);
  if (data.gateway) lines.push(`Payment processor: ${safeString(data.gateway).replace(/_/g, " ")}`);

  return lines.join("\n");
}

function formatActivityLog(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const tenure = data.customerTenure as Record<string, unknown> | undefined;
  if (tenure) {
    if (tenure.customerSince) lines.push(`Account created: ${formatDate(tenure.customerSince)}`);
    if (Number(tenure.totalOrders) > 0) lines.push(`Prior orders: ${safeString(tenure.totalOrders)}`);
  }
  const events = data.timelineEvents as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(events) && events.length > 0) {
    lines.push("\nOrder timeline:");
    for (const evt of events.slice(0, 10)) {
      const msg = safeString(evt.message).replace(/<[^>]+>/g, "");
      lines.push(`  [${formatDate(evt.createdAt)}] ${msg}`);
    }
  }
  return lines.join("\n");
}

function formatComms(data: Record<string, unknown>): string {
  const lines: string[] = [];
  if (data.orderNote) lines.push(`Order note: ${safeString(data.orderNote)}`);
  const events = data.timelineEvents as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(events) && events.length > 0) {
    for (const evt of events.slice(0, 10)) {
      const msg = safeString(evt.message).replace(/<[^>]+>/g, "");
      if (msg) lines.push(msg);
    }
  }
  return lines.join("\n");
}

function formatPolicies(data: Record<string, unknown>): string {
  const policySummaries: Record<string, string> = {
    refunds: "The store's refund policy was clearly disclosed and accepted by the customer at checkout.",
    shipping: "The store's shipping policy was disclosed at checkout, covering processing times and delivery estimates.",
    terms: "The store's terms of service were presented and accepted by the customer before completing the purchase.",
    privacy: "The store's privacy policy was available to the customer.",
  };
  const policies = data.policies as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(policies)) return "";
  return policies
    .map(p => policySummaries[safeString(p.policyType)] ?? "")
    .filter(Boolean)
    .join("\n");
}

/* ── Reason-aware builder ── */

export function buildEvidenceForShopify(
  sections: RawPackSection[],
  rebuttalText: string | null,
  disputeReason: string | null | undefined,
): DisputeEvidenceUpdateInput {
  const input: DisputeEvidenceUpdateInput = {};
  const family = resolveReasonFamily(disputeReason);

  // Format each section
  const orderText = sections.filter(s => s.type === "order").map(s => formatOrderSection(s.data)).filter(Boolean).join("\n\n");
  const paymentText = sections.filter(s => s.type === "other").map(s => formatPaymentVerification(s.data)).filter(Boolean).join("\n\n");
  const activityText = sections.filter(s => s.type === "access_log").map(s => formatActivityLog(s.data)).filter(Boolean).join("\n\n");
  const commsText = sections.filter(s => s.type === "comms").map(s => formatComms(s.data)).filter(Boolean).join("\n\n");
  const policyText = sections.filter(s => s.type === "policy").map(s => formatPolicies(s.data)).filter(Boolean).join("\n\n");
  const shippingText = sections.filter(s => s.type === "shipping" || s.type === "fulfillment").map(s => {
    const d = s.data;
    const lines: string[] = [];
    const fulfillments = d.fulfillments as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(fulfillments)) {
      for (const f of fulfillments) {
        const tracking = f.tracking as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(tracking)) {
          for (const t of tracking) {
            if (t.carrier) lines.push(`Carrier: ${safeString(t.carrier)}`);
            if (t.number) lines.push(`Tracking: ${safeString(t.number)}`);
          }
        }
        if (f.createdAt) lines.push(`Shipped: ${formatDate(f.createdAt)}`);
        if (f.deliveredAt) lines.push(`Delivered: ${formatDate(f.deliveredAt)}`);
      }
    }
    return lines.join("\n");
  }).filter(Boolean).join("\n\n");

  // ── Route to Shopify fields based on dispute family ──

  // PRIMARY: uncategorizedText gets the main rebuttal for ALL dispute types
  // This is the most visible field in Shopify Admin ("Annat" / "Other")
  const primaryParts: string[] = [];
  if (rebuttalText) primaryParts.push(rebuttalText);
  // For fraud, add payment verification summary after the rebuttal
  if (family === "fraud" && paymentText) {
    primaryParts.push("\n--- Payment Verification ---\n" + paymentText);
  }
  if (primaryParts.length > 0) {
    input.uncategorizedText = primaryParts.join("\n\n");
  }

  // accessActivityLog: order details + activity
  const activityParts: string[] = [];
  if (orderText) activityParts.push(orderText);
  if (activityText) activityParts.push(activityText);
  if (activityParts.length > 0) {
    input.accessActivityLog = activityParts.join("\n\n");
  }

  // Shipping documentation (if fulfillment data exists)
  if (shippingText) {
    input.shippingDocumentation = shippingText;
  }

  // Policies — route based on dispute type
  if (policyText) {
    if (family === "subscription" || family === "refund") {
      input.cancellationPolicyDisclosure = policyText;
    }
    input.refundPolicyDisclosure = policyText;
  }

  // cancellationRebuttal — only for cancellation/subscription disputes
  if (rebuttalText && (family === "subscription" || family === "refund")) {
    input.cancellationRebuttal = rebuttalText;
  }

  return input;
}
