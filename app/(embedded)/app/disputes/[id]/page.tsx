/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/disputes/[id]/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-dispute-detail.tsx
 * Reference: dispute detail layout, evidence section, actions.
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  Spinner,
  Divider,
  Icon,
  Modal,
  Box,
  Collapsible,
} from "@shopify/polaris";
import {
  OrderIcon,
  PersonIcon,
  NoteIcon,
  ClockIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";

import styles from "./dispute-detail.module.css";
import { DisputeStatusStepper } from "./DisputeStatusStepper";
import { getDisputeProgressSteps } from "@/lib/embedded/disputeDetailProgress";
import {
  deriveFamily,
  deriveHandlingMode,
  phaseBadgeTone,
  phaseLabel as phaseLabelFn,
  isPhaseKnown,
  casePrimaryCta,
  disputeTitle,
} from "@/lib/disputes/phaseUtils";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

interface Dispute {
  id: string;
  dispute_gid: string;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  phase: string | null;
  family?: string;
  handling_mode?: string;
  amount: number | null;
  currency_code: string | null;
  initiated_at: string | null;
  due_at: string | null;
  last_synced_at: string | null;
  needs_review: boolean;
}

interface ProfileAddress {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
}

interface DisputeProfile {
  orderName: string | null;
  orderId: string | null;
  createdAt: string | null;
  total?: { amount: string; currencyCode: string } | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  displayAddress: ProfileAddress | null;
  shippingAddress: ProfileAddress | null;
  billingAddress: ProfileAddress | null;
  fulfillments: Array<{
    id: string;
    status: string;
    trackingInfo: Array<{ number: string; url: string; company: string }>;
    createdAt: string;
  }>;
  orderEvents: Array<{ id: string; createdAt: string; message: string; appTitle: string | null }>;
}

interface Pack {
  id: string;
  status: string;
  completeness_score: number | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  saved_to_shopify_at: string | null;
  created_at: string;
}

interface TimelineEvent {
  date: string;
  label: string;
  sublabel?: string;
}

interface MatchedRule {
  name: string;
  mode: string;
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAddress(addr: ProfileAddress | null | undefined): string {
  if (!addr) return "—";
  return [addr.address1, addr.city, addr.province, addr.zip, addr.country]
    .filter(Boolean)
    .join(", ") || addr.name || "—";
}

function statusTone(
  status: string | null
): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "won": return "success";
    case "needs_response": return "warning";
    case "lost": return "critical";
    case "under_review": return "info";
    default: return undefined;
  }
}

function statusLabel(status: string | null, t: ReturnType<typeof useTranslations>): string {
  switch (status) {
    case "needs_response": return t("disputes.statusNeedsResponse");
    case "under_review": return t("disputes.statusUnderReview");
    case "won": return t("disputes.statusWon");
    case "lost": return t("disputes.statusLost");
    default: return status?.replace(/_/g, " ") ?? t("status.unknown");
  }
}

function packStatusTone(status: string): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "saved_to_shopify": return "success";
    case "ready": return "warning";
    case "blocked":
    case "failed": return "critical";
    case "building":
    case "queued": return "info";
    default: return undefined;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

function buildTimeline(
  packs: Pack[],
  orderEvents: DisputeProfile["orderEvents"],
  t: ReturnType<typeof useTranslations>
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const e of orderEvents) {
    events.push({
      date: e.createdAt,
      label: stripHtml(e.message),
      sublabel: e.appTitle ?? "Shopify",
    });
  }

  const saved = packs.find((p) => p.saved_to_shopify_at);
  if (saved?.saved_to_shopify_at) {
    events.push({ date: saved.saved_to_shopify_at, label: t("disputes.evidenceSavedToShopify") });
  }
  if (packs.length > 0) {
    events.push({ date: packs[packs.length - 1].created_at, label: t("disputes.evidencePackGenerated") });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events;
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.summaryItem}>
      <p className={styles.summaryItemLabel}>{label}</p>
      <div className={styles.summaryItemValue}>{value}</div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.profileRow}>
      <span className={styles.profileRowLabel}>{label}</span>
      <span className={styles.profileRowValue}>{value || "—"}</span>
    </div>
  );
}

