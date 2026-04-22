/**
 * Shared types for evidence pack building.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export interface EvidenceSection {
  type:
    | "order"
    | "shipping"
    | "tracking"
    | "policy"
    | "refund_policy"
    | "shipping_policy"
    | "cancellation_policy"
    | "comms"
    | "other"
    | "access_log";
  label: string;
  source: string;
  data: Record<string, unknown>;
  /** Fields this section contributes to the completeness checklist. */
  fieldsProvided: string[];
}

export interface BuildContext {
  packId: string;
  disputeId: string;
  shopId: string;
  disputeReason: string | null;
  orderGid: string | null;
  shopDomain: string;
  accessToken: string;
  correlationId?: string;
  /**
   * Pre-fetched order detail. buildPack.ts issues ORDER_DETAIL_QUERY
   * once and populates this field before running collectors so
   * orderSource, fulfillmentSource, and customerCommSource can all
   * read from the same parsed response instead of each making their
   * own round-trip to Shopify. Null when the dispute has no linked
   * order (orderGid is null) or the fetch failed.
   */
  order: OrderDetailNode | null;
}
