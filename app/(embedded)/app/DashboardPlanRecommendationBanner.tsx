"use client";

/**
 * Dashboard plan-recommendation banner (PR 2).
 *
 * A compact nudge on the embedded dashboard that mirrors the full
 * PlanRecommendationCard living on the Risk Intelligence page. It exists
 * so a Free merchant who never reopens the analysis page still sees the
 * sizing suggestion where they spend most of their time.
 *
 * Data: GET /api/billing/plan-recommendation reads the persisted
 * `plan_recommendations` row (written by the insights endpoint on page
 * view and refreshed monthly by /api/cron/plan-recommendations). The
 * server folds the dismissal rule into a `show` flag — dismissing a plan
 * hides the banner only while that exact plan stays recommended.
 *
 * CTA navigates to the Risk Intelligence page, where the detailed
 * comparison card + subscribe CTA live, rather than duplicating the
 * subscribe flow here.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Banner, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";
import type { PlanId } from "@/lib/billing/plans";

interface BannerRecommendation {
  recommendedPlan: PlanId;
  monthlyChargebacks: number;
  headroomMultiplier: number | null;
  reason: string;
  partialHistory: boolean;
}

export function DashboardPlanRecommendationBanner() {
  const t = useTranslations();
  const [rec, setRec] = useState<BannerRecommendation | null>(null);
  // Optimistic dismissal — hide immediately, let the POST catch up.
  const [optimisticDismissed, setOptimisticDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/plan-recommendation")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d || !d.show || !d.recommendation) return;
        setRec(d.recommendation as BannerRecommendation);
      })
      .catch(() => {
        /* swallow — banner just won't render */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rec || optimisticDismissed) return null;

  const planName = t(`billing.${rec.recommendedPlan}`);

  const onDismiss = () => {
    setOptimisticDismissed(true);
    fetch("/api/billing/plan-recommendation/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {
      /* swallow — re-shows on next load, the right failure mode */
    });
  };

  const onView = () => {
    const sp = new URLSearchParams(window.location.search);
    const qs = sp.toString();
    window.location.href = qs
      ? `/app/insights/initial-analysis?${qs}`
      : "/app/insights/initial-analysis";
  };

  return (
    <Banner
      tone="info"
      onDismiss={onDismiss}
      title={t("billing.recommendation.bannerTitle", { plan: planName })}
    >
      <BlockStack gap="200">
        <Text as="p">
          {t("billing.recommendation.bannerBody", {
            plan: planName,
            rate: rec.monthlyChargebacks.toLocaleString(),
          })}
        </Text>
        <InlineStack gap="200">
          <Button variant="primary" onClick={onView}>
            {t("billing.recommendation.bannerCta")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
