/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/billing/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-plan-management.tsx
 * Reference: plan cards, 14-day free trial copy, upgrade CTAs. Reuse existing /api/billing/* (no backend changes).
 *
 * Marketing links may open `/app/billing?plan=free|starter|growth|scale` — after load, scrolls to free
 * or starts Shopify subscription approval for an upgrade (embedded session required).
 */
"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Page, Spinner, Modal, Text } from "@shopify/polaris";
import {
  CheckCircle,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Check,
  X,
} from "lucide-react";

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  packsPerMonth: number | null;
  autoPack: boolean;
  rules: boolean;
}

interface UsageInfo {
  packsUsed: number;
  packsLimit: number | null;
  packsRemaining: number | null;
}

const PLAN_FEATURE_KEYS: Record<string, string[]> = {
  free: ["billing.freeFeature1", "billing.freeFeature2", "billing.freeFeature3", "billing.freeFeature4"],
  starter: ["billing.realStarterFeature1", "billing.realStarterFeature2", "billing.realStarterFeature3", "billing.realStarterFeature4", "billing.realStarterFeature5"],
  growth: ["billing.growthFeature1", "billing.growthFeature2", "billing.growthFeature3", "billing.growthFeature4", "billing.growthFeature5"],
  scale: ["billing.scaleFeature1", "billing.scaleFeature2", "billing.scaleFeature3", "billing.scaleFeature4", "billing.scaleFeature5"],
};

const PLAN_IDS = ["free", "starter", "growth", "scale"] as const;

const PLAN_TIER: Record<string, number> = {
  free: 0,
  starter: 1,
  growth: 2,
  scale: 3,
};

const PLAN_PRICES: Record<string, { price: number; label: string; monthly: string }> = {
  free: { price: 0, label: "$0", monthly: "" },
  starter: { price: 29, label: "$29", monthly: "/mo" },
  growth: { price: 79, label: "$79", monthly: "/mo" },
  scale: { price: 149, label: "$149", monthly: "/mo" },
};

const PLAN_SHORT_FEATURES: Record<string, string> = {
  free: "3 exported packs · Draft building · Activity log",
  starter: "15 packs/month · Basic rules · Email support",
  growth: "75 packs/month · Advanced rules · Auto-save",
  scale: "300 packs/month · Multi-store · Priority support",
};

type PlanQuery = (typeof PLAN_IDS)[number];

function parsePlanQuery(value: string | null): PlanQuery | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  return (PLAN_IDS as readonly string[]).includes(v) ? (v as PlanQuery) : null;
}

function sessionPlanKey(plan: string): string {
  return `dd_billing_plan_query_${plan}`;
}

function getNextPlan(currentId: string): string | null {
  const tier = PLAN_TIER[currentId] ?? 0;
  if (tier >= 3) return null;
  return PLAN_IDS[tier + 1];
}

