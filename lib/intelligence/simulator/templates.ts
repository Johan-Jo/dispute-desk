/**
 * Policy Simulator templates (design §16). Each is a starting point the admin
 * can adjust. Effectiveness defaults are deliberately modest (never assume full
 * prevention). Costs default to 0 until the merchant supplies assumptions.
 */

import type { SimulationInput } from "./simulate";

export interface PolicyTemplate {
  key: string;
  label: string;
  description: string;
  build: (currency: string) => Omit<SimulationInput, "currency"> & { currency: string };
}

const modest = { conservativeBps: 1500, expectedBps: 3500, optimisticBps: 6000 }; // 15/35/60%

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    key: "review_high_risk_above_value",
    label: "Manually review high-risk orders above a value",
    description: "Route Shopify high-risk orders above a chosen order value to manual review.",
    build: (currency) => ({
      template: "review_high_risk_above_value",
      currency,
      filters: { minValueDecimal: 150, riskLevels: ["HIGH"] },
      effectiveness: modest,
      costs: { perOrderCostMinor: 0 },
    }),
  },
  {
    key: "review_international_high_risk",
    label: "Review international high-risk orders",
    description: "Manual review for cross-border high-risk orders.",
    build: (currency) => ({
      template: "review_international_high_risk",
      currency,
      filters: { riskLevels: ["HIGH"], crossBorder: true },
      effectiveness: modest,
      costs: { perOrderCostMinor: 0 },
    }),
  },
  {
    key: "signature_above_value",
    label: "Require signature above a value",
    description: "Require delivery signature for orders above a chosen value.",
    build: (currency) => ({
      template: "signature_above_value",
      currency,
      filters: { minValueDecimal: 200 },
      effectiveness: { conservativeBps: 1000, expectedBps: 2500, optimisticBps: 4500 },
      costs: { perOrderCostMinor: 0 },
    }),
  },
];

export function getTemplate(key: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.key === key);
}
