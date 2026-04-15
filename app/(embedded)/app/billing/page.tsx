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
import {
  Page,
  Spinner,
  Modal,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Banner,
  Badge,
  Button,
  TextField,
  InlineGrid,
  Divider,
  Box,
} from "@shopify/polaris";

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

const styles = {
  currentPlanHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  } as React.CSSProperties,
  planIconBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 8,
    background: "#E0F2FE",
  } as React.CSSProperties,
  planIconSvg: {
    width: 20,
    height: 20,
    color: "#1D4ED8",
  } as React.CSSProperties,
  priceText: {
    fontSize: 28,
    fontWeight: 600,
    color: "#202223",
    margin: 0,
  } as React.CSSProperties,
  priceSuffix: {
    fontSize: 16,
    fontWeight: 400,
    color: "#6D7175",
  } as React.CSSProperties,
  nextPlanBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    border: "1px solid #E1E3E5",
    background: "#F7F8FB",
  } as React.CSSProperties,
  nextPlanRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  toggleButton: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "12px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#1D4ED8",
  } as React.CSSProperties,
  planCardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 24,
  } as React.CSSProperties,
  planCard: (isPopular: boolean): React.CSSProperties => ({
    position: "relative",
    borderRadius: 8,
    padding: 24,
    border: isPopular ? "1px solid #1D4ED8" : "1px solid #E1E3E5",
    background: isPopular ? "#1D4ED8" : "#FFFFFF",
    color: isPopular ? "#FFFFFF" : "#202223",
    boxShadow: isPopular ? "0 4px 12px rgba(29, 78, 216, 0.25)" : "none",
  }),
  popularBadge: {
    position: "absolute",
    top: -12,
    left: "50%",
    transform: "translateX(-50%)",
    borderRadius: 99,
    border: "1px solid #1D4ED8",
    background: "#FFFFFF",
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "#1D4ED8",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  planCardPrice: (isPopular: boolean): React.CSSProperties => ({
    fontSize: 30,
    fontWeight: 700,
    color: isPopular ? "#FFFFFF" : "#202223",
    margin: "4px 0",
  }),
  planCardPriceSuffix: (isPopular: boolean): React.CSSProperties => ({
    fontSize: 16,
    fontWeight: 400,
    color: isPopular ? "rgba(255,255,255,0.8)" : "#6D7175",
  }),
  featureList: {
    minHeight: 180,
    paddingTop: 16,
    marginBottom: 24,
  } as React.CSSProperties,
  featureRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 12,
  } as React.CSSProperties,
  checkIcon: (isPopular: boolean): React.CSSProperties => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    marginTop: 2,
    color: isPopular ? "#FFFFFF" : "#22C55E",
  }),
  featureText: (isPopular: boolean): React.CSSProperties => ({
    fontSize: 14,
    color: isPopular ? "rgba(255,255,255,0.9)" : "#6D7175",
  }),
  ctaButton: (variant: "current" | "upgrade" | "downgrade" | "disabled", isPopular: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      width: "100%",
      borderRadius: 8,
      padding: "10px 16px",
      fontSize: 14,
      fontWeight: 600,
      cursor: variant === "current" || variant === "disabled" ? "default" : "pointer",
      border: "1px solid #C9CCCF",
      opacity: 1,
    };
    if (variant === "current") {
      return {
        ...base,
        background: isPopular ? "rgba(255,255,255,0.2)" : "#F7F8FA",
        color: isPopular ? "#FFFFFF" : "#6D7175",
        cursor: "default",
      };
    }
    if (variant === "upgrade" && isPopular) {
      return { ...base, background: "#FFFFFF", color: "#1D4ED8", border: "1px solid #FFFFFF" };
    }
    return { ...base, background: "#F7F8FA", color: "#202223" };
  },
  trialNote: {
    textAlign: "center",
    marginTop: 24,
    fontSize: 14,
    color: "#6D7175",
  } as React.CSSProperties,
  topUpButton: {
    borderRadius: 8,
    border: "1px solid #C9CCCF",
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 500,
    color: "#202223",
    background: "#FFFFFF",
    cursor: "pointer",
  } as React.CSSProperties,
  discountOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.5)",
  } as React.CSSProperties,
  discountPanel: {
    width: "100%",
    maxWidth: 448,
    borderRadius: 8,
    background: "#FFFFFF",
    padding: 24,
    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
  } as React.CSSProperties,
} as const;

