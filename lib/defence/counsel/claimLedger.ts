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
import { isCeItem3Citable, resolveCardNetwork } from "../../argument/avsCodeMap";
import type { AddressExhibit } from "../types";
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
    // Never the carrier's brand in prose (maintainer): the card prints it.
    statement: `The carrier recorded the shipment as delivered on ${deliveredOn}.`,
    specifics: { deliveredOn, deliveredOnShort: deliveredOn.replace(/ \d{4}$/, "") },
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
  // With a later order before the dispute, its two intervals (delivery →
  // later order → dispute) tell the story; a third, delivery → dispute,
  // only invites arithmetic (judge, #352543). The claim stays; its interval goes.
  if (later && opened && Date.parse(later.createdAt) < Date.parse(opened)) {
    const c = claims.find((x) => x.id === "dispute_after_delivery");
    if (c) {
      c.statement = `The dispute was opened on ${longDate(opened)}, after the carrier recorded delivery.`;
      c.specifics = { disputeOpenedOn: longDate(opened)! };
    }
  }
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
    // Shopify gives brand, last four digits and wallet, not a card identity:
    // say exactly that ("the same card" would overstate it).
    if (sameCard) {
      specifics.paidWith = later.wallet
        ? `a card ending in the same four digits, through the same ${walletName(later.wallet)} wallet`
        : "a card ending in the same four digits";
    }
    // The later order's delivery date is shown only when it arrived within the
    // merchant's delivery period: a long order-to-delivery span reads worse
    // than it helps (maintainer, 2026-09-25, #363341: 16 days on a
    // "ships within 1-3 business days" store).
    const laterDelivered =
      later.deliveredAt &&
      calendarDays(later.createdAt, later.deliveredAt) <=
        deliveryPeriodDays(sections, orderCreatedAt, shippedAt, deliveredAt)
        ? later.deliveredAt
        : null;
    if (laterDelivered) specifics.laterOrderDeliveredOn = longDate(laterDelivered)!;
    if (later.carrier && later.carrier === carrier) specifics.laterOrderCarrier = "the same carrier";
    add({
      id: "later_order",
      laterOrderExhibit: {
        name: later.name,
        placedAt: later.createdAt,
        total: later.total ?? null,
        cardLast4: later.cardLast4,
        wallet: later.wallet ? walletName(later.wallet) : null,
        deliveredAt: laterDelivered,
      },
      timelineEvent: {
        at: later.createdAt,
        text:
          `The same customer placed order ${later.name}${later.total ? ` for ${later.total}` : ""}` +
          `${later.cardLast4 ? `, paid with a card ending in ${later.cardLast4}${later.wallet ? ` via ${walletName(later.wallet)}` : ""}` : ""}.`,
      },
      statement:
        `After the carrier recorded delivery of the disputed order, the same customer account placed a further order (${later.name}) on ${specifics.laterOrderOn}` +
        `${specifics.daysBeforeDispute ? `, ${specifics.daysBeforeDisputeWord} days before opening this dispute` : ""}` +
        `${sameCard ? `, paid with ${specifics.paidWith}` : ""}` +
        `${laterDelivered ? `; ${specifics.laterOrderCarrier ?? "the carrier"} recorded that order as delivered on ${specifics.laterOrderDeliveredOn}` : ""}.`,
      specifics,
      weight: "core",
      sources: ["shopify.customer.orders"],
      mustNot: [
        "State the facts and let the analyst draw the inference. Never say this proves the disputed order was received.",
        "Never comment on the cardholder's honesty or motive.",
        "Never say the later order was not disputed.",
        "Never print card digits.",
        "Never say \"the same card\": say a card ending in the same four digits.",
      ],
    });
  }

  for (const c of addressClaims(orderData, sections)) add(c);

  return claims;
}

/**
 * Address claims (maintainer, 2026-09-25: "we need to have the address as
 * part of the model"). Made only when the shipping and billing addresses on
 * the order are identical, and always with both printed as an exhibit — an
 * address claim is never made without the addresses shown. When they differ
 * nothing is said and nothing is printed: a mismatch is not volunteered.
 *
 * What these claims do NOT say: that the parcel was delivered to that address.
 * The carrier record carries no delivery location, and `address_delivery`
 * (claimCapabilities.ts) stays ungranted.
 */
const ADDRESS_FIELDS = ["address1", "address2", "city", "provinceCode", "zip", "countryCode"] as const;

