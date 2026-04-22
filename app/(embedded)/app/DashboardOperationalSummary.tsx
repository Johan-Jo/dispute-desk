"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { withShopParams } from "@/lib/withShopParams";
import styles from "./dashboard.module.css";
import type { DashboardStats } from "./dashboardHelpers";

type CounterTone = "critical" | "warning" | "subdued";

interface CounterProps {
  label: string;
  count: number;
  tone: CounterTone;
  url?: string;
  mobile?: boolean;
}

function SummaryCounter({ label, count, tone, url, mobile }: CounterProps) {
  const colors: Record<CounterTone, { bg: string; text: string; num: string }> = {
    critical: { bg: "#FEE2E2", text: "#DC2626", num: "#B91C1C" },
    warning: { bg: "#FEF3C7", text: "#D97706", num: "#B45309" },
    subdued: { bg: "#F3F4F6", text: "#6B7280", num: "#374151" },
  };
  const c = count > 0 ? colors[tone] : colors.subdued;

  if (mobile) {
    const inner = (
      <div
        className={styles.summaryCounterMobile}
        style={{ background: c.bg, cursor: url ? "pointer" : undefined }}
      >
        <p className={styles.label} style={{ color: c.text }}>{label}</p>
        <p className={styles.count} style={{ color: c.num }}>{count}</p>
      </div>
    );
    return url ? (
      <Link href={url} style={{ textDecoration: "none" }}>{inner}</Link>
    ) : inner;
  }

  const inner = (
    <div style={{
      background: c.bg,
      borderRadius: "10px",
      padding: "14px 16px",
      cursor: url ? "pointer" : undefined,
    }}>
      <p style={{ fontSize: "12px", fontWeight: 500, color: c.text, margin: 0 }}>{label}</p>
      <p style={{ fontSize: "28px", fontWeight: 700, color: c.num, margin: "4px 0 0" }}>{count}</p>
    </div>
  );
  return url ? <Link href={url} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

export function DashboardOperationalSummary({ stats, loading }: Props) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const { smDown } = useBreakpoints();
  const s = stats;

  const actionNeeded =
    (s.operationalBreakdown["new"] ?? 0) +
    (s.operationalBreakdown["action_needed"] ?? 0) +
    (s.operationalBreakdown["needs_review"] ?? 0);
  const readyToSubmit = s.operationalBreakdown["ready_to_submit"] ?? 0;
  const waitingOnIssuer =
    (s.operationalBreakdown["waiting_on_issuer"] ?? 0) +
    (s.operationalBreakdown["submitted_to_bank"] ?? 0);

  const actionNeededUrl = withShopParams(
    "/app/disputes?normalized_status=new,action_needed,needs_review",
    searchParams ?? new URLSearchParams(),
  );

  let ctaLabel = t("dashboard.viewAllDisputes");
  let ctaUrl = withShopParams("/app/disputes", searchParams ?? new URLSearchParams());
  if (actionNeeded > 0) {
    ctaLabel = t("dashboard.reviewActionNeeded", { count: actionNeeded });
    ctaUrl = actionNeededUrl;
  } else if (readyToSubmit > 0) {
    ctaLabel = t("dashboard.submitReady", { count: readyToSubmit });
    ctaUrl = withShopParams("/app/disputes?normalized_status=ready_to_submit", searchParams ?? new URLSearchParams());
  }

  const counters = (
    <>
      <SummaryCounter
        label={t("dashboard.actionNeeded")}
        count={actionNeeded}
        tone={actionNeeded > 0 ? "critical" : "subdued"}
        url={actionNeededUrl}
        mobile={smDown}
      />
      <SummaryCounter
        label={t("dashboard.readyToSubmit")}
        count={readyToSubmit}
        tone={readyToSubmit > 0 ? "warning" : "subdued"}
        url={withShopParams("/app/disputes?normalized_status=ready_to_submit", searchParams ?? new URLSearchParams())}
        mobile={smDown}
      />
      <SummaryCounter
        label={t("dashboard.waitingOnIssuer")}
        count={waitingOnIssuer}
        tone="subdued"
        url={withShopParams("/app/disputes?normalized_status=waiting_on_issuer,submitted_to_bank", searchParams ?? new URLSearchParams())}
        mobile={smDown}
      />
      <SummaryCounter
        label={t("dashboard.closedInPeriod")}
        count={s.totalClosed}
        tone="subdued"
        mobile={smDown}
      />
    </>
  );

  return (
    <Card>
      <BlockStack gap="400">
        {smDown ? (
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("dashboard.operationalSummary")}</Text>
            {s.needsAttentionCount > 0 && (
              <InlineStack>
                <Badge tone="critical">{t("dashboard.attentionCount", { count: s.needsAttentionCount })}</Badge>
              </InlineStack>
            )}
            <div className={styles.mobileFullWidth}>
              <Button variant="primary" url={ctaUrl} fullWidth>{ctaLabel}</Button>
            </div>
          </BlockStack>
        ) : (
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{t("dashboard.operationalSummary")}</Text>
            <InlineStack gap="200" blockAlign="center">
              {s.needsAttentionCount > 0 && (
                <Badge tone="critical">{t("dashboard.attentionCount", { count: s.needsAttentionCount })}</Badge>
              )}
              <Button variant="primary" size="slim" url={ctaUrl}>{ctaLabel}</Button>
            </InlineStack>
          </InlineStack>
        )}

        {loading ? (
          <InlineStack align="center"><Spinner size="small" /></InlineStack>
        ) : smDown ? (
          <div className={styles.mobileGrid2}>{counters}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
            {counters}
          </div>
        )}
      </BlockStack>
    </Card>
  );
}
