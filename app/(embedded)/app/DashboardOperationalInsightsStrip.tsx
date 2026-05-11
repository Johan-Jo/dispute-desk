"use client";

/**
 * Compact insight strip — Tier 2 dashboard consolidation.
 *
 * Replaces the previous 6-card fraud-intelligence grid + the
 * dismissible blue insight banner with a single observational card.
 * Carries three sentences (orders analyzed, high-risk %, high-risk
 * fulfilled %) and one CTA into the deep `/app/insights/initial-analysis`
 * page where the full KPI breakdown lives.
 *
 * Why one strip instead of a panel:
 *   - Risk intelligence is secondary/contextual. Operations are the
 *     primary daily-use surface. Equal-weight rendering made the
 *     dashboard feel like two products stacked on one page.
 *   - The merchant's eye should settle on the operational queue, not
 *     bounce between dispute KPIs and fraud KPIs.
 *   - The deep metrics still exist on the insights page — this strip
 *     is the contextual entry point, not the destination.
 *
 * Not a banner. Not dismissible. Not loud. A footnote that says
 * "here's what we observed; explore if you want." No verdicts, no
 * recommendations, no severity colors.
 *
 * State machine:
 *   - complete   → three-sentence observational summary + CTA.
 *   - in_progress / not_started → "preparing" copy, no CTA.
 *   - failed     → render nothing (silent — covered by the scope
 *                   banner or future failure surface).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";

interface StripData {
  ordersAnalyzed: number;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  importStatus: "not_started" | "in_progress" | "complete" | "failed";
}

export function DashboardOperationalInsightsStrip() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [data, setData] = useState<StripData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/insights/initial-analysis")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setData({
          ordersAnalyzed: d.ordersAnalyzed ?? 0,
          highRiskPct: d.highRiskPct,
          fulfilledHighRiskPct: d.fulfilledHighRiskPct,
          importStatus: d.historicalImportStatus,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  if (data.importStatus === "failed") return null;

  const isComplete = data.importStatus === "complete";
  const body = isComplete
    ? t("fraudIntel.stripBody", {
        count: data.ordersAnalyzed.toLocaleString(),
        high: data.highRiskPct?.toFixed(1) ?? "—",
        fulfilled: data.fulfilledHighRiskPct?.toFixed(0) ?? "—",
      })
    : t("fraudIntel.stripPreparingBody");

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingSm">
          {t("fraudIntel.stripTitle")}
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued">
          {body}
        </Text>
        {isComplete ? (
          <InlineStack>
            <Link
              href={withShopParams(
                "/app/insights/initial-analysis",
                searchParams ?? new URLSearchParams(),
              )}
              style={{ textDecoration: "none" }}
            >
              <Button>{t("fraudIntel.stripCta")}</Button>
            </Link>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
