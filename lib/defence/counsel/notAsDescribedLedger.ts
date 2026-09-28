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
      statement:
        `The item was sold under a published store listing with ${withPhotos ? "photographs and " : ""}a written description. ` +
        `The listing, as retrieved from the store${retrieved ? ` on ${retrieved}` : ""}, is reproduced in the letter with an English translation.`,
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
        "Written by code in the Delivery and return section. The summary must NOT mention returns at all.",
        "Never say the customer did not return, did not try to return or never asked to return.",
      ],
    });
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
