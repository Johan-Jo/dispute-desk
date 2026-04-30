/**
 * Action fired by EmbeddedTourOverlay's Next button before advancing.
 *  - "click": dispatch a click on the matching element (used to switch
 *    between dispute detail tabs without navigating).
 *  - "navigateToFirstDispute": resolve the most recent dispute id from
 *    the client-side global window.__ddFirstDisputeId (published by the
 *    disputes list page) and router.push to /app/disputes/{id}.
 *    If unset, the overlay surfaces a "no disputes yet" empty card
 *    and ends the tour gracefully.
 */
export type OnboardingNextAction =
  | { type: "click"; selector: string }
  | { type: "navigateToFirstDispute" };

export interface OnboardingStep {
  id: string;
  route: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  spotlight?: boolean;
  /** Action fired when the merchant clicks Next on this step. */
  onNext?: OnboardingNextAction;
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
