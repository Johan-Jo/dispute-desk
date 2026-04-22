"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Spinner,
  Text,
  useBreakpoints,
} from "@shopify/polaris";
import { shopifyOrderAdminUrl } from "@/lib/embedded/shopifyOrderUrl";
import {
  recentDisputesOrderLinkStyle,
  recentDisputesTdStyle,
  recentDisputesThStyle,
  recentDisputesViewDetailsLinkStyle,
} from "@/lib/embedded/recentDisputesTableStyles";
import { withShopParams } from "@/lib/withShopParams";
import { MobileDisputesList } from "./disputes/MobileDisputesList";
import type { Dispute } from "./disputes/disputeListHelpers";
import { safeOutcomeLabel, safeStatusLabel, useDateLocale } from "./dashboardHelpers";

interface DisputeRow {
  id: string;
  order: string;
  orderUrl: string | null;
  amount: string;
  reason: string | null;
  normalizedStatus: string | null;
  dueAt: string | null;
  initiatedAt: string | null;
  finalOutcome: string | null;
}

export function DashboardRecentDisputesPreview() {
  const t = useTranslations();
  const tPacks = useTranslations("packs");
  const tTimeline = useTranslations("disputeTimeline");
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();
  const { smDown } = useBreakpoints();
  const [rawDisputes, setRawDisputes] = useState<Dispute[]>([]);
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/disputes?per_page=8&sort=created_at&sort_dir=desc").then((r) => (r.ok ? r.json() : { disputes: [] })),
      fetch("/api/billing/usage").then((r) => (r.ok ? r.json() : {})),
    ]).then(([disputeData, usageData]: [
      { disputes?: Dispute[] },
      { shop_domain?: string | null },
    ]) => {
      if (cancelled) return;
      const shopDomain = usageData.shop_domain ?? null;
      const list = disputeData.disputes ?? [];
      setRawDisputes(list);
      setRows(
        list.map((d) => ({
          id: d.id,
          order: d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—"),
          orderUrl: shopifyOrderAdminUrl(shopDomain, d.order_gid ?? null),
          amount:
            d.amount != null
              ? new Intl.NumberFormat(dateLocale, {
                  style: "currency",
                  currency: d.currency_code ?? "USD",
                }).format(Number(d.amount))
              : "—",
          reason: d.reason ?? null,
          normalizedStatus: d.normalized_status ?? null,
          dueAt: d.due_at ?? null,
          initiatedAt: d.initiated_at ?? null,
          finalOutcome: d.final_outcome ?? null,
        })),
      );
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dateLocale]);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Text as="p" variant="bodyMd" tone="subdued">{t("dashboard.noDisputesYetDesc")}</Text>
          <Button url={withShopParams("/app/disputes", searchParams ?? new URLSearchParams())}>
            {t("dashboard.goToDisputes")}
          </Button>
        </BlockStack>
      </Card>
    );
  }

  const header = (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
      <Button variant="plain" url={withShopParams("/app/disputes", searchParams ?? new URLSearchParams())}>
        {t("common.viewAll")}
      </Button>
    </InlineStack>
  );

  if (smDown) {
    return (
      <BlockStack gap="300">
        <Card>
          {header}
        </Card>
        <MobileDisputesList
          disputes={rawDisputes}
          activeTab="active"
          searchParams={searchParams}
          dateLocale={dateLocale}
          numberLocale={dateLocale}
          t={t}
        />
      </BlockStack>
    );
  }

  const formatReason = (reason: string | null) => {
    if (!reason) return "—";
    try {
      return tPacks(`disputeTypeLabel.${reason}`);
    } catch {
      /* fallback */
    }
    return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const normalizedStatusBadge = (status: string | null) => {
    if (!status) return <Badge>{t("disputes.statusUnknown")}</Badge>;
    const toneMap: Record<string, "success" | "critical" | "warning" | "attention" | "info" | undefined> = {
      new: "info",
      in_progress: "info",
      needs_review: "attention",
      ready_to_submit: "attention",
      action_needed: "critical",
      submitted: "info",
      submitted_to_shopify: "info",
      waiting_on_issuer: "info",
      submitted_to_bank: "info",
      won: "success",
      lost: "critical",
      accepted_not_contested: undefined,
      closed_other: undefined,
    };
    return <Badge tone={toneMap[status]}>{safeStatusLabel(tTimeline, status)}</Badge>;
  };

  const outcomeBadge = (outcome: string | null) => {
    if (!outcome) return null;
    const toneMap: Record<string, "success" | "critical" | "warning" | "attention" | "info" | undefined> = {
      won: "success",
      lost: "critical",
      partially_won: "warning",
    };
    return <Badge tone={toneMap[outcome]}>{safeOutcomeLabel(tTimeline, outcome)}</Badge>;
  };

  const formatShortDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        {header}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--p-color-border)" }}>
                <th style={recentDisputesThStyle}>{t("table.order")}</th>
                <th style={recentDisputesThStyle}>{t("table.amount")}</th>
                <th style={recentDisputesThStyle}>{t("table.reason")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.statusCol")}</th>
                <th style={recentDisputesThStyle}>{t("table.date")}</th>
                <th style={recentDisputesThStyle}>{t("table.deadline")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.outcomeCol")}</th>
                <th style={recentDisputesThStyle}>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                  <td style={recentDisputesTdStyle}>
                    {r.orderUrl ? (
                      <a href={r.orderUrl} target="_top" rel="noopener noreferrer" style={recentDisputesOrderLinkStyle}>
                        {r.order}
                      </a>
                    ) : (
                      <Text as="span" variant="bodySm" fontWeight="semibold">{r.order}</Text>
                    )}
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.amount}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatReason(r.reason)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>{normalizedStatusBadge(r.normalizedStatus)}</td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {r.initiatedAt
                        ? new Date(r.initiatedAt).toLocaleString(dateLocale, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatShortDate(r.dueAt)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>{outcomeBadge(r.finalOutcome)}</td>
                  <td style={recentDisputesTdStyle}>
                    <Link
                      href={withShopParams(`/app/disputes/${r.id}`, searchParams ?? new URLSearchParams())}
                      style={recentDisputesViewDetailsLinkStyle}
                    >
                      {t("table.viewDetails")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BlockStack>
    </Card>
  );
}