const INFO_BANNER_KEY = "dd-info-banner-dismissed";

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profile, setProfile] = useState<DisputeProfile | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [matchedRule, setMatchedRule] = useState<MatchedRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateCheckLoading, setTemplateCheckLoading] = useState(false);
  const [matchedTemplate, setMatchedTemplate] = useState<{ id: string; name: string } | null>(null);

  // Collapsible state
  const [infoBannerDismissed, setInfoBannerDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(INFO_BANNER_KEY) === "1";
    }
    return false;
  });
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [orderDataOpen, setOrderDataOpen] = useState(false);
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);

  const daysUntilInfo = (iso: string | null): { text: string; urgent: boolean } => {
    if (!iso) return { text: "—", urgent: false };
    const diff = Math.ceil(
      (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (diff < 0) return { text: t("disputes.daysOverdue", { count: Math.abs(diff) }), urgent: true };
    if (diff === 0) return { text: t("disputes.dueToday"), urgent: true };
    return { text: t("disputes.daysRemaining", { count: diff }), urgent: diff <= 3 };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const locale = searchParams.get("locale") ?? "";
    const profileUrl = locale
      ? `/api/disputes/${id}/profile?locale=${encodeURIComponent(locale)}`
      : `/api/disputes/${id}/profile`;
    const [res, profileRes] = await Promise.all([
      fetch(`/api/disputes/${id}`),
      fetch(profileUrl),
    ]);
    const json = await res.json();
    const profileJson = await profileRes.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setShopDomain(json.shop_domain ?? null);
    setMatchedRule(json.matchedRule ?? null);
    setProfile(profileJson.profile ?? null);
    setLoading(false);
  }, [id, searchParams]);

  const progressSteps = useMemo(() => {
    if (!dispute) return [];
    return getDisputeProgressSteps({
      initiated_at: dispute.initiated_at,
      status: dispute.status,
      packs: packs.map((p) => ({
        created_at: p.created_at,
        saved_to_shopify_at: p.saved_to_shopify_at,
      })),
    });
  }, [dispute, packs]);

  const packForSupplemental = useMemo(() => {
    const saved = packs.filter((p) => p.saved_to_shopify_at);
    if (saved.length === 0) return null;
    return [...saved].sort(
      (a, b) =>
        new Date(b.saved_to_shopify_at!).getTime() -
        new Date(a.saved_to_shopify_at!).getTime(),
    )[0]!;
  }, [packs]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/api/disputes/${id}/sync`, { method: "POST" });
    await fetchData();
    setSyncing(false);
  };

  const doGenerate = async () => {
    setShowTemplateModal(false);
    setGenerating(true);
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
    } else {
      const data = await res.json();
      if (data.packId) {
        router.push(withShopParams(`/app/packs/${data.packId}`, searchParams));
        return;
      }
      await fetchData();
    }
    setGenerating(false);
  };

  const doGenerateFromTemplate = async (templateId: string) => {
    setShowTemplateModal(false);
    setGenerating(true);
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
      setGenerating(false);
    } else {
      const data = await res.json();
      if (data.packId) {
        router.push(withShopParams(`/app/packs/${data.packId}`, searchParams));
      } else {
        await fetchData();
        setGenerating(false);
      }
    }
  };

  const handleGenerate = async () => {
    setTemplateCheckLoading(true);
    const locale = searchParams.get("locale") ?? "";
    const reason = dispute?.reason ?? "";
    try {
      const phase = dispute?.phase ?? "";
      const res = await fetch(
        `/api/templates?reason=${encodeURIComponent(reason)}&phase=${encodeURIComponent(phase)}&locale=${encodeURIComponent(locale)}`
      );
      const { templates } = await res.json();
      const best =
        (templates as Array<{ id: string; name: string; is_recommended?: boolean }>)
          ?.find((t) => t.is_recommended) ??
        templates?.[0] ??
        null;
      setMatchedTemplate(best ?? null);
    } catch {
      setMatchedTemplate(null);
    }
    setTemplateCheckLoading(false);
    setShowTemplateModal(true);
  };

  const dismissInfoBanner = () => {
    setInfoBannerDismissed(true);
    localStorage.setItem(INFO_BANNER_KEY, "1");
  };

  if (loading) {
    return (
      <Page title={t("disputes.detailPageTitle")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!dispute) {
    return (
      <Page
        title={t("disputes.detailPageTitle")}
        backAction={{ content: t("disputes.title"), url: withShopParams("/app/disputes", searchParams) }}
      >
        <Banner tone="critical">{t("disputes.disputeNotFound")}</Banner>
      </Page>
    );
  }

  const isSynthetic = dispute.dispute_gid?.includes("/seed-") ?? false;
  const disputeNumericId = dispute.dispute_gid?.split("/").pop() ?? dispute.id;
  const orderNum = dispute.order_gid?.split("/").pop();
  const disputeUrl =
    shopDomain && dispute.dispute_gid
      ? getShopifyDisputeUrl(shopDomain, dispute.dispute_gid)
      : null;
  const deadline = daysUntilInfo(dispute.due_at);
  const timeline = buildTimeline(packs, profile?.orderEvents ?? [], t);
  const isAutomated = matchedRule?.mode === "auto_pack";
  const isSubmittedToBank = dispute.status === "under_review" || dispute.status === "accepted" || dispute.status === "won" || dispute.status === "lost";
  const latestPack = packs.length > 0 ? packs[0] : null;
  const latestPackStatus = latestPack?.status ?? null;
  const phaseKnown = isPhaseKnown(dispute.phase);
  const cta = casePrimaryCta(dispute.phase as DisputePhase | null, latestPackStatus);

  return (
    <Page
      title={disputeTitle(dispute.phase as DisputePhase | null, disputeNumericId, t)}
      subtitle={t("disputes.orderDateSubtitle", { date: formatDate(profile?.createdAt ?? dispute.initiated_at) })}
      backAction={{ content: t("disputes.title"), url: withShopParams("/app/disputes", searchParams) }}
      titleMetadata={
        isAutomated
          ? <span className={styles.automatedBadge}>⚡ {t("disputes.automatedBadge")}</span>
          : isSynthetic ? <Badge tone="info">Synthetic</Badge> : undefined
      }
      primaryAction={{
        content: generating || templateCheckLoading
          ? t("disputes.generating")
          : t(cta.key),
        onAction: latestPackStatus === "saved_to_shopify" && disputeUrl
          ? () => window.open(disputeUrl, "_top")
          : handleGenerate,
        loading: generating || templateCheckLoading || syncing,
        disabled: cta.disabled,
        icon: NoteIcon,
      }}
      secondaryActions={[
        {
          content: syncing ? t("disputes.reSyncing") : t("disputes.reSync"),
          onAction: handleSync,
          loading: syncing,
          icon: RefreshIcon,
        },
        ...(disputeUrl
          ? [{ content: t("disputes.openDisputeInShopify"), url: disputeUrl, external: true }]
          : []),
      ]}
    >
      <Layout>
        {/* HERO: Phase explanation + what's happening + what to do */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={phaseBadgeTone(dispute.phase as DisputePhase | null)}>
                  {phaseLabelFn(dispute.phase as DisputePhase | null, t)}
                </Badge>
                <Text as="span" variant="bodySm" tone="subdued">
                  {deriveFamily(dispute.reason)}
                </Text>
              </InlineStack>
              {!phaseKnown && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("disputes.unknownPhaseWarning")}
                </Text>
              )}
              <Text as="p" variant="bodyMd">
                {dispute.phase === "inquiry"
                  ? t("disputes.inquiryHeroExplain")
                  : t("disputes.chargebackHeroExplain")}
              </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {latestPackStatus === "building" || latestPackStatus === "queued"
                    ? t("disputes.caseStatusBuilding")
                    : latestPackStatus === "ready"
                      ? t("disputes.caseStatusReady")
                      : latestPackStatus === "saved_to_shopify"
                        ? t("disputes.caseStatusSaved")
                        : latestPackStatus
                          ? t("disputes.caseStatusReview")
                          : t("disputes.caseStatusNoPack")}
                </Text>
              </BlockStack>
            </Card>
        </Layout.Section>

        {/* KPI cards */}
        <Layout.Section>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <p className={styles.kpiLabel}>{t("disputes.amount")}</p>
              <p className={styles.kpiAmount}>
                {formatCurrency(dispute.amount, dispute.currency_code)}
              </p>
            </div>

            <div className={styles.kpiCard}>
              <p className={styles.kpiLabel}>{t("table.status")}</p>
              <div style={{ marginTop: "4px" }}>
                <Badge tone={statusTone(dispute.status)}>
                  {statusLabel(dispute.status, t)}
                </Badge>
              </div>
            </div>

            <div className={styles.kpiCard}>
              <p className={styles.kpiLabel}>{t("disputes.dueDate")}</p>
              <p className={styles.kpiValue}>{formatDate(dispute.due_at)}</p>
            </div>

            <div className={`${styles.kpiCard} ${deadline.urgent ? styles.kpiCardUrgent : ""}`}>
              <p className={styles.kpiLabel}>{t("disputes.timeLeft")}</p>
              <div className={styles.kpiRow}>
                {deadline.urgent && (
                  <Icon source={AlertTriangleIcon} tone="critical" />
                )}
                <p className={deadline.urgent ? styles.kpiValueUrgent : styles.kpiValue}>
                  {deadline.text}
                </p>
              </div>
            </div>
          </div>
        </Layout.Section>

        {/* Case Metadata Bar */}
        <Layout.Section>
          <Card>
            <InlineStack gap="300" wrap blockAlign="center">
              {/* Phase */}
              <InlineStack gap="100" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">{t("disputes.phaseLabel")}:</Text>
                {dispute.phase ? (
                  <Badge tone={phaseBadgeTone(dispute.phase as DisputePhase | null)}>
                    {phaseLabelFn(dispute.phase as DisputePhase | null, t)}
                  </Badge>
                ) : (
                  <Badge>{t("disputes.phaseUnknown")}</Badge>
                )}
              </InlineStack>
              {/* Family */}
              <InlineStack gap="100" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">{t("disputes.familyLabel")}:</Text>
                <Text as="span" variant="bodySm">
                  {dispute.family ?? deriveFamily(dispute.reason)}
                </Text>
              </InlineStack>
              {/* Handling Mode */}
              <InlineStack gap="100" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">{t("disputes.handlingModeLabel")}:</Text>
                <Badge tone={dispute.handling_mode === "automated" ? "success" : dispute.handling_mode === "review" ? "warning" : undefined}>
                  {dispute.handling_mode === "automated"
                    ? t("disputes.handlingAutomated")
                    : dispute.handling_mode === "review"
                      ? t("disputes.handlingReview")
                      : t("disputes.handlingManual")}
                </Badge>
              </InlineStack>
              {/* Needs Review */}
              {dispute.needs_review && (
                <Badge tone="warning">{t("disputes.handlingReview")}</Badge>
              )}
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Info Banner */}
        {!infoBannerDismissed && (
          <Layout.Section>
            <Banner tone={dispute.phase === "inquiry" ? "warning" : "info"} onDismiss={dismissInfoBanner}>
              <p><strong>{dispute.phase === "inquiry" ? t("disputes.inquiryInfoHeadline") : t("disputes.infoBannerHeadline")}</strong></p>
              <p>{dispute.phase === "inquiry" ? t("disputes.inquiryInfoDetail") : t("disputes.infoBannerDetail")}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Quota / pack limit error */}
        {quotaError && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={t("disputes.packLimitReached")}
              action={{ content: t("disputes.upgradePlan"), url: "/app/billing" }}
              onDismiss={() => setQuotaError(null)}
            >
              <p>{quotaError}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Dispute Status Stepper */}
        <Layout.Section>
          <DisputeStatusStepper steps={progressSteps} t={t} formatDate={formatDate} />
        </Layout.Section>

        {/* Two-column: Dispute Summary (left) + Managed/Evidence (right) */}
        <Layout.Section>
          <div className={styles.twoColumnLayout}>
            {/* LEFT: Dispute Summary */}
            <Card padding="0">
              <div
                className={styles.collapsibleHeader}
                onClick={() => setSummaryOpen((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSummaryOpen((v) => !v); }}
              >
                <Text as="h2" variant="headingSm">{t("disputes.disputeSummary")}</Text>
                <span className={`${styles.collapsibleHeaderIcon} ${summaryOpen ? styles.collapsibleHeaderIconOpen : ""}`}>
                  <Icon source={ChevronDownIcon} tone="subdued" />
                </span>
              </div>
              <Collapsible open={summaryOpen} id="dispute-summary" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
                <div className={styles.summaryGrid}>
                  <SummaryItem label={t("disputes.disputeId")} value={disputeNumericId} />
                  <SummaryItem label={t("disputes.source")} value="Shopify Payments" />
                  <SummaryItem label={t("disputes.transactionId")} value={dispute.dispute_evidence_gid?.split("/").pop()?.slice(0, 4) + "xx" || "—"} />
                  <SummaryItem label={t("disputes.rrn")} value="—" />
                  <SummaryItem label={t("disputes.openedOn")} value={formatDate(dispute.initiated_at)} />
                  <SummaryItem
                    label={t("table.status")}
                    value={
                      <Badge tone={statusTone(dispute.status)}>
                        {statusLabel(dispute.status, t)}
                      </Badge>
                    }
                  />
                  <SummaryItem label={t("disputes.dueDate")} value={formatDate(dispute.due_at)} />
                  <SummaryItem label={t("disputes.state")} value={deadline.urgent ? <span style={{ color: "#EF4444", fontWeight: 600 }}>{deadline.text}</span> : deadline.text} />
                  <SummaryItem label={t("disputes.amount")} value={formatCurrency(dispute.amount, dispute.currency_code)} />
                  <SummaryItem label={t("disputes.reason")} value={dispute.reason?.replace(/_/g, " ") ?? "—"} />
                </div>
              </Collapsible>
            </Card>

            {/* RIGHT: Managed + Evidence stacked */}
            <div className={styles.rightColumn}>
              {/* Managed by DisputeDesk */}
              <Card padding="0">
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <span style={{ display: "inline-flex", color: "var(--p-color-text-subdued)" }}>
                        <Icon source={CheckCircleIcon} tone="subdued" />
                      </span>
                      <Text as="h2" variant="headingSm">{t("disputes.managedByDisputeDesk")}</Text>
                    </InlineStack>
                  </InlineStack>
                </div>
                <div className={styles.managedCardContent}>
                  <div className={styles.managedAutomationRow}>
                    <div className={styles.managedAutomationIcon}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                    </div>
                    <div>
                      <p className={styles.managedTitle}>{t("disputes.fullyAutomated")}</p>
                      <p className={styles.managedDesc}>{t("disputes.fullyAutomatedDesc")}</p>
                    </div>
                  </div>
                  {matchedRule && (
                    <div className={styles.managedStatusRow}>
                      <span className={styles.managedStatusDot} />
                      <div>
                        <p className={styles.managedStatusLabel}>{t("disputes.autoPackActive")}</p>
                        <p className={styles.managedStatusRule}>
                          {t("disputes.autoPackTriggered", { name: matchedRule.name ?? "Default" })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* More Evidence */}
              <Card padding="0">
                <div className={styles.moreEvidenceHeader}>
                  <p className={styles.moreEvidenceTitle}>{t("disputes.moreEvidenceTitle")}</p>
                  <span className={styles.moreEvidenceCount}>{t("disputes.moreEvidenceFileCount", { count: 0, max: 5 })}</span>
                </div>
                <div
                  className={`${styles.moreEvidenceZone} ${!packForSupplemental ? styles.moreEvidenceZoneDisabled : ""}`}
                >
                  <div className={styles.moreEvidenceUploadIcon}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {packForSupplemental
                      ? t("disputes.moreEvidenceBody")
                      : isSubmittedToBank
                        ? t("disputes.uploadsSubmittedToBank")
                        : t("disputes.uploadsUnavailable")}
                  </Text>
                  {packForSupplemental && (
                    <div className={styles.moreEvidenceLink}>
                      <Button
                        url={withShopParams(`/app/packs/${packForSupplemental.id}`, searchParams)}
                      >
                        {t("disputes.moreEvidenceCta")}
                      </Button>
                    </div>
                  )}
                </div>
                <div className={styles.moreEvidenceFooter}>
                  <p className={styles.moreEvidenceFooterText}>
                    {t("disputes.uploadsAvailableHint")}
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </Layout.Section>

        {/* Order Data (collapsible) */}
        <Layout.Section>
          <Card padding="0">
            <div
              className={styles.collapsibleHeader}
              onClick={() => setOrderDataOpen((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOrderDataOpen((v) => !v); }}
            >
              <Text as="h2" variant="headingSm">{t("disputes.orderData")}</Text>
              <span className={`${styles.collapsibleHeaderIcon} ${orderDataOpen ? styles.collapsibleHeaderIconOpen : ""}`}>
                <Icon source={ChevronDownIcon} tone="subdued" />
              </span>
            </div>
            <Collapsible open={orderDataOpen} id="order-data" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
              <Box padding="400">
                <div className={styles.profileGrid}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <Icon source={PersonIcon} tone="subdued" />
                      <Text as="h3" variant="headingSm">{t("disputes.customerInfo")}</Text>
                    </div>
                    <BlockStack gap="200">
                      <ProfileRow label={t("disputes.name")} value={profile?.customerName ?? "—"} />
                      <ProfileRow label={t("disputes.email")} value={profile?.email ?? "—"} />
                      <ProfileRow label={t("disputes.phone")} value={profile?.phone ?? "—"} />
                      <ProfileRow
                        label={t("disputes.address")}
                        value={formatAddress(profile?.displayAddress ?? profile?.shippingAddress)}
                      />
                    </BlockStack>
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <Icon source={OrderIcon} tone="subdued" />
                      <Text as="h3" variant="headingSm">{t("disputes.orderDetails")}</Text>
                    </div>
                    <BlockStack gap="200">
                      <ProfileRow
                        label={t("disputes.orderId")}
                        value={
                          profile?.orderName
                            ? (shopDomain && orderNum ? (
                                <a
                                  href={`https://${shopDomain}/admin/orders/${orderNum}`}
                                  target="_top"
                                  style={{ color: "#1D4ED8", textDecoration: "none" }}
                                >
                                  {profile.orderName}
                                </a>
                              ) : profile.orderName)
                            : orderNum ? `#${orderNum}` : "—"
                        }
                      />
                      <ProfileRow label={t("disputes.date")} value={formatDate(profile?.createdAt ?? null)} />
                      {profile?.total && (
                        <ProfileRow
                          label="Total"
                          value={formatCurrency(parseFloat(profile.total.amount), profile.total.currencyCode)}
                        />
                      )}
                      {profile?.fulfillments && profile.fulfillments.flatMap((f) => f.trackingInfo).length > 0 && (
                        profile.fulfillments.flatMap((f) => f.trackingInfo).slice(0, 2).map((trk, i) => (
                          <ProfileRow
                            key={i}
                            label={t("disputes.tracking")}
                            value={
                              trk.url ? (
                                <a href={trk.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1D4ED8", fontFamily: "monospace", fontSize: "12px" }}>
                                  {trk.number}
                                </a>
                              ) : (
                                <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{trk.number}</span>
                              )
                            }
                          />
                        ))
                      )}
                    </BlockStack>
                  </div>
                </div>
              </Box>
            </Collapsible>
          </Card>
        </Layout.Section>

        {/* Fulfillment Journey (collapsible) */}
        {timeline.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              <div
                className={styles.collapsibleHeader}
                onClick={() => setFulfillmentOpen((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFulfillmentOpen((v) => !v); }}
              >
                <Text as="h2" variant="headingSm">{t("disputes.fulfillmentJourney")}</Text>
                <span className={`${styles.collapsibleHeaderIcon} ${fulfillmentOpen ? styles.collapsibleHeaderIconOpen : ""}`}>
                  <Icon source={ChevronDownIcon} tone="subdued" />
                </span>
              </div>
              <Collapsible open={fulfillmentOpen} id="fulfillment-journey" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
                <Box padding="400">
                  <div className={styles.timelineList}>
                    {timeline.map((item, idx) => (
                      <div
                        key={idx}
                        className={`${styles.timelineRow} ${idx < timeline.length - 1 ? styles.timelineRowSpaced : ""}`}
                      >
                        <div className={styles.timelineRail}>
                          <div className={styles.timelineDot} />
                          {idx < timeline.length - 1 ? <div className={styles.timelineLine} /> : null}
                        </div>
                        <div>
                          <p className={styles.timelineMeta}>{formatDateTime(item.date)}</p>
                          <p className={styles.timelineLabel}>{item.label}</p>
                          {item.sublabel ? (
                            <p className={styles.timelineSub}>{item.sublabel}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </Box>
              </Collapsible>
            </Card>
          </Layout.Section>
        )}

        {/* Evidence Packs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={NoteIcon} tone="subdued" />
                  <Text as="h2" variant="headingSm">{t("disputes.evidencePacks")}</Text>
                </InlineStack>
                <Button onClick={handleGenerate} loading={generating || templateCheckLoading} size="slim">
                  {t("disputes.generateNewPack")}
                </Button>
              </InlineStack>

              {packs.length === 0 ? (
                <>
                  <Divider />
                  <Text as="p" tone="subdued">{t("disputes.noPacks")}</Text>
                </>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className={styles.evidenceTable}>
                    <thead>
                      <tr>
                        {[t("table.pack"), t("table.status"), t("table.score"), t("disputes.blockers"), t("table.created"), t("table.actions")].map((h) => (
                          <th key={h} className={styles.evidenceTh}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {packs.map((p) => (
                        <tr key={p.id}>
                          <td className={styles.evidenceTd}>
                            <a href={withShopParams(`/app/packs/${p.id}`, searchParams)} style={{ color: "#1D4ED8", fontWeight: 500, textDecoration: "none" }}>
                              {p.id.slice(0, 8)}
                            </a>
                          </td>
                          <td className={styles.evidenceTd}>
                            <Badge tone={packStatusTone(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                          </td>
                          <td className={styles.evidenceTd}>
                            {p.completeness_score != null ? (
                              <span style={{ color: p.completeness_score >= 80 ? "#22C55E" : p.completeness_score >= 50 ? "#F59E0B" : "#EF4444", fontWeight: 500 }}>
                                {p.completeness_score}%
                              </span>
                            ) : "—"}
                          </td>
                          <td className={styles.evidenceTd} style={{ color: "#667085" }}>
                            {p.blockers && p.blockers.length > 0 ? p.blockers.length + " blocker(s)" : t("common.none")}
                          </td>
                          <td className={styles.evidenceTd} style={{ color: "#667085", whiteSpace: "nowrap" }}>
                            {formatDate(p.created_at)}
                          </td>
                          <td className={styles.evidenceTd}>
                            {p.status === "saved_to_shopify" && p.saved_to_shopify_at ? (
                              <span style={{ fontSize: "12px", color: "#22C55E", display: "flex", alignItems: "center", gap: "4px" }}>
                                <Icon source={CheckCircleIcon} tone="success" />
                                {t("disputes.saved", { date: formatDate(p.saved_to_shopify_at) })}
                              </span>
                            ) : (
                              <a href={withShopParams(`/app/packs/${p.id}`, searchParams)} style={{ color: "#1D4ED8", textDecoration: "none", fontSize: "13px" }}>
                                {t("table.viewDetails")}
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title={matchedTemplate ? t("disputes.templateFound") : t("disputes.noTemplate")}
        primaryAction={
          matchedTemplate
            ? {
                content: t("disputes.useTemplate"),
                onAction: () => doGenerateFromTemplate(matchedTemplate.id),
                loading: generating,
              }
            : {
                content: t("disputes.goToTemplateLibrary"),
                onAction: () => {
                  setShowTemplateModal(false);
                  router.push(withShopParams("/app/packs", searchParams));
                },
              }
        }
        secondaryActions={[{
          content: t("disputes.generateBasic"),
          onAction: doGenerate,
        }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {matchedTemplate
              ? t("disputes.templateFoundBody", { name: matchedTemplate.name })
              : t("disputes.noTemplateBody")}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
