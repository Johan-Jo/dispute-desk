/**
 * Cross-source contradiction gate.
 *
 * WHY THIS EXISTS. Every collector is individually correct and reads a
 * single source. Nothing checks whether two collectors, both right about
 * their own source, have produced a pair of facts that cannot both be
 * true about the world. When that happens we do not merely score a case
 * wrong — we write a false statement into a document filed with a bank.
 *
 * The founding case is cay-collective #13195 (2026-08-20). Shopify's
 * `Order.returnStatus` was `NO_RETURN`, which is TRUE: the customer never
 * opened an RMA. So `orderSource` emitted `no_return_initiated`, whose
 * whole meaning is "the customer never returned the goods, therefore no
 * refund was owed". Meanwhile the DHL adapter had already established
 * that the parcel failed delivery and was **returned to sender on
 * 2026-07-06** — the goods were sitting with the merchant. The defence
 * package went on to state, in its executive summary, that "no refund
 * obligation arose, as the goods were never returned to the merchant".
 *
 * Neither collector was wrong. The inference drawn from one of them was,
 * and only a reader holding BOTH could see it.
 *
 * WHERE THIS RUNS. Collectors run concurrently (`buildPack.ts`
 * `Promise.allSettled`), so no collector can consult another — and in
 * this case could not have: the return was known only to the carrier API,
 * never to Shopify's native fulfillment events. `buildPack` after the
 * gather is the first and only place that holds every section at once, so
 * that is where contradictions are resolved.
 *
 * WHAT IT MAY DO. Suppress a section whose meaning is refuted by another
 * source. Nothing else — it never edits payloads, never rescores, never
 * invents a fact. And it never suppresses silently: every drop is
 * returned as a typed record so the pack can carry it for admin
 * observability, the same rule the delivery reconciler already follows
 * with `sourceConflict` (a conflict is surfaced, not discarded).
 *
 * Adding a rule? It belongs here only when TWO sources make claims that
 * cannot both hold. A fact that is merely weak, stale, or unhelpful is
 * not a contradiction — that is the categorizer's and the argument
 * planner's job, not this module's.
 */

import type { EvidenceSection } from "./types";

/** One suppression, recorded rather than performed silently. */
export interface ContradictionRecord {
  /** Stable id of the rule that fired. */
  rule: "no_return_vs_returned_to_sender";
  /** The `fieldsProvided` entry whose section was dropped. */
  suppressedField: string;
  /** The source whose evidence refuted it. */
  refutedBy: string;
  /** Free-text detail for the admin view — never merchant- or
   *  bank-facing, and never localized (this is an operational record). */
  detail: string;
}

export interface ContradictionGateResult {
  sections: EvidenceSection[];
  contradictions: ContradictionRecord[];
}

/** True when this shipping section's reconciled delivery state says the
 *  parcel came back. Reads the collector's own vocabulary — the
 *  section-level `proofType` (see `resolveProofType` in
 *  `lib/packs/sources/fulfillmentSource.ts`) and, defensively, the
 *  per-fulfillment reconciled `carrierTracking.deliveryStatus`, so a
 *  partially-returned multi-parcel order still trips the gate. */
function sectionShowsReturnToSender(section: EvidenceSection): {
  returned: boolean;
  at: string | null;
} {
  const data = (section.data ?? {}) as Record<string, unknown>;
  let at: string | null = null;
  let returned = data.proofType === "returned_to_sender";

  const fulfillments = Array.isArray(data.fulfillments) ? data.fulfillments : [];
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    const ct = ff.carrierTracking;
    const status =
      ct && typeof ct === "object"
        ? (ct as Record<string, unknown>).deliveryStatus
        : null;
    if (status !== "Returned") continue;
    returned = true;
    const ev = ff.carrierTerminalEvent;
    const happenedAt =
      ev && typeof ev === "object"
        ? (ev as Record<string, unknown>).happenedAt
        : null;
    if (typeof happenedAt === "string" && happenedAt && (!at || happenedAt > at)) {
      at = happenedAt;
    }
  }
  return { returned, at };
}

/**
 * Resolve contradictions across the assembled section list.
 *
 * Pure. Returns a new array — the caller decides what to do with the
 * records.
 */
export function applyContradictionGate(
  sections: EvidenceSection[],
): ContradictionGateResult {
  const contradictions: ContradictionRecord[] = [];

  /* ── Rule 1: "no return initiated" vs. a parcel that came back ──
   *
   * `no_return_initiated` exists to ground ONE argument: the customer
   * never sent the goods back, so no refund was owed. A carrier
   * return-to-sender refutes the premise of that argument outright. It
   * does not matter that no RMA was opened — the merchant is holding the
   * goods either way, and an argument that turns on not holding them is
   * not available.
   *
   * Note this is asymmetric on purpose. We drop the INFERENCE
   * (`no_return_initiated`), never the carrier fact. The carrier fact is
   * the one that survived contact with reality. */
  let returnedAt: string | null = null;
  let returnedToSender = false;
  for (const s of sections) {
    if (!s.fieldsProvided.some((f) => f === "shipping_tracking" || f === "delivery_proof")) {
      continue;
    }
    const seen = sectionShowsReturnToSender(s);
    if (!seen.returned) continue;
    returnedToSender = true;
    if (seen.at && (!returnedAt || seen.at > returnedAt)) returnedAt = seen.at;
  }

  if (!returnedToSender) return { sections, contradictions };

  const kept = sections.filter((s) => {
    if (!s.fieldsProvided.includes("no_return_initiated")) return true;
    contradictions.push({
      rule: "no_return_vs_returned_to_sender",
      suppressedField: "no_return_initiated",
      refutedBy: "carrier_delivery_state",
      detail:
        "Shopify Order.returnStatus is NO_RETURN, but the carrier reconciled " +
        `this order's shipment to Returned${returnedAt ? ` on ${returnedAt}` : ""}. ` +
        "The goods are back with the merchant, so 'the customer never returned " +
        "the goods, therefore no refund was owed' is not an available argument.",
    });
    return false;
  });

  return { sections: kept, contradictions };
}

/** True when the assembled sections carry a returned-to-sender shipment.
 *  THE definition of "the parcel came back" on the pack-section side —
 *  shared with the returned-to-sender gate (`buildPack`) so a second,
 *  subtly different reading of the payload cannot appear. (The fact-set
 *  side has its own single definition,
 *  `lib/defence/factPredicates.hasReturnedToSenderShipment`, over
 *  classified facts rather than raw sections.) */
export function hasReturnedToSenderShipment(
  sections: readonly EvidenceSection[],
): boolean {
  return sections.some(
    (s) =>
      s.fieldsProvided.some((f) => f === "shipping_tracking" || f === "delivery_proof") &&
      sectionShowsReturnToSender(s).returned,
  );
}

/** Latest carrier return-to-sender timestamp across the sections, or null
 *  when the carrier reported the state without a usable date. Merchant
 *  copy names this date. */
export function returnedToSenderAt(
  sections: readonly EvidenceSection[],
): string | null {
  let at: string | null = null;
  for (const s of sections) {
    if (!s.fieldsProvided.some((f) => f === "shipping_tracking" || f === "delivery_proof")) {
      continue;
    }
    const seen = sectionShowsReturnToSender(s);
    if (seen.returned && seen.at && (!at || seen.at > at)) at = seen.at;
  }
  return at;
}
