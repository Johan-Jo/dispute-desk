import type { StepId } from "./types";

export interface StepDefinition {
  id: StepId;
  index: number;
  title: string;
  dashboardLabel: string;
  timeEstimate: string;
  prerequisites: StepId[];
  unlocks: string[];
}

/** Wizard steps: Connection → Store Profile → Coverage → Automation → Policies → Activate. */
export const SETUP_STEPS: StepDefinition[] = [
  {
    id: "connection",
    index: 0,
    title: "Connection",
    dashboardLabel: "Connection & Readiness",
    timeEstimate: "1 min",
    prerequisites: [],
    unlocks: [
      "Verify Shopify connection and permissions",
      "Confirm dispute and evidence access",
      "Check webhook and sync status",
    ],
  },
  {
    id: "store_profile",
    index: 1,
    title: "Store Profile",
    dashboardLabel: "Tell us about your store",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Personalized coverage recommendations",
      "Right evidence types for your products",
      "Optimal automation settings",
    ],
  },
  {
    id: "coverage",
    index: 2,
    title: "Coverage",
    dashboardLabel: "Dispute coverage",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Recommended handling for each dispute type",
      "Confidence-based automation levels",
      "Full dispute family coverage",
    ],
  },
  {
    id: "automation",
    index: 3,
    title: "Automation",
    dashboardLabel: "Automation rules",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Hands-free dispute handling",
      "Review rules for high-value or risky cases",
      "Full control and oversight",
    ],
  },
  {
    id: "policies",
    index: 4,
    title: "Policies",
    dashboardLabel: "Business policies",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Shipping, refund, and terms policies in every pack",
      "Stronger evidence for chargeback responses",
      "Template or upload — your choice",
    ],
  },
  {
    id: "activate",
    index: 5,
    title: "Activate",
    dashboardLabel: "Activate protection",
    timeEstimate: "1 min",
    prerequisites: [],
    unlocks: [
      "Live dispute coverage",
      "Automated evidence building",
      "Background preparation of handling rules",
    ],
  },
];

export const STEP_IDS: StepId[] = SETUP_STEPS.map((s) => s.id);

export const STEP_BY_ID = Object.fromEntries(
  SETUP_STEPS.map((s) => [s.id, s])
) as Record<StepId, StepDefinition>;

export const TOTAL_STEPS = SETUP_STEPS.length;

/** All 6 steps are shown in the wizard flow (no separate welcome/pre-steps). */
export const WIZARD_STEP_IDS: StepId[] = ["connection", "store_profile", "coverage", "automation", "policies", "activate"];

/** All 6 steps shown in the wizard top stepper bar. */
export const WIZARD_STEPPER_IDS: StepId[] = ["connection", "store_profile", "coverage", "automation", "policies", "activate"];

export const TOTAL_WIZARD_STEPS = WIZARD_STEP_IDS.length;

/** Map legacy step ids to new step ids for migration of shop_setup.steps */
export const LEGACY_STEP_ID_MAP: Record<string, StepId> = {
  // Old 8-step wizard → new 5-step wizard
  permissions: "connection",
  open_in_admin: "connection",
  overview: "connection",
  welcome_goals: "connection",
  disputes: "coverage",
  sync_disputes: "coverage",
  packs: "coverage",
  evidence_sources: "coverage",
  business_policies: "policies",
  rules: "automation",
  automation_rules: "automation",
  team: "activate",
  team_notifications: "activate",
};

export function getNextActionableStep(
  stepsMap: Partial<Record<StepId, { status: string }>>
): StepId | null {
  for (const step of SETUP_STEPS) {
    const state = stepsMap[step.id];
    const status = state?.status ?? "todo";
    if (status === "todo" || status === "in_progress") {
      return step.id;
    }
  }
  return null;
}

/** Returns the next incomplete step within the wizard flow (WIZARD_STEP_IDS only). */
export function getNextWizardStep(
  stepsMap: Partial<Record<StepId, { status: string }>>
): StepId | null {
  for (const id of WIZARD_STEP_IDS) {
    const status = stepsMap[id]?.status ?? "todo";
    if (status === "todo" || status === "in_progress") {
      return id;
    }
  }
  return null;
}

export function isPrerequisiteMet(
  stepId: StepId,
  stepsMap: Partial<Record<StepId, { status: string }>>
): boolean {
  const def = STEP_BY_ID[stepId];
  if (!def) return false;
  // All steps have empty prerequisites in the new wizard — always met.
  return def.prerequisites.every((preId) => {
    const state = stepsMap[preId];
    return state?.status === "done";
  });
}
