"use client";

/**
 * PlanRecommendationCard — surfaces the post-import plan suggestion
 * on the Risk Intelligence page. The page already does the analysis;
 * this card is its conclusion: "Based on N chargebacks/month, here's
 * the plan that fits."
 *
 * Server decides whether to render: see `recommendation` field on
 * /api/dashboard/insights/initial-analysis (null when the merchant
 * is already on a paid plan or the historical import isn't complete).
 *
 * CTA goes through the existing /api/billing/subscribe path — same
 * 14-day trial behavior as the billing page (per user decision: trial
 * mechanics are unchanged regardless of how the merchant arrives at
 * the upgrade).
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { redirectTopLevel } from "@/lib/shopify/redirectTopLevel";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Divider,
} from "@shopify/polaris";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import type {
  PlanRecommendation,
  RecommendationReason,
} from "@/lib/billing/recommendPlan";

type FitVariant = "recommended" | "below" | "tight" | "generous";

/** Per-plan fit relative to the merchant's monthly volume. The
 *  recommended plan is always tagged "recommended"; others get a
 *  relative label so the merchant can see why the recommendation
 *  beat its neighbors. */
function fitFor(
  plan: PlanId,
  recommended: PlanId,
  monthlyChargebacks: number,
): FitVariant {
  if (plan === recommended) return "recommended";
  if (plan === "free") {
    // Free is lifetime-capped (3 packs total) — anything but a true
    // zero-volume shop blows past it.
    return monthlyChargebacks > 0 ? "below" : "tight";
  }
  const cap = PLANS[plan].packsPerMonth;
  if (cap < monthlyChargebacks) return "below";
  if (cap > monthlyChargebacks * 8) return "generous";
  return "tight";
}

function fitTone(v: FitVariant): "success" | "attention" | "info" | undefined {
  if (v === "recommended") return "success";
  if (v === "below") return "attention";
  return "info";
}

export function PlanRecommendationCard({
  recommendation,
  ordersAnalyzed,
  chargebackOrders90d,
}: {
  recommendation: PlanRecommendation;
  ordersAnalyzed: number;
  chargebackOrders90d: number;
}) {
  const t = useTranslations();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recommendedPlanName = t(`billing.${recommendation.recommendedPlan}`);

  const handleStartTrial = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sp = new URLSearchParams(window.location.search);
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: recommendation.recommendedPlan,
          host: sp.get("host") ?? undefined,
          shop: sp.get("shop") ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.confirmationUrl) {
        redirectTopLevel(data.confirmationUrl);
        return;
      }
      setError(typeof data.error === "string" ? data.error : t("billing.upgradeFailed"));
    } catch {
      setError(t("billing.upgradeFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [recommendation.recommendedPlan, t]);

  const handleSeePlans = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    const qs = sp.toString();
    window.location.href = qs ? `/app/billing?${qs}` : "/app/billing";
  }, []);

  // Reason copy carries {plan} where applicable. We pass the
  // already-localized plan name so the leaf message reads naturally.
  const reasonKey: Record<RecommendationReason, string> = {
    no_history: "billing.recommendation.reason_no_history",
    low_volume: "billing.recommendation.reason_low_volume",
    volume_fits: "billing.recommendation.reason_volume_fits",
    spike_observed: "billing.recommendation.reason_spike_observed",
  };

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingLg">
              {t("billing.recommendation.cardTitle", { plan: recommendedPlanName })}
            </Text>
            <Badge tone="success">{t("billing.recommendation.compareFitRecommended")}</Badge>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodyMd">
            {t("billing.recommendation.subtitle", {
              orders: ordersAnalyzed.toLocaleString(),
              chargebacks: chargebackOrders90d.toLocaleString(),
            })}
          </Text>
        </BlockStack>

        {recommendation.partialHistory ? (
          <Banner tone="info">
            <p>{t("billing.recommendation.partialHistoryNote")}</p>
          </Banner>
        ) : null}

        {recommendation.recommendedPlan !== "free" ? (
          <InlineStack gap="400" wrap={false} blockAlign="center">
            <Text as="span" variant="bodyLg" fontWeight="semibold">
              {t("billing.recommendation.monthlyVolume", {
                rate: recommendation.monthlyChargebacks.toLocaleString(),
              })}
            </Text>
            {recommendation.headroomMultiplier !== null ? (
              <Text as="span" variant="bodyMd" tone="subdued">
                {t("billing.recommendation.headroomNote", {
                  multiplier: recommendation.headroomMultiplier.toLocaleString(),
                })}
              </Text>
            ) : null}
          </InlineStack>
        ) : null}

        <Text as="p" variant="bodyMd">
          {t(reasonKey[recommendation.reason], { plan: recommendedPlanName })}
        </Text>

        <Divider />

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            {t("billing.recommendation.compareHeader")}
          </Text>
          <BlockStack gap="100">
            {(["free", "starter", "growth", "scale"] as PlanId[]).map((p) => {
              const def = PLANS[p];
              const fit = fitFor(p, recommendation.recommendedPlan, recommendation.monthlyChargebacks);
              const capLabel =
                p === "free" && def.packsLifetime !== undefined
                  ? t("billing.recommendation.compareCapLifetime", {
                      count: def.packsLifetime,
                    })
                  : t("billing.recommendation.compareCapPerMonth", {
                      count: def.packsPerMonth,
                    });
              const fitLabel = t(
                fit === "recommended" ? "billing.recommendation.compareFitRecommended" :
                fit === "below"       ? "billing.recommendation.compareFitBelow" :
                fit === "tight"       ? "billing.recommendation.compareFitTight" :
                                        "billing.recommendation.compareFitGenerous",
              );
              return (
                <InlineStack
                  key={p}
                  gap="300"
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                >
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Text
                      as="span"
                      variant="bodyMd"
                      fontWeight={fit === "recommended" ? "semibold" : "regular"}
                    >
                      {t(`billing.${p}`)}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {capLabel}
                    </Text>
                  </InlineStack>
                  <Badge tone={fitTone(fit)}>{fitLabel}</Badge>
                </InlineStack>
              );
            })}
          </BlockStack>
        </BlockStack>

        {error ? (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        ) : null}

        {recommendation.recommendedPlan !== "free" ? (
          <>
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={submitting}
                onClick={handleStartTrial}
              >
                {t("billing.recommendation.ctaStartTrial", { plan: recommendedPlanName })}
              </Button>
              <Button variant="plain" onClick={handleSeePlans}>
                {t("billing.recommendation.ctaSeePlans")}
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("billing.recommendation.ctaStaysFreeFooter")}
            </Text>
          </>
        ) : null}
      </BlockStack>
    </Card>
  );
}
