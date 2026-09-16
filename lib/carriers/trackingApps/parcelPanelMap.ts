/**
 * ParcelPanel timeline → `CarrierDeliveryStatus`. Pure; no I/O.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §7.1, §7.1.1.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * ParcelPanel is a tracking app merchants install themselves. It queries
 * carriers we have no adapter for — YunExpress among them — and normalises
 * the result. On 2026-09-07 it had dispute 4b81afe1's parcel classified as
 * returned-to-sender; we filed a not-as-described defence anyway, because
 * nothing read it. It writes no Shopify metafields (probed: four orders on
 * `6a8848-dd` carry one unrelated metafield each), so the existing
 * `lib/shopify/trackingApps.ts` reader has nothing to read. Its HTTP
 * endpoint is the only source that holds this.
 *
 * ── The selection rule: LATEST VALID STATE BY EVENT TIME ─────────────
 *
 * NOT "the most severe state". A parcel can be `Returned` at T1 and then
 * corrected, intercepted, redelivered or collected at T2. Ranking by
 * severity would pin it at `Returned` forever and ignore the later truth —
 * the same no-downgrade error, pointed the other way, that this work exists
 * to fix. So: walk chronologically, keep only events that map, take the
 * latest. A tie rule breaks EXACT timestamp collisions only, and never
 * overrides a later event.
 */

import type { CarrierDeliveryStatus } from "@/lib/carriers/types";

/** One checkpoint as ParcelPanel serves it. Every field is optional in
 *  practice — `substatus` is empty on 91 of 349 sampled events. */
export interface ParcelPanelCheckpoint {
  date_carbon?: unknown;
  checkpoint_status?: unknown;
  substatus?: unknown;
  StatusDescription?: unknown;
  DetailsMap?: unknown;
}

export interface ParcelPanelMapResult {
  status: CarrierDeliveryStatus | null;
  /** `date_carbon` of the electing event, verbatim. Null when no signal. */
  at: string | null;
  /** True when two mapped events share a timestamp and disagree in a way the
   *  tie rule refuses to resolve (Delivered vs Returned). Surfaced, never
   *  silently collapsed. */
  conflict: boolean;
}

const NO_SIGNAL: ParcelPanelMapResult = { status: null, at: null, conflict: false };

/** Return-to-sender phrasing seen in real German carrier events. The parcel
 *  that started this work reads "Zugestellt(Rücksendung an Absender)" — the
 *  word "Zugestellt" means DELIVERED, and only the parenthetical says the
 *  delivery was back to the sender. Matching on the description alone would
 *  invert the meaning, which is why `Exception_008` gates it. */
const RETURN_PHRASES =
  /r[üu]cksendung an absender|r[üu]ckgabe an absender|return(ed)? to sender|retour/i;

/** Collection BY THE CUSTOMER at a service point — confirmed receipt, but
 *  never an address-delivery claim. Distinct from arrival at a pickup point. */
const COLLECTED_PHRASES =
  /abgeholt|collected by (the )?(customer|recipient)|picked up by/i;

/** Arrival at a pickup point with collection still pending. */
const PICKUP_ARRIVAL_PHRASES =
  /abholung|zur abholung|ready for (pick ?up|collection)|available for pickup|benachrichtigungskarte/i;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Map ONE checkpoint. Returns null when the event carries no terminal
 * meaning — in-transit is never a negative signal, and an unrecognised
 * pair is deliberately no signal rather than a guess.
 */
export function mapCheckpoint(c: ParcelPanelCheckpoint): CarrierDeliveryStatus | null {
  const cp = str(c.checkpoint_status).toLowerCase();
  const sub = str(c.substatus);
  const desc = str(c.StatusDescription);

  // `Exception_008` is ParcelPanel's return-to-sender substatus. Require the
  // phrasing too: `exception` alone covers customs holds, address problems
  // and damage, none of which mean the parcel came back.
  if (sub.startsWith("Exception_008") || cp === "exception") {
    if (RETURN_PHRASES.test(desc)) return "Returned";
    return null;
  }

  if (cp === "delivered" || sub.startsWith("Delivered")) {
    // A "delivered" event whose text says it went back to the sender is a
    // return, not a delivery. This is the #98141 trap.
    if (RETURN_PHRASES.test(desc)) return "Returned";
    if (COLLECTED_PHRASES.test(desc)) return "CollectedAtPickup";
    return "Delivered";
  }

  // A failed attempt is only a terminal state when the parcel is waiting
  // somewhere the customer can collect it. Otherwise it is still moving.
  if (cp === "undelivered" || sub.startsWith("FailedAttempt")) {
    if (RETURN_PHRASES.test(desc)) return "Returned";
    if (PICKUP_ARRIVAL_PHRASES.test(desc)) return "DeliveredToPickup";
    return null;
  }

  if (cp === "pickup" || sub.startsWith("AvailableForPickup")) {
    if (COLLECTED_PHRASES.test(desc)) return "CollectedAtPickup";
    return "DeliveredToPickup";
  }

  // transit / blank / info_received / InTransit_* / OutForDelivery_* and
  // anything unrecognised: no terminal signal.
  return null;
}

/**
 * Rank used ONLY to break an exact `date_carbon` tie (§7.1.1 step 3). Never
 * applied across different timestamps.
 *
 * `Returned` and `Delivered` are deliberately EQUAL, and the tie-break below
 * refuses that pair rather than picking one. They are not two readings of one
 * event; they are two incompatible claims about the same moment, and guessing
 * between them is exactly the kind of silent resolution this work exists to
 * remove. A failed-attempt/return pair at one timestamp IS one event described
 * twice, which is why `Returned` outranks `DeliveredToPickup`.
 */
const TIE_RANK: Record<CarrierDeliveryStatus, number> = {
  Returned: 2,
  CollectedAtPickup: 2,
  Delivered: 2,
  DeliveredToPickup: 1,
};

/**
 * Elect one signal for a shipment from its full timeline.
 *
 * `date_carbon` is a naive local-time string with no zone ("2026-09-07
 * 09:17:41"). We compare them as STRINGS: the format is fixed-width and
 * lexicographic order equals chronological order within one shipment's
 * timeline, which is all we need. Parsing to Date would invent a timezone
 * we do not know — ParcelPanel's normalisation is undocumented.
 */
export function electSignal(
  checkpoints: readonly ParcelPanelCheckpoint[],
): ParcelPanelMapResult {
  let best: { status: CarrierDeliveryStatus; at: string } | null = null;
  let conflict = false;

  for (const c of checkpoints) {
    const status = mapCheckpoint(c);
    if (!status) continue;
    const at = str(c.date_carbon);
    if (!at) continue;

    if (!best || at > best.at) {
      best = { status, at };
      conflict = false; // a strictly later event supersedes any earlier tie
      continue;
    }
    if (at !== best.at || status === best.status) continue;

    // Exact timestamp collision, different states.
    const a = TIE_RANK[status];
    const b = TIE_RANK[best.status];
    if (a > b) {
      best = { status, at };
      continue;
    }
    if (a < b) continue;

    // Equal rank and different status — that is Delivered vs
    // CollectedAtPickup (benign: both are receipt; keep the more specific
    // collection) or a genuine contradiction we refuse to resolve.
    const pair = new Set([status, best.status]);
    if (pair.has("Delivered") && pair.has("CollectedAtPickup")) {
      best = { status: "CollectedAtPickup", at };
      continue;
    }
    conflict = true;
  }

  if (conflict) return { status: null, at: null, conflict: true };
  return best ? { status: best.status, at: best.at, conflict: false } : NO_SIGNAL;
}
