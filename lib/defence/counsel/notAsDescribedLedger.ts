/**
 * The claim ledger for not-as-described letters
 * (docs/plans/defence-letter-structure.plan.md §5.2).
 *
 * The analyst's question is "did the merchant deliver what it advertised, and
 * is there any return?". Every claim is built by code from a record; the
 * summary writer may choose and combine them, never add one.
 *
 * Built for Mein Maison #101111 (2026-09-28), whose template letter led with
 * German product specs and dropped shipping, delivery and the dispute's
 * opening. What this ledger never lets a letter say: that the item matched or
 * conformed to its listing, that the listing is what the customer saw at
 * purchase (it is retrieved for the response), what the product is or does,
 * or anything about the customer's state of mind.
 */

import { addLaterOrder, calendarDays, longDate, numberWord } from "./claimLedger";
import { fulfilmentCoverage } from "../fulfilmentCoverage";
import type { InternalNarrativeConstraints } from "../internalConstraints";
import type { LedgerClaim, LedgerInput } from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const NO_DESTINATION = "Never say where the parcel was delivered, to whom, or that any person received it.";
const NO_POSSESSION = "Never say the customer received, kept, has or used the goods.";
const NO_CONFORMITY =
  "Never say the item matched, conformed to or was as described in its listing, and never describe what the product is or does.";

export interface NotAsDescribedExtras {
  /** Stored-message constraints (Gorgias); `returnRequested` withholds the return line. */
  constraints?: Pick<InternalNarrativeConstraints, "returnRequested" | "refundOrCompensationRequested"> | null;
  /** The order's item descriptions in English, from the ORDER record (title +
   *  variant, as bought), translated. Order-time facts, unlike the listing. */
  orderItemsEnglish?: string[];
  /** The store's return window, verified from its refund policy (policyTerms.ts),
   *  with the date Shopify last updated that policy. */
  returnWindow?: { windowDays: number; policyUpdatedAt: string | null } | null;
  /** D9 (maintainer, 2026-09-28): the return route may be argued for card and
   *  PayPal disputes; not for Klarna until its terms are verified. */
  returnRouteAllowed?: boolean;
}

/** The delivered fulfilment, read from the pack's own record. */
function deliveredFulfilment(sections: LedgerInput["packSections"]): { shippedAt: string | null; deliveredAt: string } | null {
  const shipping = obj(sections.find((s) => s?.type === "shipping")?.data) ?? {};
  const rows = ((shipping.fulfillments as unknown[]) ?? []).map(obj).filter((f): f is Obj => !!f);
  const delivered = rows
    .map((f) => ({
      shippedAt: str(f.createdAt),
      deliveredAt: str(f.deliveredAt) ?? str(obj(f.carrierTracking)?.deliveredAtTracking),
      proof: str(f.shipmentProofType),
    }))
    .filter((f) => f.deliveredAt && (f.proof === "delivered_confirmed" || f.proof === "signature_confirmed" || f.proof === null));
  // One delivery the whole order hangs on: the latest, so "after delivery" is
  // true of every parcel.
  const last = delivered.sort((a, b) => Date.parse(b.deliveredAt!) - Date.parse(a.deliveredAt!))[0];
  return last ? { shippedAt: last.shippedAt, deliveredAt: last.deliveredAt! } : null;
}

