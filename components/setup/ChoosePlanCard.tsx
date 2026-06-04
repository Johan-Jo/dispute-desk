"use client";

/**
 * ChoosePlanCard — the FINAL step of onboarding, rendered on the post-wizard
 * completion screen (/app/setup/complete). The merchant has finished the 6
 * setup steps; here they confirm the plan they picked on the marketing pricing
 * page (carried in via sessionStorage — see lib/setup/installPlan.ts) and start
 * their 14-day trial, or continue on Free.
 *
 * Why here and not as an auto-redirect to /app/billing: the old install flow
 * deep-linked to /app/billing?plan=… and auto-fired the subscription from a
 * useEffect. The resulting cross-origin top-frame redirect (to Shopify's
 * approval page on admin.shopify.com) ran from a fetch callback with NO user
 * gesture and was blocked by Chrome. Making plan selection a real button click
 * on the completion screen restores a genuine user gesture, and the redirect
 * goes through App Bridge (redirectTopLevel) which relays cross-origin safely.
 *
 * No backend changes: reuses GET /api/billing/usage (trial eligibility) and
 * POST /api/billing/subscribe (existing subscription + confirmationUrl flow).
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BlockStack, InlineStack, Text, Button, Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { redirectTopLevel } from "@/lib/shopify/redirectTopLevel";
import {
  readInstallPlan,
  clearInstallPlan,
  normalizeInstallPlan,
} from "@/lib/setup/installPlan";

const PAID_PLAN_IDS: PlanId[] = ["starter", "growth", "scale"];

const PLAN_PRICE_LABEL: Record<PlanId, string> = {
  free: "$0",
  starter: "$29",
  growth: "$129",
  scale: "$299",
};

const PLAN_SHORT_FEATURES_KEYS: Record<PlanId, string> = {
  free: "billing.freeShort",
  starter: "billing.starterShort",
  growth: "billing.growthShort",
  scale: "billing.scaleShort",
};

const PLAN_NAME_KEYS: Record<PlanId, string> = {
  free: "billing.free",
  starter: "billing.starter",
  growth: "billing.growth",
  scale: "billing.scale",
};

export function ChoosePlanCard({ onContinueFree }: { onContinueFree: () => void }) {
  const t = useTranslations();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<PlanId | null>(null);
  const [trialEligible, setTrialEligible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select the marketing-chosen plan. Priority: sessionStorage stash →
  // ?plan= query param → default to Starter (cheapest paid). Clear the stash
  // once consumed so a later visit doesn't re-pre-select stale state.
  useEffect(() => {
    const fromStash = readInstallPlan();
    const fromQuery = normalizeInstallPlan(searchParams.get("plan"));
    const initial = fromStash ?? fromQuery ?? "starter";
    setSelected(initial);
    clearInstallPlan();
  }, [searchParams]);

  // Trial eligibility drives the CTA copy (Start trial vs Subscribe).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { trialEligible?: boolean } | null) => {
        if (cancelled) return;
        if (data && typeof data.trialEligible === "boolean") {
          setTrialEligible(data.trialEligible);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (!selected || selected === "free") {
      onContinueFree();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sp = new URLSearchParams(window.location.search);
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: selected,
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
  }, [selected, onContinueFree, t]);

  if (loading || !selected) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
        <Spinner size="small" />
      </div>
    );
  }

  const ctaLabel =
    selected === "free"
      ? t("setup.complete.continueFree")
      : trialEligible
        ? t("setup.complete.startTrial")
        : t("billing.upgradeTo", { plan: t(PLAN_NAME_KEYS[selected]) });

  return (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant="headingMd">
          {t("setup.complete.choosePlanTitle")}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {trialEligible
            ? t("setup.complete.choosePlanSubtitleTrial")
            : t("setup.complete.choosePlanSubtitle")}
        </Text>
      </BlockStack>

      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {(["free", ...PAID_PLAN_IDS] as PlanId[]).map((planId, i, arr) => {
          const isSelected = selected === planId;
          const isPopular = planId === "growth";
          return (
            <button
              key={planId}
              type="button"
              onClick={() => setSelected(planId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: "14px 16px",
                background: isSelected ? "#F1F8FF" : "#fff",
                border: "none",
                borderBottom: i < arr.length - 1 ? "1px solid #F1F2F3" : undefined,
                borderLeft: isSelected ? "3px solid #2C6ECB" : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              {/* Radio */}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: isSelected ? "5px solid #2C6ECB" : "2px solid #8C9196",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
                aria-hidden
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {t(PLAN_NAME_KEYS[planId])}
                  </Text>
                  {isPopular && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#2C6ECB",
                        background: "#EBF5FA",
                        borderRadius: 10,
                        padding: "1px 8px",
                      }}
                    >
                      {t("billing.popular")}
                    </span>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t(PLAN_SHORT_FEATURES_KEYS[planId])}
                </Text>
              </div>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {PLAN_PRICE_LABEL[planId]}
                {planId !== "free" && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("billing.perMonthSuffix")}
                  </Text>
                )}
              </Text>
            </button>
          );
        })}
      </div>

      {selected !== "free" && trialEligible && (
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          {t("setup.complete.trialNote", {
            packs: PLANS[selected].packsPerMonth,
          })}
        </Text>
      )}

      {error && (
        <Text as="p" variant="bodySm" tone="critical">
          {error}
        </Text>
      )}

      {/* Single CTA only. We intentionally do NOT render a secondary
       *  "Continue on Free" escape link under a paid selection — offering a
       *  free out beneath the trial button undercuts the paid path. Merchants
       *  who want Free choose the Free row above, which flips this CTA to
       *  "Continue on Free". */}
      <BlockStack gap="200">
        <Button variant="primary" size="large" fullWidth loading={submitting} onClick={handleStart}>
          {ctaLabel}
        </Button>
      </BlockStack>
    </BlockStack>
  );
}
