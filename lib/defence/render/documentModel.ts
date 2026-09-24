/**
 * The "Chargeback Response v2" document model — the derived content both
 * renderers draw: the PDF (`lib/defence/pdf/DefencePackageDocument.tsx`) and
 * the in-app preview (`DefencePackageHtmlView.tsx`). One derivation, two
 * renderers, so the merchant's preview cannot drift from what the bank gets.
 *
 * Bank-document copy (English), not merchant UI copy: the preview shows the
 * document as filed.
 *
 * WORDING (2026-09-24, maintainer). "Fulfilled" is Shopify's term and can mean
 * anything from "label printed" to "handed over"; a bank reader cannot tell
 * which. The document says "shipped" for the merchant's own record and
 * "delivered" ONLY when a carrier recorded the delivery.
 */

import type { EvidenceFact } from "../types";
import { classifyChronologyEvent, type ChronologyEvent } from "../chronology";
import type { LineItem } from "./lineItems";

type Shipment = Record<string, unknown>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** ["Sep 15, 2026", "19:25 UTC"] */
export function dateParts(iso: string | null | undefined): [string, string] | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return [`${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, `${hh}:${mm} UTC`];
}

export function dateTime(iso: string | null | undefined): string | null {
  const p = dateParts(iso);
  return p ? `${p[0]}, ${p[1]}` : null;
}

/** The order's parcels on a multi-parcel letter, in the order the merchant
 *  fulfilled them. Empty for a single-parcel letter. */
export function shipmentsOf(facts: readonly EvidenceFact[]): Shipment[] {
  for (const f of facts) {
    if (f.category !== "delivery_proof" && f.category !== "shipping_tracking") continue;
    const s = (f.value as Record<string, unknown> | null)?.shipments;
    if (Array.isArray(s) && s.length > 1) {
      return [...(s as Shipment[])].sort((a, b) =>
        (str(a.fulfillmentEventAt) ?? "").localeCompare(str(b.fulfillmentEventAt) ?? ""),
      );
    }
  }
  return [];
}

export function productsOf(s: Shipment): string {
  const names = (Array.isArray(s.items) ? (s.items as Array<Record<string, unknown>>) : [])
    .map((it) => {
      const title = str(it.title);
      if (!title) return null;
      return typeof it.quantity === "number" && it.quantity > 1 ? `${it.quantity} × ${title}` : title;
    })
    .filter((t): t is string => t !== null);
  return names.length ? names.join(", ") : "Shipment";
}

export type PillTone = "green" | "blue" | "grey";

export interface ShipmentCardField {
  label: string;
  value: string;
  /** Carrier + reference line: the reference, linked when it is a tracking number. */
  reference?: { text: string; url: string | null };
}

export interface ShipmentCard {
  index: number;
  product: string;
  status: { tone: PillTone; label: string };
  fields: ShipmentCardField[];
}

/** Which app marked the parcel fulfilled — Shopify's timeline line, matched
 *  by the fulfilment's timestamp. */
function fulfilledVia(s: Shipment, events: readonly ChronologyEvent[]): string | null {
  const at = Date.parse(str(s.fulfillmentEventAt) ?? "");
  if (Number.isNaN(at)) return null;
  for (const e of events) {
    const m = e.text.match(/^(.+?) marked \d+ items? as fulfilled/i);
    if (m && Math.abs(Date.parse(e.at) - at) <= 120_000) return m[1].trim();
  }
  return null;
}

/** One card per parcel, each stating only what its own record shows. */
export function shipmentCards(
  shipments: readonly Shipment[],
  events: readonly ChronologyEvent[],
): ShipmentCard[] {
  return shipments.map((s, i) => {
    const carrier = str(s.carrier) ?? "—";
    const ref = str(s.reference);
    const isTracking = s.referenceIsTrackingNumber === true;
    const proof = str(s.proofType);
    const fields: ShipmentCardField[] = [
      {
        label: isTracking ? "Carrier · tracking" : "Carrier · shipping reference",
        value: carrier,
        ...(ref ? { reference: { text: ref, url: isTracking ? str(s.trackingUrl) : null } } : {}),
      },
    ];
    const fulfilled = dateTime(str(s.fulfillmentEventAt) ?? str(s.fulfilledAt));
    if (fulfilled) fields.push({ label: "Shipped by merchant", value: fulfilled });
    const since = dateTime(str(s.inTransitSince));
    const delivered = dateTime(str(s.deliveredAt));
    if (proof === "in_transit" && since) {
      fields.push({ label: "First carrier event", value: `${since} — in transit` });
    } else if ((proof === "delivered_confirmed" || proof === "signature_confirmed") && delivered) {
      fields.push({
        label: "Carrier delivery",
        value: `${delivered} — delivered${proof === "signature_confirmed" ? ", signed" : ""}`,
      });
    } else {
      const via = fulfilledVia(s, events);
      if (via) fields.push({ label: "Marked shipped by", value: via });
    }
    const status: ShipmentCard["status"] =
      proof === "in_transit"
        ? { tone: "blue", label: "In transit" }
        : proof === "delivered_confirmed" || proof === "signature_confirmed"
          ? { tone: "green", label: "Delivered" }
          : { tone: "green", label: "Shipped" };
    return { index: i + 1, product: productsOf(s), status, fields };
  });
}

/** Line-item total, only when every price is one currency amount. */
export function lineItemsTotal(items: readonly LineItem[]): { quantity: number; amount: string } | null {
  const parsed = items.map((it) => it.price.match(/^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/));
  const currency = parsed[0]?.[1];
  if (!currency || !parsed.every((m) => m && m[1] === currency)) return null;
  return {
    quantity: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
    amount: `${currency} ${parsed.reduce((sum, m) => sum + Number(m![2]), 0).toFixed(2)}`,
  };
}

export type ChronologyMarker = "filled" | "hollow" | "green";

/** A short title and a marker for each timeline event: filled for money and
 *  fulfilment, hollow for customer notifications, green for the carrier's
 *  own record. */
export function describeChronologyEvent(
  e: ChronologyEvent,
  shipments: readonly Shipment[],
): { title: string; marker: ChronologyMarker } {
  if (/tracking record shows .* in transit/i.test(e.text)) return { title: "In transit with carrier", marker: "green" };
  if (/records delivery of|carrier confirmed delivery|collected the shipment|delivered the shipment to a pickup point/i.test(e.text)) {
    return { title: "Delivered by carrier", marker: "green" };
  }
  switch (classifyChronologyEvent(e.text)) {
    case "payment":
      return { title: /authori[sz]ed/i.test(e.text) ? "Payment authorized" : "Payment captured", marker: "filled" };
    case "order_placed":
      return { title: "Order placed", marker: "filled" };
    case "fulfillment_shipment": {
      const at = Date.parse(e.at);
      const i = shipments.findIndex((s) => Math.abs(Date.parse(str(s.fulfillmentEventAt) ?? "") - at) <= 120_000);
      return { title: i >= 0 ? `Shipment ${i + 1} shipped` : "Order shipped", marker: "filled" };
    }
    case "shipping_confirmation":
      return { title: "Shipping confirmation sent", marker: "hollow" };
    case "delivery_notification":
      return { title: "Delivery notification sent", marker: "hollow" };
    case "carrier_delivery":
      return /returned/i.test(e.text)
        ? { title: "Returned by carrier", marker: "filled" }
        : { title: "Delivered by carrier", marker: "green" };
    case "chargeback":
      return { title: "Chargeback opened", marker: "filled" };
    default:
      return { title: "Event", marker: "filled" };
  }
}

/** Split prose on the order's product names so a renderer can bold them. */
export function emphasisSegments(text: string, names: readonly string[]): Array<{ text: string; strong: boolean }> {
  const unique = [...new Set(names.filter((n) => n.length >= 4))].sort((a, b) => b.length - a.length);
  if (!unique.length) return [{ text, strong: false }];
  const pattern = new RegExp(`(${unique.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text
    .split(pattern)
    .filter((seg) => seg.length > 0)
    .map((seg) => ({ text: seg, strong: unique.includes(seg) }));
}

/** Case Details status values render as pills; settled states are green. */
export function statusPillTone(value: string): PillTone {
  return ["PAID", "FULFILLED"].includes(value.toUpperCase()) ? "green" : "grey";
}
