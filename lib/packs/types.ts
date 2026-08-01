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
import type { PaymentContext } from "@/lib/disputes/paymentContext";
import type { PriorOrderHistory } from "./priorOrderHistory";

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
  /**
   * Payment-method context derived from `order` (card | klarna | affirm
   * | bnpl | … ). Lets collectors branch on payment method — e.g. the
   * fraud-risk and 3-D Secure collectors emit an intentional "not
   * applicable" marker for BNPL/local methods instead of silently
   * returning nothing. Always present; defaults to family "unknown"
   * when there is no order.
   */
  paymentContext: PaymentContext;
  /**
   * VERIFIED prior-order history for this customer (own-DB lookup done
   * once in buildPack.ts, same pattern as the risk-weakness snapshot).
   * Null when it could not be established — guest checkout, no order,
   * a failed read, or partial order coverage. `orderSource` MUST omit
   * `disputeFreeHistory` from the payload in that case so consumers
   * read "unknown" rather than "clean". See lib/packs/priorOrderHistory.ts.
   */
  priorHistory: PriorOrderHistory | null;
  /** `disputes.initiated_at` — collectors need it to tell a pre-dispute
   *  credit from a post-dispute one (see lib/automation/creditTiming). */
  disputeInitiatedAt: string | null;
  /** Disputed amount in the order's currency, for coverage arithmetic. */
  disputeAmount: number | null;
  /** `disputes.currency_code`. Coverage arithmetic against a refund is
   *  only valid when it matches the refund currency — 25 prod disputes
   *  are denominated differently from their order. */
  disputeCurrency: string | null;
  /** `disputes.phase` — `inquiry` | `chargeback`. */
  disputePhase: string | null;
}
