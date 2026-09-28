/**
 * Does the tracked shipment hold every purchased item?
 *
 * A letter may say "the fulfilment record links all three purchased items to
 * this shipment" only when the records show it item by item: the
 * fulfilment carrying the tracking number maps, by line-item ID, to every
 * line item on the order in the quantity ordered. A matching COUNT is not
 * enough — "3 items fulfilled" on a 3-item order could be three of one
 * product (maintainer review of #352543, 2026-09-25).
 *
 * Returns:
 *   - `verified`: the item-by-item mapping holds;
 *   - `history`: no ID mapping (a pack built before line-item IDs were
 *     collected, or a mismatch), but the order history records "<actor>
 *     marked N items as fulfilled" on exactly one fulfilment. A letter may
 *     quote that record, and nothing more;
 *   - null: neither.
 */

import { classifyChronologyEvent } from "./chronology";

export type FulfilmentCoverage =
  | { kind: "verified"; itemCount: number; at: string | null }
  | { kind: "history"; actor: string; markedCount: number; at: string };

interface PackSectionLike {
  type?: string | null;
  data?: unknown;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
const qty = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function verified(
  sections: readonly PackSectionLike[],
  trackingNumber: string,
): { itemCount: number; at: string | null } | null {
  const order = sections.find((s) => s?.type === "order" && Array.isArray(obj(s.data)?.lineItems));
  const shipping = sections.find((s) => s?.type === "shipping" && Array.isArray(obj(s.data)?.fulfillments));
  if (!order || !shipping) return null;

  const ordered = new Map<string, number>();
  for (const raw of obj(order.data)!.lineItems as unknown[]) {
    const it = obj(raw);
    const id = typeof it?.lineItemId === "string" ? it.lineItemId : null;
    if (!id) return null;
    ordered.set(id, (ordered.get(id) ?? 0) + qty(it!.quantity));
  }
  if (ordered.size === 0) return null;

  const fulfilment = (obj(shipping.data)!.fulfillments as unknown[])
    .map(obj)
    .find((f) =>
      Array.isArray(f?.tracking) &&
      (f!.tracking as unknown[]).some((t) => obj(t)?.number === trackingNumber),
    );
  if (!fulfilment || !Array.isArray(fulfilment.items)) return null;

  const shipped = new Map<string, number>();
  for (const raw of fulfilment.items as unknown[]) {
    const it = obj(raw);
    const id = typeof it?.lineItemId === "string" ? it.lineItemId : null;
    if (!id || !ordered.has(id)) return null;
    shipped.set(id, (shipped.get(id) ?? 0) + qty(it!.quantity));
  }
  for (const [id, n] of ordered) {
    if (n <= 0 || shipped.get(id) !== n) return null;
  }
  return {
    itemCount: [...ordered.values()].reduce((a, b) => a + b, 0),
    at: typeof fulfilment.createdAt === "string" ? fulfilment.createdAt : null,
  };
}

export function fulfilmentCoverage(
  sections: readonly PackSectionLike[] | null | undefined,
  trackingNumber: string | null | undefined,
  timelineEvents: ReadonlyArray<{ at: string; text: string }> = [],
): FulfilmentCoverage | null {
  if (Array.isArray(sections) && trackingNumber) {
    const v = verified(sections, trackingNumber);
    if (v) return { kind: "verified", ...v };
  }
  const fulfilments = timelineEvents.filter((e) => classifyChronologyEvent(e.text) === "fulfillment_shipment");
  if (fulfilments.length !== 1) return null;
  const m = fulfilments[0].text.match(/^(.+?) marked (\d+) items? as fulfilled/i);
  return m ? { kind: "history", actor: m[1], markedCount: Number(m[2]), at: fulfilments[0].at } : null;
}
