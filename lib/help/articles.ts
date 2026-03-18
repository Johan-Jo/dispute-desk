export interface HelpArticle {
  slug: string;
  category: string;
  titleKey: string;
  bodyKey: string;
  relatedSlugs?: string[];
  tags?: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  // --- Getting Started ---
  {
    slug: "connect-shopify-store",
    category: "getting-started",
    titleKey: "help.articles.connectShopifyStore.title",
    bodyKey: "help.articles.connectShopifyStore.body",
    relatedSlugs: ["first-dispute-sync", "understanding-dashboard"],
    tags: ["connect", "install", "shopify", "oauth", "setup", "reconnect", "permissions", "reauthorize"],
  },
  {
    slug: "understanding-dashboard",
    category: "getting-started",
    titleKey: "help.articles.understandingDashboard.title",
    bodyKey: "help.articles.understandingDashboard.body",
    relatedSlugs: ["connect-shopify-store", "automation-overview"],
    tags: ["dashboard", "overview", "metrics", "kpi"],
  },
  {
    slug: "first-dispute-sync",
    category: "getting-started",
    titleKey: "help.articles.firstDisputeSync.title",
    bodyKey: "help.articles.firstDisputeSync.body",
    relatedSlugs: ["syncing-disputes", "connect-shopify-store"],
    tags: ["sync", "first", "import", "disputes"],
  },
  {
    slug: "automation-overview",
    category: "getting-started",
    titleKey: "help.articles.automationOverview.title",
    bodyKey: "help.articles.automationOverview.body",
    relatedSlugs: ["configuring-automation", "creating-first-rule"],
    tags: ["automation", "auto-build", "auto-save", "pipeline"],
  },

  // --- Disputes ---
  {
    slug: "viewing-filtering-disputes",
    category: "disputes",
    titleKey: "help.articles.viewingFilteringDisputes.title",
    bodyKey: "help.articles.viewingFilteringDisputes.body",
    relatedSlugs: ["review-queue", "syncing-disputes"],
    tags: ["view", "filter", "list", "status", "search"],
  },
  {
    slug: "syncing-disputes",
    category: "disputes",
    titleKey: "help.articles.syncingDisputes.title",
    bodyKey: "help.articles.syncingDisputes.body",
    relatedSlugs: ["first-dispute-sync", "viewing-filtering-disputes"],
    tags: ["sync", "refresh", "webhook", "cron"],
  },
  {
    slug: "review-queue",
    category: "disputes",
    titleKey: "help.articles.reviewQueue.title",
    bodyKey: "help.articles.reviewQueue.body",
    relatedSlugs: ["approving-disputes", "creating-first-rule"],
    tags: ["review", "queue", "manual", "approval"],
  },
  {
    slug: "approving-disputes",
    category: "disputes",
    titleKey: "help.articles.approvingDisputes.title",
    bodyKey: "help.articles.approvingDisputes.body",
    relatedSlugs: ["review-queue", "how-packs-built"],
    tags: ["approve", "review", "override", "manual"],
  },

  // --- Evidence Packs ---
  {
    slug: "how-packs-built",
    category: "evidence-packs",
    titleKey: "help.articles.howPacksBuilt.title",
    bodyKey: "help.articles.howPacksBuilt.body",
    relatedSlugs: ["generating-pack-manually", "completeness-score"],
    tags: ["automatic", "build", "pipeline", "evidence", "order", "tracking"],
  },
  {
    slug: "generating-pack-manually",
    category: "evidence-packs",
    titleKey: "help.articles.generatingPackManually.title",
    bodyKey: "help.articles.generatingPackManually.body",
    relatedSlugs: ["how-packs-built", "uploading-evidence"],
    tags: ["manual", "generate", "create", "button"],
  },
  {
    slug: "completeness-score",
    category: "evidence-packs",
    titleKey: "help.articles.completenessScore.title",
    bodyKey: "help.articles.completenessScore.body",
    relatedSlugs: ["fixing-blockers", "evidence-checklist"],
    tags: ["score", "completeness", "percentage", "threshold"],
  },
  {
    slug: "fixing-blockers",
    category: "evidence-packs",
    titleKey: "help.articles.fixingBlockers.title",
    bodyKey: "help.articles.fixingBlockers.body",
    relatedSlugs: ["completeness-score", "uploading-evidence"],
    tags: ["blocker", "required", "missing", "fix"],
  },
  {
    slug: "uploading-evidence",
    category: "evidence-packs",
    titleKey: "help.articles.uploadingEvidence.title",
    bodyKey: "help.articles.uploadingEvidence.body",
    relatedSlugs: ["fixing-blockers", "evidence-checklist"],
    tags: ["upload", "file", "image", "pdf", "drag", "drop"],
  },
  {
    slug: "evidence-checklist",
    category: "evidence-packs",
    titleKey: "help.articles.evidenceChecklist.title",
    bodyKey: "help.articles.evidenceChecklist.body",
    relatedSlugs: ["completeness-score", "how-packs-built"],
    tags: ["checklist", "required", "recommended", "items"],
  },
  {
    slug: "evidence-pack-templates",
    category: "evidence-packs",
    titleKey: "help.articles.evidencePackTemplates.title",
    bodyKey: "help.articles.evidencePackTemplates.body",
    relatedSlugs: ["how-packs-built", "generating-pack-manually", "template-setup-wizard"],
    tags: ["template", "library", "install", "packs", "recommended"],
  },
  {
    slug: "template-setup-wizard",
    category: "evidence-packs",
    titleKey: "help.articles.templateSetupWizard.title",
    bodyKey: "help.articles.templateSetupWizard.body",
    relatedSlugs: ["evidence-pack-templates", "how-packs-built"],
    tags: ["template", "wizard", "setup", "customize", "evidence", "activate"],
  },
  {
    slug: "defining-store-policies",
    category: "evidence-packs",
    titleKey: "help.articles.definingStorePolicies.title",
    bodyKey: "help.articles.definingStorePolicies.body",
    relatedSlugs: ["how-packs-built", "evidence-checklist"],
    tags: [
      "policies",
      "terms",
      "refund",
      "shipping",
      "upload",
      "template",
      "preview template",
      "required",
      "optional",
      "back to options",
      "mix and match",
      "link url",
      "upload file",
      "best of both worlds",
      "txt upload",
      "markdown upload",
      "template failed to load",
      "shop reconnect",
    ],
  },

  // --- Automation & Rules ---
  {
    slug: "configuring-automation",
    category: "automation-rules",
    titleKey: "help.articles.configuringAutomation.title",
    bodyKey: "help.articles.configuringAutomation.body",
    relatedSlugs: ["automation-overview", "completeness-blocker-gates"],
    tags: ["settings", "auto-build", "auto-save", "toggle", "configure"],
  },
  {
    slug: "creating-first-rule",
    category: "automation-rules",
    titleKey: "help.articles.creatingFirstRule.title",
    bodyKey: "help.articles.creatingFirstRule.body",
    relatedSlugs: ["rule-priority", "review-queue"],
    tags: ["rule", "create", "match", "action", "auto-pack"],
  },
  {
    slug: "rule-priority",
    category: "automation-rules",
    titleKey: "help.articles.rulePriority.title",
    bodyKey: "help.articles.rulePriority.body",
    relatedSlugs: ["creating-first-rule", "configuring-automation"],
    tags: ["priority", "order", "first", "match", "evaluation"],
  },
  {
    slug: "completeness-blocker-gates",
    category: "automation-rules",
    titleKey: "help.articles.completenessBlockerGates.title",
    bodyKey: "help.articles.completenessBlockerGates.body",
    relatedSlugs: ["configuring-automation", "completeness-score"],
    tags: ["gate", "threshold", "blocker", "completeness", "auto-save"],
  },
  {
    slug: "rule-presets",
    category: "automation-rules",
    titleKey: "help.articles.rulePresets.title",
    bodyKey: "help.articles.rulePresets.body",
    relatedSlugs: ["creating-first-rule", "configuring-automation"],
    tags: ["preset", "suggested", "install", "auto-pack", "review"],
  },

  // --- Billing & Plans ---
  {
    slug: "plan-comparison",
    category: "billing",
    titleKey: "help.articles.planComparison.title",
    bodyKey: "help.articles.planComparison.body",
    relatedSlugs: ["upgrading-plan", "pack-limits"],
    tags: ["plan", "free", "starter", "pro", "compare", "features"],
  },
  {
    slug: "upgrading-plan",
    category: "billing",
    titleKey: "help.articles.upgradingPlan.title",
    bodyKey: "help.articles.upgradingPlan.body",
    relatedSlugs: ["plan-comparison", "trial-period"],
    tags: ["upgrade", "billing", "payment", "shopify"],
  },
  {
    slug: "pack-limits",
    category: "billing",
    titleKey: "help.articles.packLimits.title",
    bodyKey: "help.articles.packLimits.body",
    relatedSlugs: ["plan-comparison", "upgrading-plan"],
    tags: ["limit", "quota", "monthly", "usage", "packs"],
  },
  {
    slug: "trial-period",
    category: "billing",
    titleKey: "help.articles.trialPeriod.title",
    bodyKey: "help.articles.trialPeriod.body",
    relatedSlugs: ["upgrading-plan", "plan-comparison"],
    tags: ["trial", "free", "7 days", "test"],
  },
  {
    slug: "store-session-upgrade",
    category: "billing",
    titleKey: "help.articles.storeSessionUpgrade.title",
    bodyKey: "help.articles.storeSessionUpgrade.body",
    relatedSlugs: ["upgrading-plan", "connect-shopify-store"],
    tags: ["upgrade", "billing", "reconnect", "store session", "shopify admin"],
  },

  // --- Saving to Shopify ---
  {
    slug: "how-evidence-saved",
    category: "saving-to-shopify",
    titleKey: "help.articles.howEvidenceSaved.title",
    bodyKey: "help.articles.howEvidenceSaved.body",
    relatedSlugs: ["field-mapping", "after-saving"],
    tags: ["save", "shopify", "api", "evidence", "fields"],
  },
  {
    slug: "field-mapping",
    category: "saving-to-shopify",
    titleKey: "help.articles.fieldMapping.title",
    bodyKey: "help.articles.fieldMapping.body",
    relatedSlugs: ["how-evidence-saved", "evidence-checklist"],
    tags: ["field", "mapping", "sections", "shopify", "evidence"],
  },
  {
    slug: "after-saving",
    category: "saving-to-shopify",
    titleKey: "help.articles.afterSaving.title",
    bodyKey: "help.articles.afterSaving.body",
    relatedSlugs: ["how-evidence-saved", "not-submit-to-networks"],
    tags: ["after", "saved", "next", "shopify admin", "review"],
  },
  {
    slug: "not-submit-to-networks",
    category: "saving-to-shopify",
    titleKey: "help.articles.notSubmitToNetworks.title",
    bodyKey: "help.articles.notSubmitToNetworks.body",
    relatedSlugs: ["how-evidence-saved", "after-saving"],
    tags: ["submit", "card network", "visa", "mastercard", "compliance"],
  },
];

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function getArticlesByCategory(category: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}
