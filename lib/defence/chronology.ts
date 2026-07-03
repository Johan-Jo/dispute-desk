/**
 * Chronology of Events — single source of truth for the bullets that
 * render under the "Chronology of Events" section in BOTH the PDF
 * (`lib/defence/pdf/DefencePackageDocument.tsx`) and the embedded
 * HTML view (`DefencePackageHtmlView.tsx`).
 *
 * Before 2026-05-19 each renderer had its own copy of this function.
 * They agreed by coincidence as long as their inputs matched, but
 * they diverged the moment the workspace API stopped surfacing the
 * rich `timelineEvents` array. The merchant saw 2 synthetic events
 * in the embedded view while the bank's PDF showed the full 8-event
 * Shopify timeline.
 *
 * This module is the canonical implementation. Both renderers MUST
 * import `buildChronologyEvents()` from here — duplicating the logic
 * in a renderer file is a bug.
 *
 * Inputs are intentionally minimal: a `transactionContext` object
 * carries the rich `timelineEvents` array (when present) and the
 * synthetic-fallback fields (transactionDate, orderName, cardNetwork,
 * cardLast4). The `facts` array supplies customer_communication
 * timestamps for the fallback path's third event.
 */

import type { EvidenceFact } from "./types";

/** One bullet on the rendered Chronology of Events list. */
export interface ChronologyEvent {
  at: string;
  text: string;
}

/**
 * Minimal transaction context the chronology builder needs. The
 * concrete callers (PDF `DefencePackageMeta`, HTML view
 * `DisputeContextLike`) pass a superset of this shape.
 */
export interface ChronologyContext {
  /** Full event timeline from the pack's access_log section.
   *  Threaded through by:
   *    - PDF: `meta.timelineEvents` (set by `buildDefencePackageJob`)
   *    - HTML view: `dispute.timelineEvents` (set by the workspace
   *      API from `deriveOrderContext`)
   *  Both routes ultimately read `orderContext.timelineEvents`.
   *
   *  When present and non-empty, the rich path takes precedence.
   *  The synthetic fallback below is dead code in that case. */
  timelineEvents?: Array<{ at: string; text: string }> | null;

  /** Synthetic-fallback fields. Only used when `timelineEvents` is
   *  absent (old packs predating orderSource events capture). */
  transactionDate?: string | null;
  orderName?: string | null;
  cardNetwork?: string | null;
  cardLast4?: string | null;
}

/**
 * Build the chronology bullets for one defence package.
 *
 * Priority:
 *   1. `context.timelineEvents` — rich Shopify Order.events. Sorted
 *      ascending so the merchant reads them in chronological order.
 *      Capped at 20 by `orderSource.ts`.
 *   2. Synthetic fallback — derive 2 events from transactionDate
 *      (placed + authorisation). Add a 3rd event when an approved
 *      `customer_communication` fact carries a `lastMessageAt`.
 *
 * The fallback fires ONLY when the rich array is missing — which
 * means: packs built before `orderSource.ts` started capturing
 * `timelineEvents` (~2025-08), or freshly-built packs where the
 * Shopify Order.events API returned nothing (e.g. POS orders).
 */
/**
 * Shopify's Swedish money formatting glues the "kr" symbol onto the
 * amount *and* appends the ISO code — e.g. "A kr628.00 SEK payment was
 * processed on Klarna." The doubled currency ("kr…SEK") reads wrong in
 * bank-facing prose, so we drop the redundant "kr" prefix, leaving
 * "628.00 SEK". Only strips "kr" when it directly precedes a number that
 * is *also* suffixed by the ISO code — a plain "kr628.00" with no ISO
 * code is left untouched (removing the only currency marker would lose
 * information). Applied to the rich Shopify timeline text verbatim.
 */
export function normalizeChronologyText(text: string): string {
  // "kr628.00 SEK" → "628.00 SEK"; "kr 605,22 SEK" → "605,22 SEK".
  return text.replace(
    /\bkr\s?(\d[\d.,\s]*\s+[A-Z]{3})\b/g,
    "$1",
  );
}

export function buildChronologyEvents(
  context: ChronologyContext,
  facts: EvidenceFact[] = [],
): ChronologyEvent[] {
  // Path 1: rich timeline. Same priority order both surfaces share.
  const rich = context.timelineEvents;
  if (Array.isArray(rich) && rich.length > 0) {
    return [...rich]
      .map((e) => ({ ...e, text: normalizeChronologyText(e.text) }))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  // Path 2: synthetic fallback. Only fires when the pack lacks captured events.
  const events: ChronologyEvent[] = [];
  if (context.transactionDate) {
    events.push({
      at: context.transactionDate,
      text: `Order placed on the merchant's storefront${
        context.orderName ? ` (${context.orderName})` : ""
      }.`,
    });
    events.push({
      at: context.transactionDate,
      text: `Authorisation captured against the cardholder's ${
        context.cardNetwork ?? "card"
      }${context.cardLast4 ? ` ending in ${context.cardLast4}` : ""}.`,
    });
  }
  for (const f of facts) {
    if (f.category === "customer_communication") {
      const v = f.value as Record<string, unknown> | null | undefined;
      const at = typeof v?.lastMessageAt === "string" ? v.lastMessageAt : null;
      if (at) {
        events.push({
          at,
          text: `Customer correspondence with the merchant${
            v?.customerConfirmsOrder === true
              ? " — order receipt confirmed by the customer"
              : ""
          }.`,
        });
      }
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
