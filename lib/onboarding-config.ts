export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  route: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  spotlight?: boolean;
}

export const onboardingSteps: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to DisputeDesk! \u{1F44B}",
    description:
      "Let's take a quick tour to help you get started with managing your Shopify chargebacks efficiently. This will only take 2 minutes.",
    route: "/portal/dashboard",
    position: "center",
  },
  {
    id: "dashboard",
    title: "Your Command Center",
    description:
      "This is your dashboard where you can see all your key metrics at a glance: active disputes, win rate, evidence packs used, and upcoming deadlines.",
    route: "/portal/dashboard",
    targetSelector: '[data-onboarding="dashboard-stats"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "disputes-list",
    title: "Manage All Disputes",
    description:
      "View and manage all your disputes in one place. Filter by status, sort by priority, and quickly see which disputes need your attention.",
    route: "/portal/disputes",
    targetSelector: '[data-onboarding="disputes-table"]',
    position: "top",
    spotlight: true,
  },
  {
    id: "evidence-packs",
    title: "Evidence Packs Library",
    description:
      "Create reusable evidence templates for different dispute types. Each pack contains all the documents needed to fight a specific type of chargeback.",
    route: "/portal/packs",
    targetSelector: '[data-onboarding="packs-grid"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "automation-rules",
    title: "Automate with Rules",
    description:
      "Set up automation rules to automatically attach evidence packs, send notifications, or flag urgent disputes based on custom conditions.",
    route: "/portal/rules",
    targetSelector: '[data-onboarding="rules-header"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "policies",
    title: "Store Policy Documents",
    description:
      "Upload and manage your store policies (Terms of Service, Refund Policy, etc.) to quickly include them as evidence in disputes.",
    route: "/portal/policies",
    targetSelector: '[data-onboarding="policy-documents"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "complete",
    title: "You're All Set! \u{1F389}",
    description:
      "You now know the basics of DisputeDesk. Start by creating your first evidence pack, or let our automation rules do the work for you. Need help? Check out our documentation or contact support.",
    route: "/portal/dashboard",
    position: "center",
  },
];
