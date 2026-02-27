import type { OnboardingStep } from "@/lib/onboarding-config";

export const HELP_GUIDE_IDS = [
  "review-dispute",
  "build-pack",
  "automation-rules",
  "install-template",
  "configure-policies",
  "pack-builder-advanced",
] as const;

export type HelpGuideId = (typeof HELP_GUIDE_IDS)[number];

export function isHelpGuideId(id: string): id is HelpGuideId {
  return HELP_GUIDE_IDS.includes(id as HelpGuideId);
}

// ---------------------------------------------------------------------------
// Portal guide step definitions (multi-step tours matching Figma)
// ---------------------------------------------------------------------------

const PORTAL_GUIDE_STEPS: Record<HelpGuideId, OnboardingStep[]> = {
  "review-dispute": [
    {
      id: "intro",
      route: "/portal/disputes",
      position: "center",
    },
    {
      id: "disputeTabs",
      route: "/portal/disputes",
      targetSelector: '[data-onboarding="disputes-tabs"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "disputesTable",
      route: "/portal/disputes",
      targetSelector: '[data-onboarding="disputes-table"]',
      position: "top",
      spotlight: true,
    },
    {
      id: "disputeRow",
      route: "/portal/disputes",
      targetSelector: '[data-onboarding="dispute-row"]',
      position: "left",
      spotlight: true,
    },
  ],
  "build-pack": [
    {
      id: "intro",
      route: "/portal/packs",
      position: "center",
    },
    {
      id: "packsGrid",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="packs-grid"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "createPackBtn",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="create-pack-button"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "templateBtn",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="template-library-button"]',
      position: "bottom",
      spotlight: true,
    },
  ],
  "automation-rules": [
    {
      id: "intro",
      route: "/portal/rules",
      position: "center",
    },
    {
      id: "rulesHeader",
      route: "/portal/rules",
      targetSelector: '[data-onboarding="rules-header"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "createRuleBtn",
      route: "/portal/rules",
      targetSelector: '[data-onboarding="create-rule-button"]',
      position: "left",
      spotlight: true,
    },
    {
      id: "rulesList",
      route: "/portal/rules",
      targetSelector: '[data-onboarding="rules-list"]',
      position: "top",
      spotlight: true,
    },
  ],
  "install-template": [
    {
      id: "intro",
      route: "/portal/packs",
      position: "center",
    },
    {
      id: "templateBtn",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="template-library-button"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "packsGrid",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="packs-grid"]',
      position: "top",
      spotlight: true,
    },
  ],
  "configure-policies": [
    {
      id: "intro",
      route: "/portal/policies",
      position: "center",
    },
    {
      id: "addPolicyBtn",
      route: "/portal/policies",
      targetSelector: '[data-onboarding="add-policy-button"]',
      position: "bottom",
      spotlight: true,
    },
    {
      id: "policyDocuments",
      route: "/portal/policies",
      targetSelector: '[data-onboarding="policy-documents"]',
      position: "top",
      spotlight: true,
    },
  ],
  "pack-builder-advanced": [
    {
      id: "intro",
      route: "/portal/packs",
      position: "center",
    },
    {
      id: "packsGrid",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="packs-grid"]',
      position: "top",
      spotlight: true,
    },
    {
      id: "packRow",
      route: "/portal/packs",
      targetSelector: '[data-onboarding="pack-row"]',
      position: "left",
      spotlight: true,
    },
  ],
};

export function getPortalGuideSteps(guideId: HelpGuideId): OnboardingStep[] {
  return PORTAL_GUIDE_STEPS[guideId] ?? [];
}

// ---------------------------------------------------------------------------
// Embedded app guide steps (lightweight versions)
// ---------------------------------------------------------------------------

const EMBEDDED_GUIDE_STEPS: Record<HelpGuideId, OnboardingStep[]> = {
  "review-dispute": [
    { id: "intro", route: "/app/disputes", position: "center" },
    {
      id: "disputesTable",
      route: "/app/disputes",
      targetSelector: '[data-help-guide="disputes-table"]',
      position: "bottom",
      spotlight: false,
    },
  ],
  "build-pack": [
    { id: "intro", route: "/app/disputes", position: "center" },
    {
      id: "disputesTable",
      route: "/app/disputes",
      targetSelector: '[data-help-guide="disputes-table"]',
      position: "bottom",
      spotlight: false,
    },
  ],
  "automation-rules": [
    { id: "intro", route: "/app", position: "center" },
  ],
  "install-template": [
    { id: "intro", route: "/app", position: "center" },
  ],
  "configure-policies": [
    { id: "intro", route: "/app", position: "center" },
  ],
  "pack-builder-advanced": [
    { id: "intro", route: "/app", position: "center" },
  ],
};

export function getEmbeddedGuideSteps(guideId: HelpGuideId): OnboardingStep[] {
  return EMBEDDED_GUIDE_STEPS[guideId] ?? [];
}

// ---------------------------------------------------------------------------
// Translation helpers
// ---------------------------------------------------------------------------

export const HELP_TRANSLATION_NAMESPACE = "help";

const GUIDE_ID_TO_KEY_PREFIX: Record<HelpGuideId, string> = {
  "review-dispute": "guides.reviewDispute",
  "build-pack": "guides.buildPack",
  "automation-rules": "guides.automationRules",
  "install-template": "guides.installTemplate",
  "configure-policies": "guides.configurePolicies",
  "pack-builder-advanced": "guides.packBuilderAdvanced",
};

export function getPortalGuideTranslationKeyPrefix(guideId: HelpGuideId): string {
  return GUIDE_ID_TO_KEY_PREFIX[guideId];
}
