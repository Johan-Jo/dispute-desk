"use client";

/**
 * Phase 1 Shopify Fraud Intelligence — onboarding insight banner.
 *
 * Renders ONLY after the historical import completes
 * (`historical_import_status = 'complete'`). Dismissible — the
 * permanent home for this content is `/app/insights/initial-analysis`.
 *
 * Copy contract (load-bearing — must not regress):
 *   - Headline LEADS with insight ("We analyzed N orders"), never
 *     with the chargeback-health verdict.
 *   - Body cites concrete percentages from the actual data.
 *   - Chargeback-health status is a SECONDARY/SUPPORTING line, lower
 *     in visual hierarchy — never headline weight.
 *
 * The PRD's original wording "Your current chargeback health is At Risk"
 * as the dominant onboarding message was explicitly REJECTED. The
 * banner must create curiosity and perceived value, not defensive
 * reaction.
 *
 * Dismissal: localStorage flag, per-device. Multi-device server-side
 * dismissal can come in Phase 1.1 — for v1 the dashboard already
 * gates re-render on a stable flag so re-opening the embedded app on
 * the same device respects the dismissal.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Button,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";

const STORAGE_KEY = "dd_fraud_intel_banner_dismissed";

interface BannerData {
  ordersAnalyzed: number;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  chargebackHealthStatus: "good" | "at_risk" | "elevated" | "unknown";
  /** When false, the supporting line shows "Insufficient dispute
   *  history" instead of a colored verdict — protects low-volume
   *  shops from misleading severity labels on tiny denominators. */
  chargebackHealthAvailable: boolean;
}

/** Pure: classify chargeback health by 90d rate. Mirrors the bands
 *  used elsewhere in the app — never widens. */
export function classifyChargebackHealth(
  rate: number | null,
): BannerData["chargebackHealthStatus"] {
  if (rate === null) return "unknown";
  if (rate < 0.4) return "good";
  if (rate <= 0.6) return "at_risk";
  return "elevated";
}

/** Self-fetching wrapper — drop-in dashboard slot. Fetches the
 *  insights endpoint and renders the banner only when:
 *    - the historical import is complete,
 *    - localStorage hasn't recorded a dismissal.
 */
export function DashboardInitialAnalysisBannerWrapper() {
  const [bannerData, setBannerData] = useState<BannerData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/insights/initial-analysis")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        if (d.historicalImportStatus !== "complete") return;
        setBannerData({
          ordersAnalyzed: d.ordersAnalyzed ?? 0,
          highRiskPct: d.highRiskPct ?? null,
          fulfilledHighRiskPct: d.fulfilledHighRiskPct ?? null,
          chargebackHealthStatus: d.chargebackHealth ?? "unknown",
          chargebackHealthAvailable: d.chargebackHealthAvailable ?? false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <DashboardInitialAnalysisBanner bannerData={bannerData} />;
}

export function DashboardInitialAnalysisBanner({
  bannerData,
}: {
  bannerData: BannerData | null;
}) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    // Defer reading localStorage to after mount so SSR doesn't flash.
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable (private mode, etc) → never dismissed.
    }
    setHydrated(true);
  }, []);

  if (!hydrated || dismissed || !bannerData) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setDismissed(true);
  };

  // Verdict gate: only render the colored severity status when the
  // 90-day order denominator is statistically meaningful. Otherwise
  // surface "Insufficient dispute history" — observational, no
  // implied judgement. Protects low-volume merchants from anxiety
  // built on 3 disputes over 60 days.
  const healthLine = bannerData.chargebackHealthAvailable
    ? t("fraudIntel.bannerHealthLine", {
        status: t(`fraudIntel.bannerHealth_${bannerData.chargebackHealthStatus}`),
      })
    : t("fraudIntel.bannerHealthInsufficient");

  return (
    <Banner
      tone="info"
      onDismiss={onDismiss}
      title={t("fraudIntel.bannerHeadline", {
        count: bannerData.ordersAnalyzed.toLocaleString(),
      })}
    >
      <BlockStack gap="300">
        <Text as="p">
          {t("fraudIntel.bannerBody", {
            high: bannerData.highRiskPct?.toFixed(1) ?? "—",
            fulfilled: bannerData.fulfilledHighRiskPct?.toFixed(0) ?? "—",
          })}
        </Text>
        {/* Secondary line, intentionally lower visual hierarchy. */}
        <Text as="p" variant="bodySm" tone="subdued">
          {healthLine}
        </Text>
        <InlineStack gap="200">
          {/* Two CTAs with genuinely different destinations:
              - Risk Analysis → the insights page (intelligence path).
              - Dispute Queue → the operational workflow (action path).
              No "Improve Dispute Operations" framing because that
              implies recommendations we don't yet have data to make. */}
          <Link
            href={withShopParams(
              "/app/insights/initial-analysis",
              searchParams ?? new URLSearchParams(),
            )}
            style={{ textDecoration: "none" }}
          >
            <Button variant="primary">{t("fraudIntel.bannerCtaRiskAnalysis")}</Button>
          </Link>
          <Link
            href={withShopParams(
              "/app/disputes",
              searchParams ?? new URLSearchParams(),
            )}
            style={{ textDecoration: "none" }}
          >
            <Button>{t("fraudIntel.bannerCtaDisputeQueue")}</Button>
          </Link>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
