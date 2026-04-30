"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  Card,
  TextField,
  Text,
  BlockStack,
  InlineStack,
  Icon,
  Button,
  Toast,
  Frame,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeliveryIcon,
  OrderIcon,
  SettingsIcon,
  CashDollarIcon,
  ExportIcon,
  PlayIcon,
  PageIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  EmailIcon,
  LightbulbIcon,
  QuestionCircleIcon,
} from "@shopify/polaris-icons";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import {
  getEmbeddedCategories,
  getEmbeddedArticles,
  getArticlesByCategoryForEmbedded,
  getEmbeddedArticleTitleKey,
  getEmbeddedArticleBodyKey,
} from "@/lib/help/embedded";
import { POPULAR_ARTICLES } from "@/lib/help/popular";
import {
  getPortalGuideTranslationKeyPrefix,
  HELP_GUIDE_IDS,
  type HelpGuideId,
} from "@/lib/help-guides-config";
import { useTranslations } from "next-intl";

const POLARIS_ICON_MAP: Record<string, typeof SearchIcon> = {
  rocket: PlayIcon,
  scale: DeliveryIcon,
  package: OrderIcon,
  zap: SettingsIcon,
  creditCard: CashDollarIcon,
  upload: ExportIcon,
  page: PageIcon,
};

const CATEGORY_COLORS: Record<string, string> = {
  "getting-started": "#1D4ED8",
  disputes: "#F59E0B",
  lifecycle: "#0EA5E9",
  "evidence-packs": "#22C55E",
  "automation-rules": "#8B5CF6",
  policies: "#EC4899",
  billing: "#06B6D4",
  "saving-to-shopify": "#6366F1",
};

const GUIDE_ICON_MAP: Record<HelpGuideId, typeof SearchIcon> = {
  "review-dispute": DeliveryIcon,
  "build-pack": OrderIcon,
  "automation-rules": SettingsIcon,
  "install-template": OrderIcon,
  "configure-policies": DeliveryIcon,
  "pack-builder-advanced": SettingsIcon,
};

const RECOMMENDED_GUIDE_IDS = new Set<HelpGuideId>([
  "build-pack",
  "install-template",
  "review-dispute",
  "automation-rules",
]);

const QUICK_TASKS: Array<{
  id: string;
  guideId: HelpGuideId;
  titleKey: string;
  icon: typeof SearchIcon;
}> = [
  { id: "create-pack", guideId: "build-pack", titleKey: "quickTaskCreatePack", icon: OrderIcon },
  { id: "install-template", guideId: "install-template", titleKey: "quickTaskInstallTemplate", icon: PlayIcon },
  { id: "handle-dispute", guideId: "review-dispute", titleKey: "quickTaskHandleDispute", icon: DeliveryIcon },
  { id: "create-rule", guideId: "automation-rules", titleKey: "quickTaskCreateRule", icon: SettingsIcon },
];

const EMBEDDED_NAMESPACE = "help.embedded";
const BEST_PRACTICES_SLUG = "pack-best-practices";
const SUPPORT_EMAIL = "support@disputedesk.app";

