/**
 * Shared types for evidence pack building.
 *
 * Phase 4 (2026-05-24): `EvidenceSection.label` removed. Collectors
 * emit `labelToken: I18nToken` and consumers resolve via the i18n
 * pipeline. Legacy `pack_json` rows persisted before this change
 * carry only the English `label`; they are read through
 * `lib/packs/sectionLabel.ts`, which accepts the looser persisted
 * shape and synthesizes a fallback token from `type`.
 */

import type { I18nToken } from "@/lib/i18n/token";
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
  /** Token for the merchant-facing section label. Resolved by the
   *  consumer via `lib/packs/sectionLabel.ts`. Lib never emits
   *  English. */
  labelToken: I18nToken;
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
