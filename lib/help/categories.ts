export interface HelpCategory {
  slug: string;
  labelKey: string;
  descriptionKey: string;
  icon: "rocket" | "scale" | "package" | "zap" | "creditCard" | "upload";
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: "getting-started",
    labelKey: "help.categories.gettingStarted",
    descriptionKey: "help.categories.gettingStartedDesc",
    icon: "rocket",
  },
  {
    slug: "disputes",
    labelKey: "help.categories.disputes",
    descriptionKey: "help.categories.disputesDesc",
    icon: "scale",
  },
  {
    slug: "lifecycle",
    labelKey: "help.categories.lifecycle",
    descriptionKey: "help.categories.lifecycleDesc",
    icon: "rocket",
  },
  {
    slug: "evidence-packs",
    labelKey: "help.categories.evidencePacks",
    descriptionKey: "help.categories.evidencePacksDesc",
    icon: "package",
  },
  {
    slug: "automation-rules",
    labelKey: "help.categories.automationRules",
    descriptionKey: "help.categories.automationRulesDesc",
    icon: "zap",
  },
  {
    slug: "billing",
    labelKey: "help.categories.billing",
    descriptionKey: "help.categories.billingDesc",
    icon: "creditCard",
  },
  {
    slug: "saving-to-shopify",
    labelKey: "help.categories.savingToShopify",
    descriptionKey: "help.categories.savingToShopifyDesc",
    icon: "upload",
  },
];

export function getCategoryBySlug(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.slug === slug);
}
