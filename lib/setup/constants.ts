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

export const SETUP_STEPS: StepDefinition[] = [
  {
    id: "welcome_goals",
    index: 1,
    title: "Welcome & Goals",
    dashboardLabel: "Set your goals",
    timeEstimate: "1 min",
    prerequisites: [],
    unlocks: [
      "Personalized setup based on your goals",
      "Optimized workflows for your use case",
      "Relevant recommendations and tips",
    ],
  },
  {
    id: "permissions",
    index: 2,
    title: "Permissions",
    dashboardLabel: "Verify permissions",
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
    id: "sync_disputes",
    index: 3,
    title: "Sync Disputes",
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
    id: "business_policies",
    index: 4,
    title: "Business Policies",
    dashboardLabel: "Add business policies",
    timeEstimate: "2 min",
    prerequisites: ["sync_disputes"],
    unlocks: [
      "Auto-fill policy information in evidence",
      "Consistent, professional documentation",
      "Strengthen evidence with clear terms",
      "Easy updates when policies change",
    ],
  },
  {
    id: "evidence_sources",
    index: 5,
    title: "Evidence Sources",
    dashboardLabel: "Connect evidence sources",
    timeEstimate: "2 min",
    prerequisites: ["business_policies"],
    unlocks: [
      "Automatic tracking and delivery proof",
      "Customer communication history",
      "Complete evidence packs automatically",
      "Save hours of manual work per dispute",
    ],
  },
  {
    id: "automation_rules",
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
    id: "team_notifications",
    index: 7,
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
