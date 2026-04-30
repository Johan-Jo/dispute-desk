"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  Text,
  BlockStack,
  Icon,
  Toast,
  Frame,
} from "@shopify/polaris";
import {
  SearchIcon,
  ChevronRightIcon,
  PlayIcon,
  ChatIcon,
  ExternalIcon,
  PageIcon,
  AlertCircleIcon,
  PackageIcon,
  CashDollarIcon,
  AutomationIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import {
  getEmbeddedCategories,
  getEmbeddedArticles,
  getArticlesByCategoryForEmbedded,
  getEmbeddedArticleTitleKey,
} from "@/lib/help/embedded";
import { POPULAR_ARTICLES } from "@/lib/help/popular";
import {
  HELP_GUIDE_IDS,
  type HelpGuideId,
} from "@/lib/help-guides-config";
import { useTranslations } from "next-intl";

// ─── Quick Actions: 4 cards mapped 1:1 with Figma ──────────────
interface QuickAction {
  guideId: HelpGuideId;
  titleKey: string;
  descKey: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { guideId: "review-dispute", titleKey: "quickHandleDispute", descKey: "quickHandleDisputeDesc" },
  { guideId: "build-pack", titleKey: "quickBuildPack", descKey: "quickBuildPackDesc" },
  { guideId: "automation-rules", titleKey: "quickSetupAutomation", descKey: "quickSetupAutomationDesc" },
  { guideId: "install-template", titleKey: "quickInstallTemplate", descKey: "quickInstallTemplateDesc" },
];

// ─── Category icon + tinted bg per Figma ──────────────────────
const CATEGORY_ICON_MAP: Record<string, typeof SearchIcon> = {
  "getting-started": PageIcon,
  disputes: AlertCircleIcon,
  lifecycle: ShieldCheckMarkIcon,
  "evidence-packs": PackageIcon,
  "automation-rules": AutomationIcon,
  policies: PageIcon,
  billing: CashDollarIcon,
  "saving-to-shopify": ShieldCheckMarkIcon,
};

const CATEGORY_BG_MAP: Record<string, string> = {
  "getting-started": "#EBF5FA",
  disputes: "#FEF3C7",
  lifecycle: "#E0F2FE",
  "evidence-packs": "#DBEAFE",
  "automation-rules": "#D1FAE5",
  policies: "#FCE7F3",
  billing: "#FCE7F3",
  "saving-to-shopify": "#E0E7FF",
};

const CATEGORY_FG_MAP: Record<string, string> = {
  "getting-started": "#005BD3",
  disputes: "#92400E",
  lifecycle: "#0369A1",
  "evidence-packs": "#1E40AF",
  "automation-rules": "#065F46",
  policies: "#9D174D",
  billing: "#9D174D",
  "saving-to-shopify": "#3730A3",
};

const EMBEDDED_NAMESPACE = "help.embedded";
const SUPPORT_EMAIL = "support@disputedesk.app";

export default function EmbeddedHelpPage() {
  const t = useTranslations();
  const tEmbedded = useTranslations(EMBEDDED_NAMESPACE);
  const router = useRouter();
  const helpGuide = useHelpGuideSafe();
  const [query, setQuery] = useState("");
  const [toastActive, setToastActive] = useState(false);

  const embeddedArticles = getEmbeddedArticles();
  const embeddedCategories = getEmbeddedCategories();

  const filteredArticles = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return embeddedArticles.filter((a) => {
      const title = t(getEmbeddedArticleTitleKey(a)).toLowerCase();
      const tags = a.tags?.join(" ").toLowerCase() ?? "";
      return title.includes(q) || tags.includes(q);
    });
  }, [query, t, embeddedArticles]);

  const onArticleClick = useCallback(
    (slug: string) => router.push(`/app/help/${slug}`),
    [router],
  );

  return (
    <Frame>
      <Page
        title={tEmbedded("helpCenterTitle")}
        subtitle={tEmbedded("helpCenterSubtitle")}
        backAction={{ content: t("nav.overview"), url: "/app" }}
      >
        <BlockStack gap="500">
          {/* ─── Search ─── */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              padding: 24,
            }}
          >
            <div style={{ position: "relative", marginBottom: 8 }}>
              <span
                style={{
                  position: "absolute",
                  left: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 18,
                  height: 18,
                  color: "#6D7175",
                  display: "inline-flex",
                }}
              >
                <Icon source={SearchIcon} tone="base" />
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tEmbedded("searchPlaceholder")}
                style={{
                  width: "100%",
                  padding: "12px 16px 12px 44px",
                  border: "1px solid #C9CCCF",
                  borderRadius: 8,
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#6D7175" }}>
              {tEmbedded("searchHint")}
            </div>
          </div>

          {filteredArticles ? (
            <ArticleList
              articles={filteredArticles.map((a) => ({
                id: a.slug,
                title: t(getEmbeddedArticleTitleKey(a)),
                category: t(
                  getEmbeddedCategories().find((c) => c.slug === a.category)?.labelKey ??
                    "help.categories.gettingStarted",
                ),
              }))}
              onClick={onArticleClick}
              emptyText={tEmbedded("noResults")}
            />
          ) : (
            <>
              {/* ─── Take the full tour CTA ─── */}
              {helpGuide && (
                <div
                  style={{
                    background: "linear-gradient(90deg,#1D4ED8 0%,#3B82F6 100%)",
                    borderRadius: 12,
                    padding: "18px 22px",
                    color: "#FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                      {tEmbedded("takeFullTour")}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                      {tEmbedded("takeFullTourDesc")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => helpGuide.startTourChain()}
                    style={{
                      background: "#FFFFFF",
                      color: "#1D4ED8",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "9px 18px",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ width: 14, height: 14 }}>
                      <Icon source={PlayIcon} tone="base" />
                    </span>
                    {tEmbedded("startGuide")}
                  </button>
                </div>
              )}

              {/* ─── Quick Actions ─── */}
              {helpGuide && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 16,
                    }}
                  >
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: 0 }}>
                      {tEmbedded("quickActionsTitle")}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        document
                          .getElementById("browse-by-category")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#005BD3",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {tEmbedded("viewAllTours")}
                      <span style={{ width: 14, height: 14 }}>
                        <Icon source={ChevronRightIcon} tone="base" />
                      </span>
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                      gap: 16,
                    }}
                  >
                    {QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.guideId}
                        type="button"
                        onClick={() => helpGuide.startGuide(action.guideId, { withChain: true })}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #C9CCCF",
                          borderRadius: 8,
                          padding: 16,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                          transition: "border-color 150ms",
                        }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: "#EBF5FA",
                            color: "#005BD3",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ width: 20, height: 20 }}>
                            <Icon source={PlayIcon} tone="base" />
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#202223",
                              marginBottom: 4,
                            }}
                          >
                            {tEmbedded(action.titleKey)}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#6D7175",
                              lineHeight: 1.5,
                            }}
                          >
                            {tEmbedded(action.descKey)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Popular Articles ─── */}
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#202223",
                    margin: "0 0 16px",
                  }}
                >
                  {tEmbedded("popularArticlesByCategoryTitle")}
                </h2>
                <div
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #C9CCCF",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {POPULAR_ARTICLES.map((entry, i) => {
                    const article = embeddedArticles.find((a) => a.slug === entry.slug);
                    if (!article) return null;
                    const cat = embeddedCategories.find((c) => c.slug === article.category);
                    return (
                      <button
                        key={entry.slug}
                        onClick={() => onArticleClick(entry.slug)}
                        style={{
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          borderTop: i === 0 ? "none" : "1px solid #E1E3E5",
                          padding: "12px 20px",
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                          <span style={{ width: 16, height: 16, color: "#6D7175", flexShrink: 0 }}>
                            <Icon source={PageIcon} tone="base" />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#202223",
                                marginBottom: 2,
                              }}
                            >
                              {t(getEmbeddedArticleTitleKey(article))}
                            </div>
                            <div style={{ fontSize: 12, color: "#6D7175" }}>
                              {cat ? t(cat.labelKey) : ""}
                            </div>
                          </div>
                        </div>
                        <span style={{ width: 16, height: 16, color: "#6D7175", flexShrink: 0 }}>
                          <Icon source={ChevronRightIcon} tone="base" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ─── Browse by Category ─── */}
              <div id="browse-by-category">
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#202223",
                    margin: "0 0 16px",
                  }}
                >
                  {tEmbedded("browseByCategoryTitle")}
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 16,
                  }}
                >
                  {embeddedCategories.map((cat) => {
                    const count = getArticlesByCategoryForEmbedded(cat.slug).length;
                    const IconSrc = CATEGORY_ICON_MAP[cat.slug] ?? PageIcon;
                    const bg = CATEGORY_BG_MAP[cat.slug] ?? "#F6F8FB";
                    const fg = CATEGORY_FG_MAP[cat.slug] ?? "#6D7175";
                    return (
                      <a
                        key={cat.slug}
                        href={`#cat-${cat.slug}`}
                        onClick={(e) => {
                          e.preventDefault();
                          // Open the first article in this category as a quick "browse"
                          const first = getArticlesByCategoryForEmbedded(cat.slug)[0];
                          if (first) onArticleClick(first.slug);
                        }}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #C9CCCF",
                          borderRadius: 8,
                          padding: 20,
                          textDecoration: "none",
                          display: "block",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            marginBottom: 12,
                          }}
                        >
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              background: bg,
                              color: fg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <span style={{ width: 20, height: 20 }}>
                              <Icon source={IconSrc} tone="base" />
                            </span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#202223",
                                marginBottom: 2,
                              }}
                            >
                              {t(cat.labelKey)}
                            </div>
                            <div style={{ fontSize: 12, color: "#6D7175" }}>
                              {tEmbedded("categoryArticleCount", { count })}
                            </div>
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#6D7175",
                            lineHeight: 1.5,
                          }}
                        >
                          {t(cat.descriptionKey)}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>

              {/* ─── Contact Support banner ─── */}
              <div
                style={{
                  background: "linear-gradient(90deg,#5E4DB2 0%,#7C3AED 100%)",
                  borderRadius: 12,
                  padding: 24,
                  color: "#FFFFFF",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      background: "rgba(255,255,255,0.2)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 24, height: 24, color: "#FFFFFF" }}>
                      <Icon source={ChatIcon} tone="base" />
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                      {tEmbedded("stillNeedHelp")}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)" }}>
                      {tEmbedded("stillNeedHelpDesc")}
                    </div>
                  </div>
                </div>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  style={{
                    background: "#FFFFFF",
                    color: "#5E4DB2",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "10px 18px",
                    borderRadius: 8,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  {tEmbedded("contactSupportCta")}
                  <span style={{ width: 14, height: 14 }}>
                    <Icon source={ExternalIcon} tone="base" />
                  </span>
                </a>
              </div>
            </>
          )}
        </BlockStack>
        {toastActive && (
          <Toast content={tEmbedded("feedbackThanks")} onDismiss={() => setToastActive(false)} />
        )}
      </Page>
    </Frame>
  );
}

function ArticleList({
  articles,
  onClick,
  emptyText,
}: {
  articles: { id: string; title: string; category: string }[];
  onClick: (slug: string) => void;
  emptyText: string;
}) {
  if (articles.length === 0) {
    return (
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #C9CCCF",
          borderRadius: 8,
          padding: 32,
          textAlign: "center",
          color: "#6D7175",
          fontSize: 14,
        }}
      >
        {emptyText}
      </div>
    );
  }
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #C9CCCF",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {articles.map((a, i) => (
        <button
          key={a.id}
          onClick={() => onClick(a.id)}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            borderTop: i === 0 ? "none" : "1px solid #E1E3E5",
            padding: "12px 20px",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{ width: 16, height: 16, color: "#6D7175", flexShrink: 0 }}>
              <Icon source={PageIcon} tone="base" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#202223", marginBottom: 2 }}>
                {a.title}
              </div>
              <div style={{ fontSize: 12, color: "#6D7175" }}>{a.category}</div>
            </div>
          </div>
          <span style={{ width: 16, height: 16, color: "#6D7175", flexShrink: 0 }}>
            <Icon source={ChevronRightIcon} tone="base" />
          </span>
        </button>
      ))}
    </div>
  );
}
