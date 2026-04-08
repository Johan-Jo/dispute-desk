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
} from "@shopify/polaris";
import {
  OrderIcon,
  PersonIcon,
  NoteIcon,
  ClockIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";

import styles from "./dispute-detail.module.css";
import { DisputeStatusStepper } from "./DisputeStatusStepper";
import { getDisputeProgressSteps } from "@/lib/embedded/disputeDetailProgress";

interface Dispute {
  id: string;
  dispute_gid: string;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
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

  // Real Shopify order events — message is pre-localized by Shopify to the store language
  for (const e of orderEvents) {
    events.push({
      date: e.createdAt,
      label: stripHtml(e.message),
      sublabel: e.appTitle ?? "Shopify",
    });
  }

  // DisputeDesk-specific events not present in Shopify's order event feed
  const saved = packs.find((p) => p.saved_to_shopify_at);
  if (saved?.saved_to_shopify_at) {
    events.push({ date: saved.saved_to_shopify_at, label: t("disputes.evidenceSavedToShopify") });
  }
  if (packs.length > 0) {
    events.push({ date: packs[packs.length - 1].created_at, label: t("disputes.evidencePackGenerated") });
  }

  // Sort descending (newest first)
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events;
}

function KpiCard({
  label,
  children,
  urgent,
}: {
  label: string;
  children: React.ReactNode;
  urgent?: boolean;
}) {
  return (
    <div className={`${styles.kpiCard} ${urgent ? styles.kpiCardUrgent : ""}`}>
      <p className={styles.kpiLabel}>{label}</p>
      {children}
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

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profile, setProfile] = useState<DisputeProfile | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateCheckLoading, setTemplateCheckLoading] = useState(false);
  const [matchedTemplate, setMatchedTemplate] = useState<{ id: string; name: string } | null>(null);

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
      const res = await fetch(
        `/api/templates?reason=${encodeURIComponent(reason)}&locale=${encodeURIComponent(locale)}`
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
  const orderNum = dispute.order_gid?.split("/").pop();
  const disputeUrl =
    shopDomain && dispute.dispute_gid
      ? getShopifyDisputeUrl(shopDomain, dispute.dispute_gid)
      : null;
  const deadline = daysUntilInfo(dispute.due_at);
  const timeline = buildTimeline(packs, profile?.orderEvents ?? [], t);

  const orderLabel =
    profile?.orderName ??
    (dispute.dispute_gid.split("/").pop()
      ? `#${dispute.dispute_gid.split("/").pop()}`
      : "—");

  return (
    <Page
      title={t("disputes.detailPageTitle")}
      subtitle={t("disputes.detailPageSubtitle", { orderLabel })}
      backAction={{ content: t("disputes.title"), url: withShopParams("/app/disputes", searchParams) }}
      titleMetadata={isSynthetic ? <Badge tone="info">Synthetic</Badge> : undefined}
      primaryAction={{
        content: generating || templateCheckLoading ? t("disputes.generating") : t("disputes.generatePack"),
        onAction: handleGenerate,
        loading: generating || templateCheckLoading,
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

        {/* KPI cards */}
        <Layout.Section>
          <div className={styles.kpiGrid}>
            <KpiCard label={t("disputes.amount")}>
              <p className={styles.kpiAmount}>
                {formatCurrency(dispute.amount, dispute.currency_code)}
              </p>
            </KpiCard>

            <KpiCard label={t("table.status")}>
              <div style={{ marginTop: "4px" }}>
                <Badge tone={statusTone(dispute.status)}>
                  {statusLabel(dispute.status, t)}
                </Badge>
              </div>
            </KpiCard>

            <KpiCard label={t("disputes.dueDate")}>
              <p className={styles.kpiValue}>{formatDate(dispute.due_at)}</p>
            </KpiCard>

            <KpiCard label={t("disputes.timeLeft")} urgent={deadline.urgent}>
              <div className={styles.kpiRow}>
                {deadline.urgent && (
                  <Icon source={AlertTriangleIcon} tone="critical" />
                )}
                <p className={deadline.urgent ? styles.kpiValueUrgent : styles.kpiValue}>
                  {deadline.text}
                </p>
              </div>
            </KpiCard>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("disputes.managedByDisputeDesk")}
            </Text>
          </Box>
        </Layout.Section>

        <Layout.Section>
          <DisputeStatusStepper steps={progressSteps} t={t} formatDate={formatDate} />
        </Layout.Section>

        {/* Customer Info + Order Details */}
        <Layout.Section>
          <div className={styles.profileGrid}>
            <Card>
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
            </Card>

            <Card>
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
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <div className={styles.moreEvidenceHeader}>
              <div>
                <p className={styles.moreEvidenceTitle}>{t("disputes.moreEvidenceTitle")}</p>
              </div>
            </div>
            <div
              className={`${styles.moreEvidenceZone} ${!packForSupplemental ? styles.moreEvidenceZoneDisabled : ""}`}
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                {packForSupplemental ? t("disputes.moreEvidenceBody") : t("disputes.moreEvidenceLocked")}
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
          </Card>
        </Layout.Section>

        {/* Timeline */}
        {timeline.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" align="start" blockAlign="center">
                  <Icon source={ClockIcon} tone="subdued" />
                  <Text as="h3" variant="headingSm">{t("disputes.timeline")}</Text>
                </InlineStack>
                <Divider />
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
              </BlockStack>
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

        {/* Compliance */}
        <Layout.Section>
          <Banner tone="info">{t("disputes.compliance")}</Banner>
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
