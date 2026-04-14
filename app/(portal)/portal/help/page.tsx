"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import { HELP_CATEGORIES } from "@/lib/help/categories";
import { HELP_ARTICLES, getArticlesByCategory } from "@/lib/help/articles";
import {
  HELP_GUIDE_IDS,
  isHelpGuideId,
  type HelpGuideId,
} from "@/lib/help-guides-config";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Book,
  PlayCircle,
  Package,
  Shield,
  Settings,
  CreditCard,
  Zap,
  ChevronRight,
  ChevronDown,
  Clock,
  CheckCircle2,
  MessageCircle,
  Lightbulb,
  ExternalLink,
  Rocket,
  Upload,
} from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  "getting-started": "#1D4ED8",
  disputes: "#F59E0B",
  "evidence-packs": "#22C55E",
  "automation-rules": "#8B5CF6",
  billing: "#06B6D4",
  "saving-to-shopify": "#EC4899",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "getting-started": Zap,
  disputes: Shield,
  "evidence-packs": Package,
  "automation-rules": Settings,
  billing: CreditCard,
  "saving-to-shopify": Upload,
};

interface InteractiveTourMeta {
  id: HelpGuideId;
  titleKey: string;
  descriptionKey: string;
  duration: string;
  recommended: boolean;
}

const INTERACTIVE_TOURS: InteractiveTourMeta[] = [
  {
    id: "review-dispute",
    titleKey: "help.tours.reviewDispute.title",
    descriptionKey: "help.tours.reviewDispute.description",
    duration: "5 min",
    recommended: true,
  },
  {
    id: "build-pack",
    titleKey: "help.tours.buildPack.title",
    descriptionKey: "help.tours.buildPack.description",
    duration: "3 min",
    recommended: true,
  },
  {
    id: "automation-rules",
    titleKey: "help.tours.automationRules.title",
    descriptionKey: "help.tours.automationRules.description",
    duration: "3 min",
    recommended: true,
  },
  {
    id: "install-template",
    titleKey: "help.tours.installTemplate.title",
    descriptionKey: "help.tours.installTemplate.description",
    duration: "2 min",
    recommended: true,
  },
  {
    id: "configure-policies",
    titleKey: "help.tours.configurePolicies.title",
    descriptionKey: "help.tours.configurePolicies.description",
    duration: "2 min",
    recommended: false,
  },
  {
    id: "pack-builder-advanced",
    titleKey: "help.tours.packBuilderAdvanced.title",
    descriptionKey: "help.tours.packBuilderAdvanced.description",
    duration: "4 min",
    recommended: false,
  },
];

interface QuickTask {
  id: string;
  titleKey: string;
  guideId: (typeof HELP_GUIDE_IDS)[number];
  icon: React.ElementType;
}

const QUICK_TASKS: QuickTask[] = [
  { id: "qt-pack", titleKey: "help.quickTasks.createPack", guideId: "build-pack", icon: Package },
  { id: "qt-dispute", titleKey: "help.quickTasks.handleDispute", guideId: "review-dispute", icon: Shield },
  { id: "qt-rule", titleKey: "help.quickTasks.createRule", guideId: "automation-rules", icon: Settings },
];

