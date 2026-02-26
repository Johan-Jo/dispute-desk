export interface OnboardingStep {
  id: string;
  route: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  spotlight?: boolean;
}

export const onboardingSteps: OnboardingStep[] = [
  {
    id: "welcome",
    route: "/portal/dashboard",
    position: "center",
  },
  {
    id: "dashboard",
    route: "/portal/dashboard",
    targetSelector: '[data-onboarding="dashboard-stats"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "disputesList",
    route: "/portal/disputes",
    targetSelector: '[data-onboarding="disputes-table"]',
    position: "top",
    spotlight: true,
  },
  {
    id: "evidencePacks",
    route: "/portal/packs",
    targetSelector: '[data-onboarding="packs-grid"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "automationRules",
    route: "/portal/rules",
    targetSelector: '[data-onboarding="rules-header"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "policies",
    route: "/portal/policies",
    targetSelector: '[data-onboarding="policy-documents"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "complete",
    route: "/portal/dashboard",
    targetSelector: '[data-onboarding="connect-store"]',
    position: "right",
    spotlight: true,
  },
];
