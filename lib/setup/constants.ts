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

/** Wizard steps for onboarding (connect → goals → disputes → packs → rules → policies → team). Billing, settings, and help are app sections only, not part of setup. */
export const SETUP_STEPS: StepDefinition[] = [
  {
    id: "permissions",
    index: 1,
    title: "Connect your store",
    dashboardLabel: "Connect your store",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Access order and customer data for evidence",
      "Read and respond to disputes",
      "Upload evidence documents automatically",
      "Secure, read-only access where possible",
    ],
  },
  {
    id: "open_in_admin",
    index: 2,
    title: "Open in Shopify Admin",
    dashboardLabel: "Open in Shopify Admin",
    timeEstimate: "1 min",
    prerequisites: ["permissions"],
    unlocks: [
      "Pin the app for quick access",
      "Use DisputeDesk from your Admin sidebar",
    ],
  },
  {
    id: "overview",
    index: 3,
    title: "Overview & Goals",
    dashboardLabel: "Set your goals",
    timeEstimate: "1 min",
    prerequisites: ["permissions", "open_in_admin"],
    unlocks: [
      "Personalized setup based on your goals",
      "Optimized workflows for your use case",
      "Relevant recommendations and tips",
    ],
  },
  {
    id: "disputes",
    index: 4,
    title: "Disputes",
    dashboardLabel: "Sync disputes",
    timeEstimate: "2 min",
    prerequisites: ["permissions"],
    unlocks: [
      "View all disputes in one place",
      "Track due dates and deadlines",
      "Auto-import new disputes daily",
      "Historical data for trends and insights",
    ],
  },
  {
    id: "packs",
    index: 5,
    title: "Evidence Packs",
    dashboardLabel: "Evidence packs",
    timeEstimate: "2 min",
    prerequisites: ["disputes"],
    unlocks: [
      "Auto-build evidence for each dispute",
      "Templates for common dispute types",
      "Complete evidence packs automatically",
    ],
  },
  {
    id: "rules",
    index: 6,
    title: "Automation Rules",
    dashboardLabel: "Configure automation",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Hands-free dispute handling",
      "Never miss a submission deadline",
      "Consistent, high-quality responses",
      "Full control and oversight",
    ],
  },
  {
    id: "policies",
    index: 7,
    title: "Business Policies",
    dashboardLabel: "Add business policies",
    timeEstimate: "2 min",
    prerequisites: ["disputes"],
    unlocks: [
      "Auto-fill policy information in evidence",
      "Consistent, professional documentation",
      "Strengthen evidence with clear terms",
      "Easy updates when policies change",
    ],
  },
  {
    id: "team",
    index: 8,
    title: "Team & Notifications",
    dashboardLabel: "Invite team members",
    timeEstimate: "1 min",
    prerequisites: [],
    unlocks: [
      "Collaborate with your team",
      "Stay informed on critical updates",
      "Slack integration for real-time alerts",
      "Customizable notification preferences",
    ],
  },
];

export const STEP_IDS: StepId[] = SETUP_STEPS.map((s) => s.id);

export const STEP_BY_ID = Object.fromEntries(
  SETUP_STEPS.map((s) => [s.id, s])
) as Record<StepId, StepDefinition>;

export const TOTAL_STEPS = SETUP_STEPS.length;

/** Map legacy step ids to new step ids for migration of shop_setup.steps */
export const LEGACY_STEP_ID_MAP: Record<string, StepId> = {
  welcome_goals: "overview",
  sync_disputes: "disputes",
  business_policies: "policies",
  evidence_sources: "packs",
  automation_rules: "rules",
  team_notifications: "team",
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

export function isPrerequisiteMet(
  stepId: StepId,
  stepsMap: Partial<Record<StepId, { status: string }>>
): boolean {
  const def = STEP_BY_ID[stepId];
  if (!def) return false;
  return def.prerequisites.every((preId) => {
    const state = stepsMap[preId];
    return state?.status === "done";
  });
}