export function buildNotAsDescribedLedger(input: LedgerInput, extras: NotAsDescribedExtras = {}): LedgerClaim[] | null {
  const sections = input.packSections;
  const orderData = obj(sections.find((s) => s?.type === "order" && obj(s.data)?.orderName)?.data) ?? {};
  const orderCreatedAt = str(orderData.createdAt);
  const deliveryFactIds = input.facts
    .filter((f) => f.category === "delivery_proof" || f.category === "shipping_tracking")
    .map((f) => f.id);

  const claims: LedgerClaim[] = [];
  const add = (c: LedgerClaim) => claims.push(c);

  add({
    id: "claim_is_not_as_described",
    statement: "The claim is that the item was not as described.",
    specifics: {},
    weight: "core",
    sources: ["dispute.reason"],
    mustNot: [NO_CONFORMITY],
  });

  // ── What was sold: the published listing ──
  const listings = ((obj(sections.find((s) => s?.source === "shopify_product")?.data)?.listings as unknown[]) ?? [])
    .map(obj)
    .filter((l): l is Obj => !!l && !!(str(l.title) || str(l.excerpt)));
  if (listings.length > 0) {
    const retrieved = longDate(str(listings[0].fetchedAt));
    const withPhotos = listings.some((l) => Array.isArray(l.imagePaths) && (l.imagePaths as unknown[]).length > 0);
    add({
      id: "listing_published",
      // Neutral: the listing was retrieved for this response, so it is never
      // "the description the item was sold under" (plan §2.2.1).
      statement:
        `The store's listing for the item, with ${withPhotos ? "photographs and " : ""}a written description, is reproduced in the letter ` +
        `as retrieved from the store${retrieved ? ` on ${retrieved}` : ""}, with an English translation.`,
      specifics: retrieved ? { listingRetrievedOn: retrieved } : {},
      weight: "core",
      sources: ["product_listing_snapshots"],
      mustNot: [
        NO_CONFORMITY,
        "Never say the listing is what the customer saw at purchase or at checkout: it was retrieved for this response.",
        "Never use the product's store name or quote the listing; call it \"the item\".",
      ],
    });
  }

  // ── What was ordered, from the order record (order-time, English) ──
  const items = (extras.orderItemsEnglish ?? []).filter(Boolean);
  if (items.length > 0) {
    const numbers = [...new Set(items.join(" ").match(/\d+(?:[.,]\d+)?/g) ?? [])].join(" ");
    add({
      id: "order_specified",
      statement: `The order was for ${items.length === 1 ? "one item" : `${numberWord(items.length)} items`}, described on the order as: ${items.join("; ")}.`,
      specifics: { orderedAs: items.join("; "), ...(numbers ? { itemNumbers: numbers } : {}) },
      weight: "strong",
      sources: ["pack.order.lineItems"],
      mustNot: [
        "Describe the item only in these words, in English; never features taken from the listing.",
        "Never say the item delivered matched or conformed to this description.",
      ],
    });
  }

  // ── What was shipped: the fulfilment record, item by item ──
  {
    const shipping = obj(sections.find((s) => s?.type === "shipping")?.data) ?? {};
    const tracking = ((shipping.fulfillments as unknown[]) ?? [])
      .map(obj)
      .flatMap((x) => ((x?.tracking as unknown[]) ?? []).map(obj))
      .map((t) => str(t?.number))
      .find(Boolean);
    const coverage = tracking ? fulfilmentCoverage(sections as never, tracking) : null;
    if (coverage?.kind === "verified") {
      add({
        id: "shipped_as_ordered",
        statement: "The fulfilment record shows every item on the order, in the variant and quantity ordered, in the one tracked shipment.",
        specifics: {},
        weight: "strong",
        sources: ["pack.order.lineItems", "pack.shipping.fulfillments.items"],
        mustNot: ["This is the merchant's fulfilment record of what was packed, not an inspection of the goods; never say the goods were checked, inspected or free of defects."],
      });
    }
  }

  // ── The sequence: shipped, delivered, dispute opened ──
  const f = deliveredFulfilment(sections);
  const opened = input.disputeOpenedAt;
  if (f) {
    const deliveredOn = longDate(f.deliveredAt)!;
    if (f.shippedAt && orderCreatedAt) {
      const d = calendarDays(orderCreatedAt, f.shippedAt);
      add({
        id: "shipped",
        statement: `The merchant shipped the order ${d === 0 ? "the day it was placed" : `${numberWord(d)} day${d === 1 ? "" : "s"} after it was placed`}.`,
        specifics: {
          orderPlacedOn: longDate(orderCreatedAt)!.replace(/ \d{4}$/, ""),
          shippedOn: longDate(f.shippedAt)!.replace(/ \d{4}$/, ""),
        },
        weight: "supporting",
        sources: ["pack.order.createdAt", "pack.shipping.fulfillments.createdAt"],
        mustNot: ["Shipping is the merchant's own record; it is not delivery."],
      });
    }
    add({
      id: "carrier_delivered",
      statement: `The carrier recorded delivery of the order on ${deliveredOn}.`,
      specifics: { deliveredOn, deliveredOnShort: deliveredOn.replace(/ \d{4}$/, "") },
      weight: "strong",
      sources: deliveryFactIds.length ? deliveryFactIds : ["pack.shipping.fulfillments.deliveredAt"],
      mustNot: [NO_DESTINATION, NO_POSSESSION, "Never argue that the item arrived as if non-receipt were claimed; delivery dates the sequence."],
    });
    if (opened && Date.parse(f.deliveredAt) < Date.parse(opened)) {
      const gap = calendarDays(f.deliveredAt, opened);
      add({
        id: "dispute_after_delivery",
        statement: `The dispute was opened on ${longDate(opened)}, ${numberWord(gap)} days after the carrier recorded delivery.`,
        specifics: { daysAfterDelivery: String(gap), daysAfterDeliveryWord: numberWord(gap), disputeOpenedOn: longDate(opened)! },
        weight: "strong",
        sources: ["dispute.initiated_at", ...deliveryFactIds],
        mustNot: [
          "Never say the claim is late or out of time.",
          "Never say or imply the customer was silent, did not complain or did not contact the merchant.",
          NO_POSSESSION,
        ],
      });
    }
  }

  // ── Return: code-owned, never model-written (plan §5.2) ──
  const returnStatus = sections.map((s) => str(obj(s?.data)?.returnStatus)).find(Boolean) ?? null;
  const returnAsked = !!extras.constraints?.returnRequested || !!extras.constraints?.refundOrCompensationRequested;
  if (returnStatus === "NO_RETURN" && !returnAsked) {
    add({
      id: "no_return_recorded",
      statement: "No return has been recorded in Shopify for this order.",
      specifics: {},
      weight: "strong",
      sources: ["pack.order.returnStatus"],
      mustNot: [
        "State it once in the whole letter, in the delivery section, as a sentence of its own. Never in the summary or the conclusion.",
        "Never say the customer did not return, did not try to return or never asked to return.",
      ],
    });
  }

  // ── The store's return route, open when the dispute came (D9) ──
  const w = extras.returnWindow;
  if (f && opened && w && extras.returnRouteAllowed && !returnAsked) {
    const inForceAtDelivery = !w.policyUpdatedAt || Date.parse(w.policyUpdatedAt) <= Date.parse(f.deliveredAt);
    const dayOfDispute = calendarDays(f.deliveredAt, opened);
    if (inForceAtDelivery && dayOfDispute >= 0 && dayOfDispute <= w.windowDays) {
      add({
        id: "return_route_open",
        statement:
          `The store's published refund policy, in force when the order was delivered, offers a refund on an item returned within ${w.windowDays} days of delivery. ` +
          `The dispute was opened ${numberWord(dayOfDispute)} days after delivery, inside that period.`,
        specifics: { windowDays: String(w.windowDays), windowDaysWord: numberWord(w.windowDays), dayOfDispute: String(dayOfDispute), dayOfDisputeWord: numberWord(dayOfDispute) },
        weight: "strong",
        sources: ["policy_snapshots.extracted_text", "dispute.initiated_at", "pack.shipping.fulfillments.deliveredAt"],
        mustNot: [
          "Never say the customer chose not to return, ignored, skipped or bypassed the return route, or went to the provider instead.",
          "Never state the policy's conditions (notice, postage, fees); the policy is printed in full as an exhibit.",
          "Never say the refund is automatic or unconditional; say the policy offers a refund on a return.",
        ],
      });
    }
  }

  if (f) {
    addLaterOrder(claims, input, {
      deliveredAt: f.deliveredAt,
      carrier: null,
      orderCreatedAt,
      shippedAt: f.shippedAt,
    });
  }

  // A letter needs more than the claim itself.
  return claims.length > 1 ? claims : null;
}
