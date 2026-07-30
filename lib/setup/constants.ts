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

/** Wizard steps: Connection → Store Profile → Handling → Policies → Activate. */
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
    id: "handling",
    index: 2,
    title: "Handling",
    dashboardLabel: "How disputes are handled",
    timeEstimate: "2 min",
    prerequisites: [],
    unlocks: [
      "Hands-free dispute handling",
      "Safeguards for high-value disputes",
      "Playbooks matched to your store",
    ],
  },
  {
    id: "policies",
    index: 3,
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
    index: 4,
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

/** All 5 steps are shown in the wizard flow (no separate welcome/pre-steps). */
export const WIZARD_STEP_IDS: StepId[] = ["connection", "store_profile", "handling", "policies", "activate"];

/** All 5 steps shown in the wizard top stepper bar. */
export const WIZARD_STEPPER_IDS: StepId[] = ["connection", "store_profile", "handling", "policies", "activate"];

export const TOTAL_WIZARD_STEPS = WIZARD_STEP_IDS.length;

/**
 * Map legacy step ids to current step ids when reading shop_setup.steps.
 *
 * Many→one by design; `migrateStepsMap` in app/api/setup/state/route.ts
 * resolves collisions by status precedence so a less-complete alias can never
 * clobber a more-complete canonical entry (the bug that once wedged the
 * wizard via a lingering `team:{todo}` landing on `activate:{done}`).
 *
 * `coverage` and `automation` both fold into `handling` (2026-07-27). Every
 * alias that used to point at either of those has been repointed here — an
 * alias left pointing at a removed id would silently drop that step's state.
 */
export const LEGACY_STEP_ID_MAP: Record<string, StepId> = {
  // Old 8-step wizard → current 5-step wizard
  permissions: "connection",
  open_in_admin: "connection",
  overview: "connection",
  welcome_goals: "connection",
  // The merged step
  coverage: "handling",
  automation: "handling",
  // Previously → "coverage"
  disputes: "handling",
  sync_disputes: "handling",
  packs: "handling",
  evidence_sources: "handling",
  // Previously → "automation"
  rules: "handling",
  automation_rules: "handling",
  business_policies: "policies",
  team: "activate",
  team_notifications: "activate",
};

/**
 * Resolve an incoming step id to a canonical one, tolerating legacy aliases
 * and separator/casing drift. Returns null for genuinely unknown ids.
 *
 * Three classes of input have to survive:
 *   1. Legacy ids — a stale tab or bookmark posting `coverage`/`automation`
 *      after the 6→5 merge. Rejecting those strands the merchant mid-wizard.
 *   2. Separator drift — `store-profile` vs `store_profile`. Hyphens read as
 *      natural in a URL and every hand-written link gets this wrong sooner or
 *      later; the wizard rendered a blank "Setup Wizard" card when it did.
 *   3. Casing/whitespace from hand-edited URLs.
 *
 * Normalising here (rather than at each of the four call sites) keeps the
 * tolerance in one place — the page, POST /step, POST /skip and the portal
 * wizard all route through this.
 */
export function resolveStepId(raw: unknown): StepId | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  if (normalized.length === 0) return null;
  if (STEP_IDS.includes(normalized as StepId)) return normalized as StepId;
  return LEGACY_STEP_ID_MAP[normalized] ?? null;
}

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
