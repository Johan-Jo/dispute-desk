/**
 * REST supplement field extraction for the save-to-shopify pipeline.
 *
 * Shopify's GraphQL `disputeEvidenceUpdate` mutation rejects four
 * fields the REST `/dispute_evidences.json` PUT endpoint accepts:
 *
 *   - product_description
 *   - shipping_carrier
 *   - shipping_tracking_number
 *   - shipping_date
 *
 * Verified across 2024-10 / 2025-04 / 2026-01 API versions. The
 * production save-to-shopify handler issues a follow-up REST PUT to
 * supplement the GraphQL payload with these. This module is the pure
 * extraction step — given the same pack sections it always returns
 * the same Record. No DB, no network, no audit. Same input → same
 * output.
 *
 * Pinned by `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts`
 * across the four dispute-family fixtures; do not change extraction
 * logic without updating the snapshots in code review.
 */

import type { RawPackSection } from "./fieldMapping";

/** Keys produced by this extractor. */
export type RestSupplementField =
  | "product_description"
  | "shipping_carrier"
  | "shipping_tracking_number"
  | "shipping_date";

export type RestSupplementFields = Partial<Record<RestSupplementField, string>>;

/**
 * Extract the REST-only supplement payload from a pack's sections.
 *
 * Reads:
 *   - `order` sections → product_description (joined line items)
 *   - `shipping` / `fulfillment` sections → shipping_carrier,
 *     shipping_tracking_number, shipping_date
 *
 * Returns an object with only the fields that have non-empty values.
 * An empty object is the explicit "nothing to send" signal — callers
 * should skip the REST PUT entirely when this returns `{}`.
 */
export function buildRestSupplementFields(
  sections: RawPackSection[],
): RestSupplementFields {
  const out: RestSupplementFields = {};

  // Product description from line items
  const orderSections = sections.filter((s) => s.type === "order");
  for (const s of orderSections) {
    const items = s.data?.lineItems as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      const desc = items
        .map((li) => {
          const parts: string[] = [];
          if (li.title) parts.push(`Product name: ${String(li.title)}`);
          if (li.variantTitle) parts.push(`Size: ${String(li.variantTitle)}`);
          if (li.quantity) parts.push(`Quantity: ${String(li.quantity)}`);
          if (li.price) parts.push(`Price: ${String(li.price)}`);
          if (li.sku) parts.push(`SKU: ${String(li.sku)}`);
          return parts.join("\n");
        })
        .join("\n\n");
      if (desc) out.product_description = desc;
    }
  }

  // Shipping data from fulfillment sections
  const shipSections = sections.filter(
    (s) => s.type === "shipping" || s.type === "fulfillment",
  );
  for (const s of shipSections) {
    const fulfillments = s.data?.fulfillments as
      | Array<Record<string, unknown>>
      | undefined;
    if (!Array.isArray(fulfillments)) continue;
    for (const f of fulfillments) {
      if (f.createdAt) out.shipping_date = String(f.createdAt).split("T")[0];
      const tracking = f.tracking as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(tracking)) {
        for (const t of tracking) {
          if (t.carrier) out.shipping_carrier = String(t.carrier);
          if (t.number) out.shipping_tracking_number = String(t.number);
        }
      }
    }
  }

  return out;
}
