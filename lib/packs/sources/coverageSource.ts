/**
 * Shopify Protect coverage collector.
 *
 * Reads `Order.shopifyProtect.status` and emits a coverage signal.
 * The Coverage Gate (PRD §4) is the highest-priority routing decision:
 * when an order is covered (PROTECTED or ACTIVE), Shopify assumes
 * liability and the merchant has no evidence workflow to run.
 *
 * This collector emits a section but does NOT register a canonical
 * evidence field — coverage is a case-level signal that overrides the
 * evidence-strength model entirely, not an evidence item that
 * contributes to it. Persisting the section gives us audit trail and
 * surface for the workspace API; scoring sees it via the dedicated
 * `coverage` summary on `pack_json`, not through canonicalEvidence.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

/** Shape persisted on `pack_json.coverage` and surfaced to the
 *  workspace API. The `state` field is the routing primitive — the
 *  pipeline gates on it without needing to interpret the raw enum. */
export interface CoverageSummary {
  state: "covered_shopify" | "not_covered";
  /** Raw Shopify Protect status when known; null when the program is
   *  not applicable to this order. */
  shopifyProtectStatus:
    | "ACTIVE"
    | "INACTIVE"
    | "NOT_PROTECTED"
    | "PENDING"
    | "PROTECTED"
    | null;
  /** True when status indicates Shopify is actively covering the
   *  chargeback (or will, if one arrives). PENDING is excluded —
   *  treated as not_covered until Shopify decides. */
  isCovered: boolean;
}

/** Statuses where Shopify is actively underwriting the dispute. */
const COVERED_STATUSES = new Set<string>(["PROTECTED", "ACTIVE"]);

export function summarizeCoverage(
  order: OrderDetailNode | null,
): CoverageSummary {
  const status = order?.shopifyProtect?.status ?? null;
  const isCovered = status != null && COVERED_STATUSES.has(status);
  return {
    state: isCovered ? "covered_shopify" : "not_covered",
    shopifyProtectStatus: status,
    isCovered,
  };
}

export async function collectCoverageEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order) return [];
  const summary = summarizeCoverage(order);

  // Only emit a section when the Protect program is applicable to this
  // order — otherwise the section is just noise. The pipeline still
  // gets the summary via `pack_json.coverage` regardless.
  if (summary.shopifyProtectStatus == null) return [];

  return [
    {
      type: "other",
      label: "Shopify Protect coverage",
      source: "shopify_order",
      // Not in canonicalEvidence — coverage overrides the strength
      // model rather than feeding into it. Kept as a fieldsProvided
      // string only so the workspace API can locate this row by name.
      fieldsProvided: ["shopify_protect_coverage"],
      data: summary as unknown as Record<string, unknown>,
    },
  ];
}
