export type PlanId = "free" | "starter" | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number;
  packsPerMonth: number | null; // null = unlimited
  autoPack: boolean;
  rules: boolean;
  trialDays: number;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    packsPerMonth: 3,
    autoPack: false,
    rules: false,
    trialDays: 0,
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 29,
    packsPerMonth: 50,
    autoPack: true,
    rules: true,
    trialDays: 7,
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 79,
    packsPerMonth: null,
    autoPack: true,
    rules: true,
    trialDays: 7,
  },
};

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId as PlanId] ?? PLANS.free;
}
