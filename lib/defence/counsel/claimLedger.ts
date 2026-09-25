/**
 * The claim ledger for item-not-received letters (plan 3 §3).
 *
 * Every claim is built by code from a record, and only when its condition is
 * met. The writer may choose, order, combine and draw inferences from these
 * claims; it may not add one. Values the writer may use appear in `specifics`
 * and are the only dates and numbers the letter may print (checks.ts).
 *
 * Scope: a single parcel with a carrier-confirmed delivery. Anything else
 * (multi-parcel, no carrier delivery) returns null and the letter falls back
 * to the record-built template (shipmentRecordSections.ts).
 */

import { classifyChronologyEvent } from "../chronology";
import { fulfilmentCoverage } from "../fulfilmentCoverage";
import type { CustomerOrderSummary, LedgerClaim, LedgerInput } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 75 → "seventy-five" (0–99; larger numbers stay digits). */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return WORDS[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${WORDS[n % 10]}` : t;
}

/** "6 July 2026" (UTC). */
export function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whole calendar days between two instants, by UTC date. */
export function calendarDays(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((db - da) / 86_400_000);
}

/** Business days (Mon–Fri) from the day after `fromIso` up to and including `toIso`. */
function businessDays(fromIso: string, toIso: string): number {
  const start = new Date(fromIso);
  let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endD = new Date(toIso);
  const end = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate());
  let n = 0;
  while (d < end) {
    d += 86_400_000;
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const NO_DESTINATION = "Never say where the parcel was delivered, to whom, or that any person received it.";

export function buildItemNotReceivedLedger(input: LedgerInput): LedgerClaim[] | null {
  const delivery = input.facts.filter((f) => f.category === "delivery_proof" || f.category === "shipping_tracking");
  // Multi-parcel letters are out of scope for v2 (falls back to the template).
  if (delivery.some((f) => Array.isArray(obj(f.value)?.shipments) && ((obj(f.value)!.shipments as unknown[]).length > 1))) {
    return null;
  }
  const fact = delivery.find((f) => {
    const v = obj(f.value) ?? {};
    return (
      (v.proofType === "delivered_confirmed" || v.proofType === "signature_confirmed") &&
      str(v.carrier) && str(v.trackingNumber) && longDate(str(v.deliveredAt))
    );
  });
  if (!fact) return null;
  const v = obj(fact.value)!;
  const carrier = str(v.carrier)!;
  const tracking = str(v.trackingNumber)!;
  const deliveredAt = str(v.deliveredAt)!;
  const factIds = delivery.map((f) => f.id);

  const sections = input.packSections;
  const orderData = obj(sections.find((s) => s?.type === "order" && obj(s.data)?.orderName)?.data) ?? {};
  const shipping = obj(sections.find((s) => s?.type === "shipping")?.data) ?? {};
  const timeline = ((obj(sections.find((s) => s?.type === "access_log")?.data)?.timelineEvents as unknown[]) ?? [])
    .map(obj)
    .filter((e): e is Obj => !!e && typeof e.createdAt === "string" && typeof e.message === "string")
    .map((e) => ({ at: e.createdAt as string, text: e.message as string }));
  const orderCreatedAt = str(orderData.createdAt);
  const orderEmail = str(orderData.email)?.toLowerCase() ?? null;

  const fulfilment = ((shipping.fulfillments as unknown[]) ?? [])
    .map(obj)
    .find((f) => Array.isArray(f?.tracking) && (f!.tracking as unknown[]).some((t) => obj(t)?.number === tracking));
  const shippedAt = str(fulfilment?.createdAt);

  const claims: LedgerClaim[] = [];
  const add = (c: LedgerClaim) => claims.push(c);

  add({
    id: "claim_is_non_receipt",
    statement: "The cardholder claims the order was not received (Visa 13.1 / Mastercard 4855).",
    specifics: {},
    weight: "core",
    sources: ["dispute.reason"],
    mustNot: [],
  });

  const deliveredOn = longDate(deliveredAt)!;
  add({
    id: "carrier_delivered",
    statement: `${carrier} recorded the shipment as delivered on ${deliveredOn}.`,
    specifics: { carrier, deliveredOn, deliveredOnShort: deliveredOn.replace(/ \d{4}$/, "") },
    weight: "core",
    sources: factIds,
    mustNot: [NO_DESTINATION],
  });

  if (v.proofType === "signature_confirmed") {
    add({
      id: "signed_for",
      statement: "The carrier recorded a signature on delivery.",
      specifics: {},
      weight: "core",
      sources: factIds,
      mustNot: ["Never print the signer's name; never say the cardholder signed."],
    });
  }

  if (str(v.trackingUrl)) {
    add({
      id: "carrier_is_third_party",
      statement:
        "The delivery record is the carrier's own record on its public tracking page (linked in the letter). It is not a merchant document.",
      specifics: {},
      weight: "core",
      sources: factIds,
      mustNot: ["Do not print the tracking number or the URL; the letter prints them."],
    });
  }

  const coverage = fulfilmentCoverage(sections, tracking, timeline);
  const verified = coverage?.kind === "verified";
  if (verified) {
    const n = coverage.itemCount;
    add({
      id: "whole_order_in_shipment",
      statement: `All ${numberWord(n)} purchased items, each in the quantity ordered, were in that one tracked shipment (verified item by item against the order's line items). There was no other shipment.`,
      specifics: { itemCount: String(n), itemCountWord: numberWord(n) },
      weight: "core",
      sources: ["pack.order.lineItems", "pack.shipping.fulfillments.items"],
      mustNot: [],
    });
    const totals = obj(obj(orderData.totals)?.presentment);
    const total = Number(totals?.total);
    if (
      Number.isFinite(total) &&
      typeof input.disputeAmount === "number" &&
      Math.round(total * 100) === Math.round(input.disputeAmount * 100) &&
      (!input.disputeCurrency || totals?.currency === input.disputeCurrency)
    ) {
      add({
        id: "full_amount_covered",
        statement: "That one delivered shipment accounts for the full disputed amount.",
        specifics: {},
        weight: "strong",
        sources: ["pack.order.totals.presentment", "dispute.amount"],
        mustNot: ["Do not restate any amount; the table and header show them."],
      });
    }
  }

  if (shippedAt && orderCreatedAt) {
    const d = calendarDays(orderCreatedAt, shippedAt);
    const interval = d === 0 ? "the same day" : `${numberWord(d)} day${d === 1 ? "" : "s"} after the order`;
    add({
      id: "shipped_promptly",
      statement: `The merchant shipped the order ${d === 0 ? "the same day it was placed and paid for" : `${interval}`}.`,
      specifics: {
        shipInterval: interval,
        orderPlacedOn: longDate(orderCreatedAt)!.replace(/ \d{4}$/, ""),
        shippedOn: longDate(shippedAt)!.replace(/ \d{4}$/, ""),
        ...(d > 0 ? { shipDays: String(d) } : {}),
      },
      weight: "strong",
      sources: ["pack.order.createdAt", "pack.shipping.fulfillments.createdAt"],
      mustNot: ["Shipping is the merchant's own record; it is not delivery."],
    });

    const policy = ((obj(sections.find((s) => s?.type === "shipping_policy")?.data)?.policies as unknown[]) ?? [])
      .map(obj)
      .find((p) => str(p?.textPreview));
    const m = str(policy?.textPreview)?.match(/ship\w*\s+within\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s+business\s+days/i);
    if (m && businessDays(orderCreatedAt, shippedAt) <= Number(m[2])) {
      add({
        id: "within_shipping_policy",
        statement: `The order shipped within the merchant's published shipping policy (dispatch within ${m[1]}–${m[2]} business days).`,
        specifics: { policyWindow: `${numberWord(Number(m[1]))} to ${numberWord(Number(m[2]))} business days` },
        weight: "supporting",
        sources: ["pack.shipping_policy"],
        mustNot: [],
      });
    }

    const transit = calendarDays(shippedAt, deliveredAt);
    if (transit >= 0) {
      add({
        id: "transit_days",
        statement: `The carrier recorded delivery ${numberWord(transit)} day${transit === 1 ? "" : "s"} after the merchant shipped the order.`,
        specifics: { transitDays: String(transit), transitDaysWord: numberWord(transit) },
        weight: "supporting",
        sources: ["pack.shipping.fulfillments.createdAt", ...factIds],
        mustNot: [],
      });
    }
  }

  const emailTo = (text: string) => text.match(/\(([^()\s]+@[^()\s]+)\)/)?.[1]?.toLowerCase() ?? null;
  const notice = timeline.find((e) => classifyChronologyEvent(e.text) === "delivery_notification");
  if (notice && calendarDays(deliveredAt, notice.at) === 0 && orderEmail && emailTo(notice.text) === orderEmail) {
    add({
      id: "delivery_notice_same_day",
      statement: "On the day the carrier recorded delivery, a delivery notification was sent to the email address on the order.",
      specifics: {},
      weight: "strong",
      sources: ["pack.access_log.timelineEvents"],
      mustNot: ["Say only that it was sent. Never that the cardholder read it, knew, was informed or was aware."],
    });
  }

  const opened = input.disputeOpenedAt;
  if (opened) {
    const gap = calendarDays(deliveredAt, opened);
    if (Date.parse(deliveredAt) < Date.parse(opened)) {
      add({
        id: "dispute_after_delivery",
        statement: `The dispute was opened on ${longDate(opened)}, ${numberWord(gap)} days after the carrier recorded delivery.`,
        specifics: { daysAfterDelivery: String(gap), daysAfterDeliveryWord: numberWord(gap), disputeOpenedOn: longDate(opened)! },
        weight: "strong",
        sources: ["dispute.initiated_at", ...factIds],
        mustNot: [
          "Never say the claim is late or out of time under network rules.",
          "Never say or imply the cardholder was silent, did not complain or did not contact the merchant.",
          "Never accuse the cardholder of bad faith.",
        ],
      });
    } else {
      add({
        id: "delivered_after_dispute_opened",
        statement: `The carrier recorded delivery on ${deliveredOn}, after the dispute was opened on ${longDate(opened)}.`,
        specifics: { disputeOpenedOn: longDate(opened)! },
        weight: "core",
        sources: ["dispute.initiated_at", ...factIds],
        mustNot: [],
      });
    }
  }

  const later = laterOrder(input.customerOrders, input.orderName, deliveredAt);
  if (later) {
    const disputed = input.customerOrders.find((o) => o.name === input.orderName) ?? null;
    const sameCard =
      !!disputed?.cardLast4 && disputed.cardLast4 === later.cardLast4 && (disputed.wallet ?? null) === (later.wallet ?? null);
    const specifics: Record<string, string> = {
      laterOrderOn: longDate(later.createdAt)!,
      laterOrderOnShort: longDate(later.createdAt)!.replace(/ \d{4}$/, ""),
      laterOrderName: later.name,
      daysAfterDelivery: String(calendarDays(deliveredAt, later.createdAt)),
      daysAfterDeliveryWord: numberWord(calendarDays(deliveredAt, later.createdAt)),
    };
    if (opened && Date.parse(later.createdAt) < Date.parse(opened)) {
      const b = calendarDays(later.createdAt, opened);
      specifics.daysBeforeDispute = String(b);
      specifics.daysBeforeDisputeWord = numberWord(b);
    }
    if (sameCard) specifics.paidWith = later.wallet ? `the same card, through the same ${walletName(later.wallet)} wallet` : "the same card";
    if (later.deliveredAt) specifics.laterOrderDeliveredOn = longDate(later.deliveredAt)!;
    if (later.carrier && later.carrier === carrier) specifics.laterOrderCarrier = "the same carrier";
    add({
      id: "later_order",
      statement:
        `After the carrier recorded delivery of the disputed order, the same customer account placed a further order (${later.name}) on ${specifics.laterOrderOn}` +
        `${specifics.daysBeforeDispute ? `, ${specifics.daysBeforeDisputeWord} days before opening this dispute` : ""}` +
        `${sameCard ? `, paid with ${specifics.paidWith}` : ""}` +
        `${later.deliveredAt ? `; ${specifics.laterOrderCarrier ?? "the carrier"} recorded that order as delivered on ${specifics.laterOrderDeliveredOn}` : ""}.`,
      specifics,
      weight: "core",
      sources: ["shopify.customer.orders"],
      mustNot: [
        "State the facts and let the analyst draw the inference. Never say this proves the disputed order was received.",
        "Never comment on the cardholder's honesty or motive.",
        "Never say the later order was not disputed.",
        "Never print card digits.",
      ],
    });
  }

  return claims;
}

function walletName(w: string): string {
  const k = w.toUpperCase();
  if (k === "APPLE_PAY") return "Apple Pay";
  if (k === "GOOGLE_PAY") return "Google Pay";
  if (k === "SHOPIFY_PAY") return "Shop Pay";
  return w.replace(/_/g, " ").toLowerCase();
}

/** The first paid, uncancelled order placed after the disputed delivery. */
function laterOrder(
  orders: readonly CustomerOrderSummary[],
  disputedName: string | null,
  deliveredAt: string,
): CustomerOrderSummary | null {
  return (
    [...orders]
      .filter(
        (o) =>
          o.name !== disputedName &&
          !o.cancelled &&
          (o.financialStatus ?? "").toUpperCase() === "PAID" &&
          Date.parse(o.createdAt) > Date.parse(deliveredAt),
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null
  );
}
