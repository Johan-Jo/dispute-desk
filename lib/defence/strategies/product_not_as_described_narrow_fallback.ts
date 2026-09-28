/**
 * Strategy: narrow fallback (product_not_as_described family).
 *
 * v2 (2026-09-28, not-as-described plan PR 1). v1 said the listing fact was
 * "always present" — on prod 0 of 308 not-as-described packs carried one —
 * and steered toward "what evidence supports the merchant's position", the
 * hedge the family overlay now forbids.
 */

import type { StrategySubmodule } from "../types";

export const product_not_as_described_narrow_fallback: StrategySubmodule = {
  key: "product_not_as_described_narrow_fallback",
  familyKey: "product_not_as_described",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when complaint-evidence is thin. Argue from the facts actually approved: the order record, any policy disclosures on record, and any product listing fact if one is present.",
    "Never argue the product was 'acceptable' — that's subjective. State plainly what the merchant offered, what the customer ordered, and what each approved record shows, in the merchant's favour.",
  ].join("\n"),
  version: 2,
};