function PortalHelpContent() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const helpGuide = useHelpGuideSafe();
  const [query, setQuery] = useState("");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  useEffect(() => {
    const guide = searchParams?.get("guide");
    if (guide && isHelpGuideId(guide) && helpGuide) {
      const timer = setTimeout(() => helpGuide.startGuide(guide), 300);
      return () => clearTimeout(timer);
    }
  }, [searchParams, helpGuide]);

  const filteredArticles = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return HELP_ARTICLES.filter((a) => {
      const title = t(a.titleKey).toLowerCase();
      const tags = a.tags?.join(" ").toLowerCase() ?? "";
      return title.includes(q) || tags.includes(q);
    });
  }, [query, t]);

  return (
    <div className="h-full flex flex-col bg-[#F6F8FB]">
      {/* Gradient header — matches Figma Help Center header */}
      <div className="bg-gradient-to-br from-[#3b82f6] via-[#60a5fa] to-[#93c5fd] text-white p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white opacity-10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#22C55E] opacity-10 rounded-full blur-3xl" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Book className="w-6 h-6" />
            <h1 className="text-3xl font-bold">{t("help.title")}</h1>
          </div>
          <p className="text-white/90 mb-6 max-w-2xl">{t("help.subtitle")}</p>

          <div className="relative max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/60" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("help.search")}
              className="w-full pl-12 pr-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/50"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-8">
          {/* Search results overlay */}
          {filteredArticles ? (
            <div>
              {filteredArticles.length === 0 ? (
                <p className="text-center text-[#667085] py-12">{t("help.noResults")}</p>
              ) : (
                <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                  {filteredArticles.map((a) => (
                    <Link
                      key={a.slug}
                      href={`/portal/help/${a.slug}`}
                      className="block px-5 py-4 hover:bg-[#F6F8FB] transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-[#0B1220] group-hover:text-[#1D4ED8] transition-colors">
                            {t(a.titleKey)}
                          </p>
                          <p className="text-xs text-[#94A3B8] mt-0.5 capitalize">
                            {t(HELP_CATEGORIES.find((c) => c.slug === a.category)?.labelKey ?? "")}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[#667085] group-hover:text-[#1D4ED8] group-hover:translate-x-1 transition-all flex-shrink-0 ml-4" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Quick Tasks */}
              {helpGuide && (
                <div>
                  <h2 className="text-lg font-semibold text-[#0B1220] mb-4">
                    {t("help.quickTasksTitle")}
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {QUICK_TASKS.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => helpGuide.startGuide(task.guideId)}
                        className="bg-white border border-[#E5E7EB] rounded-lg p-4 hover:border-[#1D4ED8] hover:shadow-sm transition-all text-left group"
                      >
                        <task.icon className="w-6 h-6 text-[#1D4ED8] mb-2 group-hover:scale-110 transition-transform" />
                        <p className="text-sm font-medium text-[#0B1220]">{t(task.titleKey)}</p>
                        <p className="text-xs text-[#667085] mt-1">{t("help.interactiveGuideLabel")}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Tours */}
              <div>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[#0B1220]">
                    {t("help.interactiveGuidesTitle")}
                  </h2>
                  <p className="text-sm text-[#667085]">{t("help.interactiveGuidesDesc")}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {INTERACTIVE_TOURS.map((tour) => (
                      <div
                        key={tour.id}
                        className="bg-white rounded-xl border border-[#E5E7EB] p-5 hover:border-[#1D4ED8]/30 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#1D4ED8] to-[#1e40af] flex items-center justify-center">
                              <PlayCircle className="w-6 h-6 text-white" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-[#0B1220]">{t(tour.titleKey)}</h3>
                              {tour.recommended && (
                                <Badge variant="primary" className="text-xs">
                                  {t("help.recommended")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-[#667085] mb-3">{t(tour.descriptionKey)}</p>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1 text-xs text-[#667085]">
                                <Clock className="w-3.5 h-3.5" />
                                {tour.duration}
                              </span>
                              {helpGuide ? (
                                <button
                                  type="button"
                                  onClick={() => helpGuide.startGuide(tour.id)}
                                  className="px-3 py-1.5 text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1e40af] rounded-lg transition-colors"
                                >
                                  {t("help.startTour")}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Browse by Topic */}
              <div>
                <h2 className="text-lg font-semibold text-[#0B1220] mb-4">{t("help.browseByTopic")}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {HELP_CATEGORIES.map((cat) => {
                    const Icon = CATEGORY_ICONS[cat.slug] ?? Rocket;
                    const color = CATEGORY_COLORS[cat.slug] ?? "#1D4ED8";
                    const count = getArticlesByCategory(cat.slug).length;
                    return (
                      <a
                        key={cat.slug}
                        href={`#docs-${cat.slug}`}
                        className="bg-white border border-[#E5E7EB] rounded-lg p-5 hover:border-[#1D4ED8] hover:shadow-sm transition-all text-left group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: `${color}15` }}
                          >
                            <Icon className="w-5 h-5" style={{ color }} />
                          </div>
                          <ChevronRight className="w-5 h-5 text-[#667085] group-hover:text-[#1D4ED8] group-hover:translate-x-1 transition-all" />
                        </div>
                        <h3 className="font-semibold text-[#0B1220] mb-2">{t(cat.labelKey)}</h3>
                        <p className="text-xs text-[#667085]">
                          {t("help.articleCount", { count })}
                        </p>
                      </a>
                    );
                  })}
                </div>
              </div>

              {/* Documentation — expandable accordion per category */}
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-[#0B1220]">{t("help.documentationTitle")}</h2>
                {HELP_CATEGORIES.map((cat) => {
                  const articles = getArticlesByCategory(cat.slug);
                  return (
                    <div
                      key={cat.slug}
                      id={`docs-${cat.slug}`}
                      className="bg-white rounded-xl border border-[#E5E7EB] p-6"
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-[#0B1220] mb-1">{t(cat.labelKey)}</h3>
                        <p className="text-sm text-[#667085]">{t(cat.descriptionKey)}</p>
                      </div>
                      <div className="space-y-2">
                        {articles.map((a) => {
                          const isExpanded = expandedArticle === a.slug;
                          return (
                            <div key={a.slug} className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedArticle(isExpanded ? null : a.slug)}
                                className={`w-full flex items-center justify-between px-4 py-3 transition-colors text-left group/item ${
                                  isExpanded ? "bg-[#EFF6FF] border-b border-[#E5E7EB]" : "hover:bg-[#F6F8FB]"
                                }`}
                              >
                                <span
                                  className={`text-sm font-medium transition-colors ${
                                    isExpanded
                                      ? "text-[#1D4ED8]"
                                      : "text-[#0B1220] group-hover/item:text-[#1D4ED8]"
                                  }`}
                                >
                                  {t(a.titleKey)}
                                </span>
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-[#1D4ED8] flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-[#667085] group-hover/item:text-[#1D4ED8] group-hover/item:translate-x-1 transition-all flex-shrink-0" />
                                )}
                              </button>
                              {isExpanded && (
                                <div className="px-4 py-4 bg-white">
                                  <p className="text-sm text-[#0B1220] leading-relaxed whitespace-pre-line">
                                    {t(a.bodyKey)}
                                  </p>
                                  <div className="mt-4 pt-4 border-t border-[#E5E7EB]">
                                    <Link
                                      href={`/portal/help/${a.slug}`}
                                      className="text-sm font-medium text-[#1D4ED8] hover:underline inline-flex items-center gap-1"
                                    >
                                      {t("help.readFullArticle")}
                                      <ChevronRight className="w-4 h-4" />
                                    </Link>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Help Resources — 3 gradient cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-[#BFDBFE] bg-gradient-to-br from-[#EFF6FF] to-white p-5">
                  <MessageCircle className="w-8 h-8 text-[#1D4ED8] mb-3" />
                  <h3 className="font-semibold text-[#0B1220] mb-2">{t("help.resources.contactSupport")}</h3>
                  <p className="text-sm text-[#667085] mb-4">{t("help.resources.contactSupportDesc")}</p>
                  <a
                    href="mailto:support@disputedesk.app"
                    className="inline-flex w-full items-center justify-center px-4 py-2 text-sm font-medium text-[#0B1220] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F6F8FB] transition-colors"
                  >
                    {t("help.resources.sendMessage")}
                  </a>
                </div>

                <div className="rounded-xl border border-[#BBF7D0] bg-gradient-to-br from-[#F0FDF4] to-white p-5">
                  <Lightbulb className="w-8 h-8 text-[#22C55E] mb-3" />
                  <h3 className="font-semibold text-[#0B1220] mb-2">{t("help.resources.bestPractices")}</h3>
                  <p className="text-sm text-[#667085] mb-4">{t("help.resources.bestPracticesDesc")}</p>
                  <Link
                    href="/portal/help/evidence-checklist"
                    className="inline-flex w-full items-center justify-center px-4 py-2 text-sm font-medium text-[#0B1220] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F6F8FB] transition-colors"
                  >
                    {t("help.resources.viewGuide")}
                  </Link>
                </div>

                <div className="rounded-xl border border-[#FDE68A] bg-gradient-to-br from-[#FEF3C7] to-white p-5">
                  <ExternalLink className="w-8 h-8 text-[#F59E0B] mb-3" />
                  <h3 className="font-semibold text-[#0B1220] mb-2">{t("help.resources.apiDocs")}</h3>
                  <p className="text-sm text-[#667085] mb-4">{t("help.resources.apiDocsDesc")}</p>
                  <a
                    href="https://docs.disputedesk.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center px-4 py-2 text-sm font-medium text-[#0B1220] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F6F8FB] transition-colors"
                  >
                    {t("help.resources.viewDocs")}
                  </a>
                </div>
              </div>

              {/* Status banner */}
              <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#0B1220]">{t("help.status.operational")}</p>
                    <p className="text-xs text-[#667085]">{t("help.status.lastChecked")}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortalHelpPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex flex-col bg-[#F6F8FB]">
          <div className="bg-gradient-to-br from-[#3b82f6] via-[#60a5fa] to-[#93c5fd] h-48 animate-pulse" />
          <div className="max-w-6xl mx-auto p-6 animate-pulse bg-white/60 rounded-xl min-h-[200px] mt-6" />
        </div>
      }
    >
      <PortalHelpContent />
    </Suspense>
  );
}