function addressClaims(orderData: Obj, sections: LedgerInput["packSections"]): LedgerClaim[] {
  const sa = obj(orderData.shippingAddressFull);
  const ba = obj(orderData.billingAddressFull);
  if (!sa || !ba) return [];
  // Street, city, postal code and country must be on both; "Unit 5" vs no
  // unit is a difference, so the comparison is on every field.
  if (!(["address1", "city", "zip", "countryCode"] as const).every((f) => str(sa[f]) && str(ba[f]))) return [];
  const norm = (x: unknown) => (str(x) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ADDRESS_FIELDS.every((f) => norm(sa[f]) === norm(ba[f]))) return [];

  const lines = (a: Obj) =>
    [
      str(a.address1),
      str(a.address2),
      [str(a.city), [str(a.provinceCode), str(a.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      str(a.country) ?? str(a.countryCode),
    ].filter((l): l is string => !!l);

  // The issuer's own address check, cited only on a primary-sourced cell
  // (Visa Y / M today — avsCodeMap.ts).
  const pay = sections
    .map((s) => obj(s?.data))
    .find((d) => !!d && typeof d.avsResultCode === "string");
  const network = pay ? resolveCardNetwork(pay) : "unknown";
  const avsCode = pay ? str(pay.avsResultCode)!.toUpperCase() : null;
  const avs = avsCode && isCeItem3Citable(network, avsCode) ? { code: avsCode, network } : null;

  const exhibit: AddressExhibit = { shipping: lines(sa), billing: lines(ba), avs };
  const NOT_DELIVERY =
    "Never say the parcel was delivered to, reached, arrived at or was received at any address: the carrier's record gives no delivery location.";
  const out: LedgerClaim[] = [
    {
      id: "shipping_matches_billing",
      statement:
        "The shipping address entered at checkout is identical to the billing address. Both are printed side by side in the Shipping section.",
      specifics: {},
      weight: "strong",
      sources: ["pack.order.shippingAddressFull", "pack.order.billingAddressFull"],
      mustNot: [NOT_DELIVERY, "Never write about addresses: the address card states the match and shows both."],
      addressExhibit: exhibit,
    },
  ];
  if (avs) {
    out.push({
      id: "billing_address_verified",
      statement: "When the payment was authorised, the card issuer's address check (AVS) matched the billing address.",
      specifics: {},
      weight: "strong",
      sources: ["pack.payment.avsResultCode"],
      mustNot: [NOT_DELIVERY, "Never write about the address check: the address card shows it."],
    });
  }
  return out;
}

/**
 * The merchant's delivery period in calendar days, from the records:
 *   1. a delivery window the shipping policy states ("delivered within 5-7
 *      business days") — its upper bound;
 *   2. else the dispatch window ("ship within 1-3 business days") plus the
 *      disputed order's own transit time (shipped → carrier delivery);
 *   3. else 10 days.
 * Business days are counted as calendar days from the order date.
 */
export function deliveryPeriodDays(
  sections: LedgerInput["packSections"],
  orderCreatedAt: string | null,
  shippedAt: string | null,
  deliveredAt: string,
): number {
  const text =
    ((obj(sections.find((s) => s?.type === "shipping_policy")?.data)?.policies as unknown[]) ?? [])
      .map((p) => str(obj(p)?.textPreview))
      .filter(Boolean)
      .join(" ") || "";
  const range = (verb: string) =>
    text.match(new RegExp(`${verb}\\w*\\s+(?:with)?in\\s+(\\d+)\\s*(?:-|–|to)?\\s*(\\d+)?\\s+(business\\s+)?days`, "i"));
  const toCalendar = (n: number, business: boolean) => {
    if (!business || !orderCreatedAt) return n;
    let d = Date.parse(orderCreatedAt);
    let left = n;
    let days = 0;
    while (left > 0) {
      d += 86_400_000;
      days += 1;
      const w = new Date(d).getUTCDay();
      if (w !== 0 && w !== 6) left -= 1;
    }
    return days;
  };
  const upper = (m: RegExpMatchArray) => Number(m[2] ?? m[1]);
  const deliver = range("deliver");
  if (deliver) return toCalendar(upper(deliver), !!deliver[3]);
  const ship = range("ship");
  if (ship && shippedAt) return toCalendar(upper(ship), !!ship[3]) + Math.max(0, calendarDays(shippedAt, deliveredAt));
  return 10;
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
