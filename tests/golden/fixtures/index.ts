/**
 * Golden dispute fixtures registry.
 *
 * Pure-function fixtures that lock the engine outputs for a small set of
 * canonical dispute scenarios. See tests/golden/README.md.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import type { RawPackSection } from "@/lib/shopify/fieldMapping";

export interface GoldenFixture {
  /** Short slug used as the test name. */
  name: string;
  /** Plain-language description shown in failure output. */
  description: string;
  /** Shopify dispute reason code (e.g. "FRAUDULENT", "PRODUCT_NOT_RECEIVED"). */
  disputeReason: string | null;
  /** Disputed amount in the order's currency. Null when unknown. */
  disputeAmount: number | null;
  /** Partial order — only the fields the engines actually read need to be
   *  populated. Cast to OrderDetailNode at the call site. */
  order: Partial<OrderDetailNode> | null;
  /** Evidence checklist as the workspace would persist it. */
  checklist: ChecklistItemV2[];
  /** Per-field payloads fed to the canonical categorizer via the
   *  `byField` payloadSource shape. */
  evidencePayloads: Record<string, Record<string, unknown> | null>;
  /** Raw pack sections fed to the Shopify field mapper. */
  packSections: RawPackSection[];
}

import { fixture as strongDeliveredFraud } from "./strong-delivered-fraud";
import { fixture as digitalGoodsAccess } from "./digital-goods-access";
import { fixture as missingEvidence } from "./missing-evidence";
import { fixture as refundBeforeChargeback } from "./refund-before-chargeback";
import { fixture as suspiciousRiskyOrder } from "./suspicious-risky-order";

export const GOLDEN_FIXTURES: GoldenFixture[] = [
  strongDeliveredFraud,
  digitalGoodsAccess,
  missingEvidence,
  refundBeforeChargeback,
  suspiciousRiskyOrder,
];