function CheckSvg({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M13.3 4.3a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L6.6 9.6l5.3-5.3a1 1 0 0 1 1.4 0Z" fill={color} />
    </svg>
  );
}

function ChevronSvg({ up }: { up: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }}>
      {up ? (
        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 0 1-1.414 0L10 9.414l-3.293 3.293a1 1 0 0 1-1.414-1.414l4-4a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1 0 1.414Z" clipRule="evenodd" />
      ) : (
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 0 1 1.414 0L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 0-1.414Z" clipRule="evenodd" />
      )}
    </svg>
  );
}

function CheckCircleSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={styles.planIconSvg}>
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" stroke="#1D4ED8" strokeWidth="1.5" />
      <path d="m7 10 2 2 4-4" stroke="#1D4ED8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z" clipRule="evenodd" />
    </svg>
  );
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
    <Page
      title={t("billing.planManagement")}
      backAction={{ content: t("nav.overview"), url: "/app" }}
      secondaryActions={[
        {
          content: t("billing.applyDiscount"),
          onAction: () => setShowDiscountModal(true),
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Error banner */}
        {upgradeError && (
          <Banner
            title={upgradeError}
            tone="critical"
            onDismiss={() => setUpgradeError(null)}
          >
            {showOpenInShopifyLink && (
              <p>
                <a
                  href="https://admin.shopify.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600, textDecoration: "underline" }}
                >
                  {t("billing.openInShopifyAdmin")}
                </a>
              </p>
            )}
          </Banner>
        )}

        {/* Main container card */}
        <Card padding="0">
          {/* Current plan section */}
          <Box padding="600" borderBlockEndWidth="025" borderColor="border">
            <div style={styles.currentPlanHeader}>
              <InlineStack gap="300" blockAlign="start">
                <div style={styles.planIconBox}>
                  <CheckCircleSvg />
                </div>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {currentPlanName}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {plan?.packsPerMonth
                      ? t("billing.monthlyRevenue", { count: plan.packsPerMonth })
                      : t("billing.unlimitedRevenue")}
                  </Text>
                </BlockStack>
              </InlineStack>
            </div>

            <p style={styles.priceText}>
              {PLAN_PRICES[plan?.id ?? "free"].label}
              {PLAN_PRICES[plan?.id ?? "free"].monthly && (
                <span style={styles.priceSuffix}>
                  {PLAN_PRICES[plan?.id ?? "free"].monthly}
                </span>
              )}
            </p>
            {usage && usage.packsLimit != null && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("billing.packsUsed", { used: usage.packsUsed, limit: usage.packsLimit })}
              </Text>
            )}

            {/* Next plan recommendation banner */}
            {nextPlanId && nextPlanPrice && (
              <div style={styles.nextPlanBanner}>
                <div>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("billing.nextPlan", { plan: nextPlanName ?? "" })}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {PLAN_SHORT_FEATURES[nextPlanId]}
                  </Text>
                </div>
                <div style={styles.nextPlanRight}>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {nextPlanPrice.label}{nextPlanPrice.monthly}
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => handleUpgrade(nextPlanId)}
                    disabled={upgrading === nextPlanId}
                    loading={upgrading === nextPlanId}
                  >
                    {t("billing.upgradeNow")}
                  </Button>
                </div>
              </div>
            )}
          </Box>

          {/* Show/hide all plans toggle */}
          <Box padding="0" borderBlockEndWidth="025" borderColor="border">
            <button
              onClick={() => setShowAllPlans(!showAllPlans)}
              style={styles.toggleButton}
            >
              {showAllPlans ? t("billing.hideAllPlans") : t("billing.showAllPlans")}
              <ChevronSvg up={showAllPlans} />
            </button>
          </Box>

          {/* Plan cards grid */}
          {showAllPlans && (
            <Box padding="600">
              <div style={styles.planCardsGrid}>
                {PLAN_IDS.map((planId) => {
                  const priceInfo = PLAN_PRICES[planId];
                  const featureKeys = PLAN_FEATURE_KEYS[planId];
                  const isPopular = planId === "growth";
                  const isCurrent = plan?.id === planId;
                  const currentTier = PLAN_TIER[plan?.id ?? "free"];
                  const cardTier = PLAN_TIER[planId];
                  const isUpgrade = cardTier > currentTier;
                  const isDowngrade = cardTier < currentTier && planId !== "free";

                  let ctaVariant: "current" | "upgrade" | "downgrade" | "disabled";
                  if (isCurrent) ctaVariant = "current";
                  else if (isUpgrade) ctaVariant = "upgrade";
                  else if (isDowngrade) ctaVariant = "downgrade";
                  else ctaVariant = "disabled";

                  return (
                    <div
                      key={planId}
                      id={planId === "free" ? "billing-plan-free" : undefined}
                      style={styles.planCard(isPopular)}
                    >
                      {/* Popular badge */}
                      {isPopular && (
                        <span style={styles.popularBadge}>
                          {t("billing.popular")}
                        </span>
                      )}

                      {/* Plan name */}
                      <Text as="h3" variant="headingMd">
                        <span style={{ color: isPopular ? "#FFFFFF" : undefined }}>
                          {t(planNameKeys[planId])}
                        </span>
                      </Text>

                      {/* Price */}
                      <p style={styles.planCardPrice(isPopular)}>
                        {priceInfo.label}
                        {priceInfo.monthly && (
                          <span style={styles.planCardPriceSuffix(isPopular)}>
                            {priceInfo.monthly}
                          </span>
                        )}
                      </p>

                      {/* Features */}
                      <div style={styles.featureList}>
                        {featureKeys.map((key) => (
                          <div key={key} style={styles.featureRow}>
                            <CheckSvg color={isPopular ? "#FFFFFF" : "#22C55E"} />
                            <span style={styles.featureText(isPopular)}>
                              {t(key)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* CTA button */}
                      {isCurrent ? (
                        <button disabled style={styles.ctaButton("current", isPopular)}>
                          {t("billing.yourCurrentPlan")}
                        </button>
                      ) : isUpgrade ? (
                        <button
                          onClick={() => handleUpgrade(planId)}
                          disabled={upgrading === planId}
                          style={{
                            ...styles.ctaButton("upgrade", isPopular),
                            opacity: upgrading === planId ? 0.5 : 1,
                          }}
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
                          style={{
                            ...styles.ctaButton("downgrade", isPopular),
                            opacity: upgrading === planId ? 0.5 : 1,
                          }}
                        >
                          {upgrading === planId
                            ? t("billing.redirecting")
                            : t("billing.downgradeTo", { plan: t(planNameKeys[planId]) })}
                        </button>
                      ) : (
                        <button disabled style={styles.ctaButton("disabled", isPopular)}>
                          {t("billing.getStarted")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Trial note */}
              <p style={styles.trialNote}>
                {t("billing.trialNote")}
              </p>
            </Box>
          )}
        </Card>

        {/* Top-ups section */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("billing.topUps")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("billing.topUpsDesc")}
            </Text>
            <InlineStack gap="300">
              {[
                { sku: "topup_25", labelKey: "billing.topUp25" },
                { sku: "topup_100", labelKey: "billing.topUp100" },
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
                  style={styles.topUpButton}
                >
                  {t(topUp.labelKey)}
                </button>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Discount modal */}
      {showDiscountModal && (
        <Modal
          open
          onClose={() => setShowDiscountModal(false)}
          title={t("billing.applyDiscount")}
          primaryAction={{
            content: t("billing.applyDiscount"),
            onAction: () => {
              // TODO: implement discount code application via API
              setShowDiscountModal(false);
            },
          }}
          secondaryActions={[
            {
              content: t("billing.cancel") ?? "Cancel",
              onAction: () => setShowDiscountModal(false),
            },
          ]}
        >
          <Modal.Section>
            <TextField
              label={t("billing.discountCode")}
              autoComplete="off"
              value={discountCode}
              onChange={setDiscountCode}
              placeholder={t("billing.discountCodePlaceholder")}
            />
          </Modal.Section>
        </Modal>
      )}

      {/* Downgrade modal */}
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
    </Page>
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