export default function EmbeddedHelpPage() {
  const t = useTranslations();
  const tEmbedded = useTranslations(EMBEDDED_NAMESPACE);
  const router = useRouter();
  const helpGuide = useHelpGuideSafe();
  const [query, setQuery] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
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

  const onFeedback = useCallback(() => setToastActive(true), []);

  const portalApiDocsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://disputedesk.app"}/portal/help`;

  return (
    <Frame>
      <Page
        title={tEmbedded("title")}
        backAction={{ content: t("nav.overview"), url: "/app" }}
      >
        <BlockStack gap="500">
          {/* ─── Hero strip ─── */}
          <div
            style={{
              background: "linear-gradient(135deg,#3B82F6 0%,#60A5FA 50%,#93C5FD 100%)",
              borderRadius: 12,
              padding: "32px 28px",
              color: "#FFFFFF",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "relative", maxWidth: 720 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 24, height: 24, color: "#FFFFFF" }}>
                  <Icon source={QuestionCircleIcon} tone="base" />
                </span>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
                  {tEmbedded("title")}
                </h1>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.92)", marginBottom: 18 }}>
                {tEmbedded("heroTagline")}
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  backdropFilter: "blur(8px)",
                }}
              >
                <span style={{ width: 18, height: 18, color: "#FFFFFF", flexShrink: 0 }}>
                  <Icon source={SearchIcon} tone="base" />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tEmbedded("heroSearchPlaceholder")}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#FFFFFF",
                    fontSize: 14,
                  }}
                />
              </div>
            </div>
          </div>

          {/* ─── Search results override ─── */}
          {filteredArticles ? (
            filteredArticles.length === 0 ? (
              <Card>
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  {tEmbedded("noResults")}
                </Text>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="200">
                  {filteredArticles.map((a) => (
                    <button
                      key={a.slug}
                      onClick={() => router.push(`/app/help/${a.slug}`)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                        padding: "12px 0",
                        borderBottom: "1px solid #E1E3E5",
                      }}
                    >
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {t(getEmbeddedArticleTitleKey(a))}
                      </Text>
                    </button>
                  ))}
                </BlockStack>
              </Card>
            )
          ) : (
            <>
              {/* ─── Quick Tasks ─── */}
              {helpGuide && (
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: "0 0 12px" }}>
                    {tEmbedded("quickTasksTitle")}
                  </h2>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {QUICK_TASKS.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => helpGuide.startGuide(task.guideId)}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #E1E3E5",
                          borderRadius: 8,
                          padding: 16,
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "border-color 150ms",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            width: 24,
                            height: 24,
                            color: "#1D4ED8",
                            marginBottom: 8,
                          }}
                        >
                          <Icon source={task.icon} tone="info" />
                        </span>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#202223", marginBottom: 2 }}>
                          {tEmbedded(task.titleKey)}
                        </div>
                        <div style={{ fontSize: 12, color: "#6D7175" }}>
                          {tEmbedded("quickTaskInteractiveGuide")}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Interactive Tours ─── */}
              {helpGuide && (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: 0 }}>
                      {tEmbedded("interactiveToursTitle")}
                    </h2>
                    <p style={{ fontSize: 13, color: "#6D7175", margin: "2px 0 0" }}>
                      {tEmbedded("interactiveToursDesc")}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {HELP_GUIDE_IDS.map((guideId) => {
                      const IconSource = GUIDE_ICON_MAP[guideId];
                      const keyPrefix = getPortalGuideTranslationKeyPrefix(guideId);
                      const recommended = RECOMMENDED_GUIDE_IDS.has(guideId);
                      const duration = (() => {
                        try {
                          return t(`help.${keyPrefix}.duration`);
                        } catch {
                          return null;
                        }
                      })();
                      return (
                        <div
                          key={guideId}
                          style={{
                            background: "#FFFFFF",
                            border: "1px solid #E1E3E5",
                            borderRadius: 8,
                            padding: 18,
                            display: "flex",
                            gap: 14,
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              background: "linear-gradient(135deg,#1D4ED8 0%,#1E40AF 100%)",
                              color: "#FFFFFF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <span style={{ width: 22, height: 22 }}>
                              <Icon source={IconSource} tone="base" />
                            </span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                marginBottom: 4,
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                                {t(`help.${keyPrefix}.title`)}
                              </span>
                              {recommended && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    background: "#DBEAFE",
                                    color: "#1E40AF",
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                  }}
                                >
                                  {tEmbedded("recommendedBadge")}
                                </span>
                              )}
                            </div>
                            <p style={{ fontSize: 13, color: "#6D7175", margin: "0 0 10px" }}>
                              {t(`help.${keyPrefix}.description`)}
                            </p>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                              }}
                            >
                              {duration && (
                                <span style={{ fontSize: 12, color: "#6D7175" }}>{duration}</span>
                              )}
                              <Button
                                variant="primary"
                                size="slim"
                                onClick={() => helpGuide.startGuide(guideId)}
                              >
                                {tEmbedded("startGuide")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── Browse by Topic ─── */}
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: "0 0 12px" }}>
                  {tEmbedded("browseByTopicTitle")}
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {embeddedCategories.map((cat) => {
                    const iconSource = POLARIS_ICON_MAP[cat.icon] ?? SearchIcon;
                    const count = getArticlesByCategoryForEmbedded(cat.slug).length;
                    const color = CATEGORY_COLORS[cat.slug] ?? "#6D7175";
                    return (
                      <a
                        key={cat.slug}
                        href={`#${cat.slug}`}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #E1E3E5",
                          borderRadius: 8,
                          padding: 18,
                          textDecoration: "none",
                          display: "block",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: `${color}1F`,
                              color,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Icon source={iconSource} tone="base" />
                          </div>
                          <span style={{ width: 16, height: 16, color: "#6D7175" }}>
                            <Icon source={ChevronRightIcon} tone="base" />
                          </span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#202223", marginBottom: 4 }}>
                          {t(cat.labelKey)}
                        </div>
                        <div style={{ fontSize: 12, color: "#6D7175" }}>
                          {tEmbedded("articleCount", { count })}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>

              {/* ─── Documentation accordion ─── */}
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: "0 0 12px" }}>
                  {tEmbedded("documentationTitle")}
                </h2>
                <BlockStack gap="300">
                  {embeddedCategories.map((cat) => {
                    const articles = getArticlesByCategoryForEmbedded(cat.slug);
                    return (
                      <div
                        key={cat.slug}
                        id={cat.slug}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #E1E3E5",
                          borderRadius: 8,
                          padding: 18,
                        }}
                      >
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#202223", marginBottom: 2 }}>
                            {t(cat.labelKey)}
                          </div>
                          <div style={{ fontSize: 13, color: "#6D7175" }}>
                            {t(cat.descriptionKey)}
                          </div>
                        </div>
                        <BlockStack gap="200">
                          {articles.map((a) => {
                            const isExpanded = expandedSlug === a.slug;
                            return (
                              <div
                                key={a.slug}
                                style={{
                                  border: "1px solid #E1E3E5",
                                  borderRadius: 6,
                                  overflow: "hidden",
                                }}
                              >
                                <button
                                  onClick={() => setExpandedSlug(isExpanded ? null : a.slug)}
                                  style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "10px 14px",
                                    background: isExpanded ? "#EFF6FF" : "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 500,
                                      color: isExpanded ? "#1D4ED8" : "#202223",
                                    }}
                                  >
                                    {t(getEmbeddedArticleTitleKey(a))}
                                  </span>
                                  <span style={{ width: 16, height: 16, color: isExpanded ? "#1D4ED8" : "#6D7175" }}>
                                    <Icon source={isExpanded ? ChevronDownIcon : ChevronRightIcon} tone="base" />
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div style={{ padding: "12px 14px", borderTop: "1px solid #E1E3E5", background: "#FFFFFF" }}>
                                    <div
                                      style={{
                                        fontSize: 13,
                                        color: "#202223",
                                        lineHeight: 1.55,
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {t(getEmbeddedArticleBodyKey(a))}
                                    </div>
                                    <div
                                      style={{
                                        marginTop: 14,
                                        paddingTop: 12,
                                        borderTop: "1px solid #E1E3E5",
                                        display: "flex",
                                        gap: 14,
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span style={{ fontSize: 12, color: "#6D7175" }}>
                                        {tEmbedded("wasHelpful")}
                                      </span>
                                      <button
                                        onClick={onFeedback}
                                        style={{
                                          background: "transparent",
                                          border: "none",
                                          color: "#1D4ED8",
                                          fontSize: 12,
                                          fontWeight: 500,
                                          cursor: "pointer",
                                          padding: 0,
                                        }}
                                      >
                                        👍 {tEmbedded("feedbackYes")}
                                      </button>
                                      <button
                                        onClick={onFeedback}
                                        style={{
                                          background: "transparent",
                                          border: "none",
                                          color: "#6D7175",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          padding: 0,
                                        }}
                                      >
                                        👎 {tEmbedded("feedbackNo")}
                                      </button>
                                      <button
                                        onClick={() => router.push(`/app/help/${a.slug}`)}
                                        style={{
                                          marginLeft: "auto",
                                          background: "transparent",
                                          border: "none",
                                          color: "#1D4ED8",
                                          fontSize: 12,
                                          fontWeight: 500,
                                          cursor: "pointer",
                                          padding: 0,
                                        }}
                                      >
                                        {tEmbedded("backToHelp") /* reuse existing key */}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </BlockStack>
                      </div>
                    );
                  })}
                </BlockStack>
              </div>

              {/* ─── Popular Articles ─── */}
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: "0 0 12px" }}>
                  {tEmbedded("popularArticlesTitle")}
                </h2>
                <Card padding="0">
                  <div>
                    {POPULAR_ARTICLES.map((entry, i) => {
                      const article = embeddedArticles.find((a) => a.slug === entry.slug);
                      if (!article) return null;
                      return (
                        <button
                          key={entry.slug}
                          onClick={() => router.push(`/app/help/${entry.slug}`)}
                          style={{
                            width: "100%",
                            background: "transparent",
                            border: "none",
                            borderTop: i === 0 ? "none" : "1px solid #E1E3E5",
                            padding: "14px 18px",
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "#202223", marginBottom: 4 }}>
                              {t(getEmbeddedArticleTitleKey(article))}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6D7175",
                                display: "flex",
                                gap: 12,
                                flexWrap: "wrap",
                              }}
                            >
                              <span>{tEmbedded("viewsCount", { count: entry.views })}</span>
                              <span>•</span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 12, height: 12, color: "#22C55E" }}>
                                  <Icon source={CheckCircleIcon} tone="success" />
                                </span>
                                {tEmbedded("helpfulCount", { count: entry.helpful })}
                              </span>
                            </div>
                          </div>
                          <span style={{ width: 16, height: 16, color: "#6D7175", flexShrink: 0 }}>
                            <Icon source={ChevronRightIcon} tone="base" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* ─── Resource cards ─── */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                <ResourceCard
                  icon={EmailIcon}
                  iconColor="#1D4ED8"
                  bg="linear-gradient(135deg,#EFF6FF,#FFFFFF)"
                  borderColor="#BFDBFE"
                  title={tEmbedded("resourceContactSupport")}
                  body={tEmbedded("resourceContactDesc")}
                  cta={tEmbedded("resourceContactCta")}
                  href={`mailto:${SUPPORT_EMAIL}`}
                  external
                />
                <ResourceCard
                  icon={LightbulbIcon}
                  iconColor="#22C55E"
                  bg="linear-gradient(135deg,#F0FDF4,#FFFFFF)"
                  borderColor="#BBF7D0"
                  title={tEmbedded("resourceBestPractices")}
                  body={tEmbedded("resourceBestPracticesDesc")}
                  cta={tEmbedded("resourceBestPracticesCta")}
                  onClick={() => router.push(`/app/help/${BEST_PRACTICES_SLUG}`)}
                />
                <ResourceCard
                  icon={ExportIcon}
                  iconColor="#F59E0B"
                  bg="linear-gradient(135deg,#FEF3C7,#FFFFFF)"
                  borderColor="#FDE68A"
                  title={tEmbedded("resourceApiDocs")}
                  body={tEmbedded("resourceApiDocsDesc")}
                  cta={tEmbedded("resourceApiDocsCta")}
                  href={portalApiDocsUrl}
                  external
                />
              </div>

              {/* ─── Status pill ─── */}
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 8,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{ width: 20, height: 20, color: "#22C55E", flexShrink: 0 }}>
                  <Icon source={CheckCircleIcon} tone="success" />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                    {tEmbedded("statusOperational")}
                  </div>
                  <div style={{ fontSize: 11, color: "#6D7175" }}>
                    {tEmbedded("statusLastChecked", { ago: "2 min" })}
                  </div>
                </div>
              </div>

              {/* Contact-support footer line (back-compat with existing key) */}
              <div style={{ paddingBlockStart: 12, paddingBlockEnd: 24, textAlign: "center" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  {tEmbedded("contactSupport")}
                </Text>
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

function ResourceCard({
  icon,
  iconColor,
  bg,
  borderColor,
  title,
  body,
  cta,
  href,
  external,
  onClick,
}: {
  icon: typeof SearchIcon;
  iconColor: string;
  bg: string;
  borderColor: string;
  title: string;
  body: string;
  cta: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <span style={{ width: 28, height: 28, color: iconColor, marginBottom: 10 }}>
        <Icon source={icon} tone="base" />
      </span>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#202223", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#6D7175", marginBottom: 14, flex: 1 }}>{body}</div>
      <Button
        size="slim"
        url={href}
        external={external}
        onClick={onClick}
        fullWidth
      >
        {cta}
      </Button>
    </div>
  );
}
