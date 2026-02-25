export type PlanId = "free" | "starter" | "growth" | "scale";

export const TRIAL_DAYS = 14;
export const TRIAL_INCLUDED_PACKS = 25;
export const FREE_LIFETIME_PACKS = 3;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number;
  packsPerMonth: number;
  packsLifetime?: number;
  autoPack: boolean;
  rules: boolean;
  maxRules: number | null;
  trialDays: number;
  features: string[];
  limits?: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free (Sandbox)",
    price: 0,
    packsPerMonth: 0,
    packsLifetime: FREE_LIFETIME_PACKS,
    autoPack: false,
    rules: false,
    maxRules: 0,
    trialDays: 0,
    features: [
      "Unlimited draft building & preview",
      "Evidence pack builder (drafts)",
      "Basic activity log",
      `Up to ${FREE_LIFETIME_PACKS} exported packs total (lifetime)`,
    ],
    limits: [
      "No rules automation",
      "No bulk actions",
      "Export is hard-capped (lifetime)",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 29,
    packsPerMonth: 15,
    autoPack: true,
    rules: true,
    maxRules: 5,
    trialDays: TRIAL_DAYS,
    features: [
      "15 packs/month included",
      "Basic rules (up to 5)",
      "Review queue + completeness gate",
      "Auto-build evidence packs",
      "Email support",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 79,
    packsPerMonth: 75,
    autoPack: true,
    rules: true,
    maxRules: null,
    trialDays: TRIAL_DAYS,
    features: [
      "75 packs/month included",
      "Advanced rules & playbooks",
      "Bulk actions + templates",
      "Multi-user access",
      "Auto-save to Shopify",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 149,
    packsPerMonth: 300,
    autoPack: true,
    rules: true,
    maxRules: null,
    trialDays: TRIAL_DAYS,
    features: [
      "300 packs/month included",
      "Multi-store support",
      "Advanced exports + audit trail",
      "SLA options",
      "Priority support",
    ],
  },
};

export interface TopUp {
  sku: string;
  label: string;
  packs: number;
  priceUsd: number;
}

export const TOP_UPS: TopUp[] = [
  { sku: "topup_25", label: "+25 packs", packs: 25, priceUsd: 19 },
  { sku: "topup_100", label: "+100 packs", packs: 100, priceUsd: 59 },
];

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId as PlanId] ?? PLANS.free;
}

export function getTopUp(sku: string): TopUp | undefined {
  return TOP_UPS.find((t) => t.sku === sku);
}
