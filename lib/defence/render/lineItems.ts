/**
 * Order Line Items extractor — single source of truth for the rows
 * rendered under "Order Line Items" on BOTH the PDF and the embedded
 * HTML view.
 *
 * The PDF prefers `meta.lineItemsFromContext` (set by
 * `deriveOrderContext()` from the order pack section) and falls back
 * to `approvedFacts[order_record].value.lineItems`. The HTML view
 * previously only read the fact value. With this shared builder both
 * surfaces follow the same priority order.
 *
 * Strict shape validation: rows missing description/quantity/price
 * are dropped. This guards against half-populated rows leaking into
 * the bank-facing table.
 */

import type { EvidenceFact } from "../types";

export interface LineItem {
  description: string;
  quantity: number;
  price: string;
}

/**
 * Build the Order Line Items rows.
 *
 * Priority:
 *   1. `contextLineItems` — passed in when the renderer has access to
 *      `orderContext.lineItems` (the deterministic source). PDF uses
 *      this via `meta.lineItemsFromContext`; HTML view doesn't have
 *      it today and passes undefined.
 *   2. Fallback — pull from the `order_record` fact's
 *      `value.lineItems` array. Both surfaces have access to facts.
 *
 * Returns `[]` when neither source has well-formed rows. The
 * renderer is expected to skip the section entirely in that case.
 */
export function buildLineItems(
  facts: EvidenceFact[],
  contextLineItems?: LineItem[] | null,
): LineItem[] {
  if (Array.isArray(contextLineItems) && contextLineItems.length > 0) {
    return contextLineItems;
  }
  for (const f of facts) {
    if (f.category !== "order_record") continue;
    const v = f.value as Record<string, unknown> | null | undefined;
    const raw = v?.lineItems;
    if (!Array.isArray(raw)) continue;
    return raw
      .map((it) => {
        const obj = it as Record<string, unknown>;
        const description =
          typeof obj.description === "string" ? obj.description : null;
        const quantity =
          typeof obj.quantity === "number" ? obj.quantity : null;
        const price = typeof obj.price === "string" ? obj.price : null;
        if (!description || quantity == null || !price) return null;
        return { description, quantity, price } as LineItem;
      })
      .filter((it): it is LineItem => it !== null);
  }
  return [];
}