function BillingPageInner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const planParam = parsePlanQuery(searchParams.get("plan"));

  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [showAllPlans, setShowAllPlans] = useState(true);
  const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountCode, setDiscountCode] = useState("");

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/billing/usage");
    const data = await res.json();
    setPlan(data.plan);
    setUsage(data.usage);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  const handleUpgrade = useCallback(
    async (planId: string) => {
      setUpgradeError(null);
      setUpgrading(planId);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const res = await fetch("/api/billing/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: planId,
            host: urlParams.get("host") ?? undefined,
            shop: urlParams.get("shop") ?? undefined,
          }),
        });
        const data = await res.json();
        if (data.confirmationUrl) {
          window.top!.location.href = data.confirmationUrl;
          return;
        }
        const message = typeof data.error === "string" ? data.error : t("billing.upgradeFailed");
        setUpgradeError(message);
      } catch {
        setUpgradeError(t("billing.upgradeFailed"));
      } finally {
        setUpgrading(null);
      }
    },
    [t]
  );

  /** Deep link from marketing: `/app/billing?plan=…` */
  useEffect(() => {
    if (loading || !plan || !planParam) return;

    const sk = sessionPlanKey(planParam);
    if (typeof window !== "undefined" && sessionStorage.getItem(sk)) {
      if (searchParams.get("plan")) router.replace(pathname, { scroll: false });
      return;
    }
    if (typeof window !== "undefined") sessionStorage.setItem(sk, "1");

    const stripPlanQuery = () => {
      router.replace(pathname, { scroll: false });
    };

    if (planParam === "free") {
      setShowAllPlans(true);
      requestAnimationFrame(() => {
        document.getElementById("billing-plan-free")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      stripPlanQuery();
      return;
    }

    const currentTier = PLAN_TIER[plan.id] ?? 0;
    const targetTier = PLAN_TIER[planParam] ?? 0;
    if (currentTier >= targetTier) {
      stripPlanQuery();
      return;
    }

    void handleUpgrade(planParam).finally(() => {
      stripPlanQuery();
    });
  }, [loading, plan, planParam, handleUpgrade, pathname, router, searchParams]);

  if (loading) {
    return (
      <Page title={t("billing.title")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const planNameKeys: Record<string, string> = {
    free: "billing.free",
    starter: "billing.starter",
    growth: "billing.growth",
    scale: "billing.scale",
  };

  const currentPlanName = plan ? t(planNameKeys[plan.id] ?? "billing.free") : t("billing.free");
  const nextPlanId = plan ? getNextPlan(plan.id) : "starter";
  const nextPlanPrice = nextPlanId ? PLAN_PRICES[nextPlanId] : null;
  const nextPlanName = nextPlanId ? t(planNameKeys[nextPlanId]) : null;

  const showOpenInShopifyLink =
    upgradeError &&
    (upgradeError.includes("missing shop domain") || upgradeError.includes("Shopify Admin"));

  return (
    <div style={{ padding: "16px" }}>
      {/* Error banner */}
      {upgradeError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {upgradeError}
          {showOpenInShopifyLink && (
            <>
              {" "}
              <a
                href="https://admin.shopify.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                {t("billing.openInShopifyAdmin")}
              </a>
            </>
          )}
          <button
            onClick={() => setUpgradeError(null)}
            className="float-right text-red-600 hover:text-red-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main container card */}
      <div className="rounded-lg border border-[#E1E3E5] bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E1E3E5] px-6 py-4">
          <h1 className="text-xl font-semibold text-[#202223]">
            {t("billing.planManagement")}
          </h1>
          <button
            onClick={() => setShowDiscountModal(true)}
            className="rounded-lg border border-[#C9CCCF] px-4 py-2 text-sm font-medium text-[#202223] hover:bg-[#F7F8FA]"
          >
            {t("billing.applyDiscount")}
          </button>
        </div>

        {/* Current plan section */}
        <div className="border-b border-[#E1E3E5] px-6 py-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E0F2FE]">
                <CheckCircle className="h-5 w-5 text-[#1D4ED8]" />
              </div>
              <div>
                <p className="text-base font-semibold text-[#202223]">
                  {currentPlanName}
                </p>
                <p className="text-sm text-[#6D7175]">
                  {plan?.packsPerMonth
                    ? t("billing.monthlyRevenue", { count: plan.packsPerMonth })
                    : t("billing.unlimitedRevenue")}
                </p>
              </div>
            </div>
            <button className="rounded p-1 text-[#6D7175] hover:bg-[#F7F8FA]">
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>

          <p className="mb-1 text-2xl font-semibold text-[#202223]">
            {PLAN_PRICES[plan?.id ?? "free"].label}
            {PLAN_PRICES[plan?.id ?? "free"].monthly && (
              <span className="text-base font-normal text-[#6D7175]">
                {PLAN_PRICES[plan?.id ?? "free"].monthly}
              </span>
            )}
          </p>
          {usage && usage.packsLimit != null && (
            <p className="text-sm text-[#6D7175]">
              {t("billing.packsUsed", { used: usage.packsUsed, limit: usage.packsLimit })}
            </p>
          )}

          {/* Next plan recommendation banner */}
          {nextPlanId && nextPlanPrice && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-[#E1E3E5] bg-[#F7F8FB] p-4">
              <div>
                <p className="mb-1 text-sm font-semibold text-[#202223]">
                  {t("billing.nextPlan", { plan: nextPlanName ?? "" })}
                </p>
                <p className="text-sm text-[#6D7175]">
                  {PLAN_SHORT_FEATURES[nextPlanId]}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-[#202223]">
                  {nextPlanPrice.label}{nextPlanPrice.monthly}
                </span>
                <button
                  onClick={() => handleUpgrade(nextPlanId)}
                  disabled={upgrading === nextPlanId}
                  className="rounded-lg bg-[#202223] px-4 py-2 text-sm font-medium text-white hover:bg-[#000000] disabled:opacity-50"
                >
                  {upgrading === nextPlanId ? t("billing.redirecting") : t("billing.upgradeNow")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Show/hide all plans toggle */}
        <div className="border-b border-[#E1E3E5] px-6 py-3">
          <button
            onClick={() => setShowAllPlans(!showAllPlans)}
            className="flex w-full items-center justify-center gap-1 text-sm font-medium text-[#1D4ED8] hover:text-[#1e40af]"
          >
            {showAllPlans ? t("billing.hideAllPlans") : t("billing.showAllPlans")}
            {showAllPlans ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Plan cards grid */}
        {showAllPlans && (
          <div className="px-6 py-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {PLAN_IDS.map((planId) => {
                const priceInfo = PLAN_PRICES[planId];
                const featureKeys = PLAN_FEATURE_KEYS[planId];
                const isPopular = planId === "growth";
                const isCurrent = plan?.id === planId;
                const currentTier = PLAN_TIER[plan?.id ?? "free"];
                const cardTier = PLAN_TIER[planId];
                const isUpgrade = cardTier > currentTier;
                const isDowngrade = cardTier < currentTier && planId !== "free";

                return (
                  <div
                    key={planId}
                    id={planId === "free" ? "billing-plan-free" : undefined}
                    className={`relative rounded-lg p-6 ${
                      isPopular
                        ? "border border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-lg"
                        : "border border-[#E1E3E5] bg-white hover:border-[#C9CCCF]"
                    }`}
                  >
                    {/* Popular badge */}
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#1D4ED8] bg-white px-3 py-1 text-xs font-semibold text-[#1D4ED8]">
                        {t("billing.popular")}
                      </span>
                    )}

                    {/* Plan name */}
                    <h3
                      className={`mb-2 text-lg font-semibold ${
                        isPopular ? "text-white" : "text-[#202223]"
                      }`}
                    >
                      {t(planNameKeys[planId])}
                    </h3>

                    {/* Price */}
                    <p className="mb-1">
                      <span
                        className={`text-3xl font-bold ${
                          isPopular ? "text-white" : "text-[#202223]"
                        }`}
                      >
                        {priceInfo.label}
                      </span>
                      {priceInfo.monthly && (
                        <span
                          className={`text-base font-normal ${
                            isPopular ? "text-white/80" : "text-[#6D7175]"
                          }`}
                        >
                          {priceInfo.monthly}
                        </span>
                      )}
                    </p>

                    {/* Features */}
                    <div className="mb-6 min-h-[180px] space-y-3 pt-4">
                      {featureKeys.map((key) => (
                        <div key={key} className="flex items-start gap-2">
                          <Check
                            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                              isPopular ? "text-white" : "text-[#22C55E]"
                            }`}
                          />
                          <span
                            className={`text-sm ${
                              isPopular ? "text-white/90" : "text-[#6D7175]"
                            }`}
                          >
                            {t(key)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* CTA button */}
                    {isCurrent ? (
                      <button
                        disabled
                        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${
                          isPopular
                            ? "bg-white/20 text-white"
                            : "border border-[#C9CCCF] bg-[#F7F8FA] text-[#6D7175]"
                        }`}
                      >
                        {t("billing.yourCurrentPlan")}
                      </button>
                    ) : isUpgrade ? (
                      <button
                        onClick={() => handleUpgrade(planId)}
                        disabled={upgrading === planId}
                        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                          isPopular
                            ? "bg-white text-[#1D4ED8] hover:bg-gray-50"
                            : planId === "free"
                              ? "border border-[#C9CCCF] text-[#202223] hover:bg-[#F7F8FA]"
                              : "border border-[#E1E3E5] bg-[#F7F8FA] text-[#202223] hover:bg-[#E3E5E7]"
                        }`}
                      >
                        {upgrading === planId
                          ? t("billing.redirecting")
                          : planId === "free"
                            ? t("billing.getStarted")
                            : t("billing.startTrial", { plan: t(planNameKeys[planId]) })}
                      </button>
                    ) : isDowngrade ? (
                      <button
                        onClick={() => setDowngradeTarget(planId)}
                        disabled={upgrading === planId}
                        className={`w-full rounded-lg border border-[#E1E3E5] bg-[#F7F8FA] px-4 py-2.5 text-sm font-semibold text-[#202223] hover:bg-[#E3E5E7] disabled:opacity-50`}
                      >
                        {upgrading === planId
                          ? t("billing.redirecting")
                          : t("billing.downgradeTo", { plan: t(planNameKeys[planId]) })}
                      </button>
                    ) : (
                      <button
                        disabled
                        className="w-full rounded-lg border border-[#C9CCCF] px-4 py-2.5 text-sm font-semibold text-[#202223] hover:bg-[#F7F8FA]"
                      >
                        {t("billing.getStarted")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Trial note */}
            <p className="mt-6 text-center text-sm text-[#6D7175]">
              {t("billing.trialNote")}
            </p>
          </div>
        )}
      </div>

      {/* Top-ups section */}
      <div className="mt-4 rounded-lg border border-[#E1E3E5] bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-[#202223]">
          {t("billing.topUps")}
        </h2>
        <p className="mb-4 text-sm text-[#6D7175]">{t("billing.topUpsDesc")}</p>
        <div className="flex gap-3">
          {[
            { sku: "topup_25", labelKey: "billing.topUp25", price: "$19" },
            { sku: "topup_100", labelKey: "billing.topUp100", price: "$59" },
          ].map((topUp) => (
            <button
              key={topUp.sku}
              onClick={async () => {
                const res = await fetch("/api/billing/topup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sku: topUp.sku }),
                });
                const data = await res.json();
                if (data.confirmationUrl) window.top!.location.href = data.confirmationUrl;
              }}
              className="rounded-lg border border-[#C9CCCF] px-4 py-2 text-sm font-medium text-[#202223] hover:bg-[#F7F8FA]"
            >
              {t(topUp.labelKey)} — {topUp.price}
            </button>
          ))}
        </div>
      </div>

      {/* Discount modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#202223]">
                {t("billing.applyDiscount")}
              </h2>
              <button
                onClick={() => setShowDiscountModal(false)}
                className="text-[#6D7175] hover:text-[#202223]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mb-1 block text-sm font-medium text-[#6D7175]">
              {t("billing.discountCode")}
            </label>
            <input
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[#C9CCCF] px-3 py-2 shadow-sm focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8] sm:text-sm"
              placeholder={t("billing.discountCodePlaceholder")}
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  // TODO: implement discount code application via API
                  setShowDiscountModal(false);
                }}
                className="rounded-lg border border-[#C9CCCF] px-4 py-2 text-sm font-medium text-[#202223] hover:bg-[#F7F8FA]"
              >
                {t("billing.applyDiscount")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Downgrade modal - keep Polaris for consistency with Shopify */}
      {downgradeTarget && (
        <Modal
          open
          onClose={() => setDowngradeTarget(null)}
          title={t("billing.downgradeConfirmTitle", { plan: t(planNameKeys[downgradeTarget] ?? "billing.free") })}
          primaryAction={{
            content: t("billing.downgradeConfirm"),
            destructive: true,
            loading: upgrading === downgradeTarget,
            onAction: async () => {
              const target = downgradeTarget;
              setDowngradeTarget(null);
              await handleUpgrade(target);
            },
          }}
          secondaryActions={[
            {
              content: t("billing.downgradeCancel"),
              onAction: () => setDowngradeTarget(null),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p" variant="bodyMd">
              {t("billing.downgradeConfirmBody", { plan: t(planNameKeys[downgradeTarget] ?? "billing.free") })}
            </Text>
          </Modal.Section>
        </Modal>
      )}
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <Page title={t("billing.title")}>
          <div style={{ padding: "3rem", textAlign: "center" }}>
            <Spinner size="large" />
          </div>
        </Page>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}
