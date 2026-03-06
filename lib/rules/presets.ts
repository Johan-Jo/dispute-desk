/**
 * Starter rule presets for first-visit onboarding.
 * Used by POST /api/rules/install-preset and the Rules page empty state.
 */

export interface RulePreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
  /** Stable name for DB insert and idempotency dedupe */
  name: string;
  match: {
    reason?: string[];
    amount_range?: { min?: number; max?: number };
  };
  action: { mode: "auto_pack" | "review" };
  priority: number;
}

export const RULE_PRESETS: RulePreset[] = [
  {
    id: "preset-fraud-auto",
    nameKey: "presetFraudAuto",
    descriptionKey: "presetFraudAutoDesc",
    name: "Auto-Pack Fraudulent Disputes",
    match: { reason: ["FRAUDULENT"] },
    action: { mode: "auto_pack" },
    priority: 0,
  },
  {
    id: "preset-pnr-auto",
    nameKey: "presetPnrAuto",
    descriptionKey: "presetPnrAutoDesc",
    name: "Auto-Pack Product Not Received",
    match: { reason: ["PRODUCT_NOT_RECEIVED"] },
    action: { mode: "auto_pack" },
    priority: 1,
  },
  {
    id: "preset-high-value-review",
    nameKey: "presetHighValueReview",
    descriptionKey: "presetHighValueReviewDesc",
    name: "Review High-Value Disputes",
    match: { amount_range: { min: 500 } },
    action: { mode: "review" },
    priority: 2,
  },
  {
    id: "preset-catch-all-review",
    nameKey: "presetCatchAllReview",
    descriptionKey: "presetCatchAllReviewDesc",
    name: "Catch-All: Send to Review",
    match: {},
    action: { mode: "review" },
    priority: 3,
  },
];
