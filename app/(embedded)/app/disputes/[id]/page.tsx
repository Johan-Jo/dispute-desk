/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/disputes/[id]/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-dispute-detail.tsx
 * Reference: dispute detail layout, evidence section, actions.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
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

function buildTimeline(
  dispute: Dispute,
  packs: Pack[],
  t: ReturnType<typeof useTranslations>
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (dispute.initiated_at) {
    events.push({ date: dispute.initiated_at, label: t("disputes.disputeInitiated") });
  }
  // Pack events — most recent saved_to_shopify first, then created
  const saved = packs.find((p) => p.saved_to_shopify_at);
  if (saved?.saved_to_shopify_at) {
    events.push({ date: saved.saved_to_shopify_at, label: t("disputes.evidenceSavedToShopify") });
  }
  if (packs.length > 0) {
    events.push({ date: packs[packs.length - 1].created_at, label: t("disputes.evidencePackGenerated") });
  }
  if (dispute.last_synced_at) {
    events.push({ date: dispute.last_synced_at, label: t("disputes.lastSynced"), sublabel: formatDateTime(dispute.last_synced_at) });
  }

  // Sort descending (newest first)
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events;
}

// KPI Card component styled like portal
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
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        border: `1px solid ${urgent ? "#EF4444" : "#E5E7EB"}`,
        padding: "16px",
        flex: "1 1 0",
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: "12px", color: "#667085", marginBottom: "4px" }}>{label}</p>
      {children}
    </div>
  );
}

// Profile row: label + value
function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "14px", paddingBottom: "8px" }}>
      <span style={{ color: "#667085", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#0B1220", fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>{value || "—"}</span>
    </div>
  );
}

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profile, setProfile] = useState<DisputeProfile | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);

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
    const [res, profileRes] = await Promise.all([
      fetch(`/api/disputes/${id}`),
      fetch(`/api/disputes/${id}/profile`),
    ]);
    const json = await res.json();
    const profileJson = await profileRes.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setShopDomain(json.shop_domain ?? null);
    setProfile(profileJson.profile ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/api/disputes/${id}/sync`, { method: "POST" });
    await fetchData();
    setSyncing(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
    } else {
      await fetchData();
    }
    setGenerating(false);
  };

  if (loading) {
    return (
      <Page title={t("disputes.title")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!dispute) {
    return (
      <Page
        title={t("disputes.title")}
        backAction={{ content: t("disputes.title"), url: "/app/disputes" }}
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
  const timeline = buildTimeline(dispute, packs, t);

  return (
    <Page
      title={t("disputes.disputeTitle", { id: dispute.dispute_gid.split("/").pop() ?? "" })}
      backAction={{ content: t("disputes.title"), url: "/app/disputes" }}
      titleMetadata={isSynthetic ? <Badge tone="info">Synthetic</Badge> : undefined}
      primaryAction={{
        content: generating ? t("disputes.generating") : t("disputes.generatePack"),
        onAction: handleGenerate,
        loading: generating,
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
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <KpiCard label={t("disputes.amount")}>
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#0B1220" }}>
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
              <p style={{ fontSize: "14px", fontWeight: 500, color: "#0B1220" }}>
                {formatDate(dispute.due_at)}
              </p>
            </KpiCard>

            <KpiCard label={t("disputes.timeLeft")} urgent={deadline.urgent}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                {deadline.urgent && (
                  <Icon source={AlertTriangleIcon} tone="critical" />
                )}
                <p style={{ fontSize: "14px", fontWeight: 500, color: deadline.urgent ? "#EF4444" : "#0B1220" }}>
                  {deadline.text}
                </p>
              </div>
            </KpiCard>
          </div>
        </Layout.Section>

        {/* Customer Info + Order Details */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {/* Customer Info */}
            <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #E5E7EB", padding: "20px" }}>
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

            {/* Order Details */}
            <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #E5E7EB", padding: "20px" }}>
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
                <div style={{ paddingTop: "4px" }}>
                  {timeline.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "16px", marginBottom: idx < timeline.length - 1 ? "20px" : 0 }}>
                      {/* dot + line */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "12px", flexShrink: 0 }}>
                        <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#1D4ED8", marginTop: "4px" }} />
                        {idx < timeline.length - 1 && (
                          <div style={{ width: "1px", flex: 1, background: "#E5E7EB", marginTop: "4px" }} />
                        )}
                      </div>
                      <div style={{ paddingBottom: "4px" }}>
                        <p style={{ fontSize: "12px", color: "#667085", marginBottom: "2px" }}>{formatDateTime(item.date)}</p>
                        <p style={{ fontSize: "14px", fontWeight: 500, color: "#0B1220" }}>{item.label}</p>
                        {item.sublabel && (
                          <p style={{ fontSize: "12px", color: "#667085" }}>{item.sublabel}</p>
                        )}
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
                <Button onClick={handleGenerate} loading={generating} size="slim">
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
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                    <thead>
                      <tr style={{ background: "#F7F8FA" }}>
                        {[t("table.pack"), t("table.status"), t("table.score"), t("disputes.blockers"), t("table.created"), t("table.actions")].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontWeight: 500, color: "#667085", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {packs.map((p) => (
                        <tr key={p.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                          <td style={{ padding: "12px 16px" }}>
                            <a href={`/app/packs/${p.id}`} style={{ color: "#1D4ED8", fontWeight: 500, textDecoration: "none" }}>
                              {p.id.slice(0, 8)}
                            </a>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <Badge tone={packStatusTone(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            {p.completeness_score != null ? (
                              <span style={{ color: p.completeness_score >= 80 ? "#22C55E" : p.completeness_score >= 50 ? "#F59E0B" : "#EF4444", fontWeight: 500 }}>
                                {p.completeness_score}%
                              </span>
                            ) : "—"}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#667085" }}>
                            {p.blockers && p.blockers.length > 0 ? p.blockers.length + " blocker(s)" : t("common.none")}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#667085", whiteSpace: "nowrap" }}>
                            {formatDate(p.created_at)}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            {p.status === "saved_to_shopify" && p.saved_to_shopify_at ? (
                              <span style={{ fontSize: "12px", color: "#22C55E", display: "flex", alignItems: "center", gap: "4px" }}>
                                <Icon source={CheckCircleIcon} tone="success" />
                                {t("disputes.saved", { date: formatDate(p.saved_to_shopify_at) })}
                              </span>
                            ) : (
                              <a href={`/app/packs/${p.id}`} style={{ color: "#1D4ED8", textDecoration: "none", fontSize: "13px" }}>
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
    </Page>
  );
}
