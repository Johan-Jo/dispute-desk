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
import { useLocale, useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Spinner,
  Modal,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  TextField,
  Box,
  useBreakpoints,
} from "@shopify/polaris";

import { TOP_UPS } from "@/lib/billing/plans";

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

interface TopupInfo {
  packs: number;
  expiresAt: string | null;
  purchasedAt: string;
  reference: string | null;
}

const PLAN_FEATURE_KEYS: Record<string, string[]> = {
  free: ["billing.freeFeature1", "billing.freeFeature2", "billing.freeFeature3", "billing.freeFeature4"],
  starter: ["billing.realStarterFeature1", "billing.realStarterFeature2", "billing.realStarterFeature3", "billing.realStarterFeature4", "billing.realStarterFeature5"],
  growth: ["billing.growthFeature1", "billing.growthFeature2", "billing.growthFeature3", "billing.growthFeature4", "billing.growthFeature5"],
  scale: ["billing.scaleFeature1", "billing.scaleFeature2", "billing.scaleFeature3", "billing.scaleFeature4"],
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
  growth: { price: 129, label: "$129", monthly: "/mo" },
  scale: { price: 299, label: "$299", monthly: "/mo" },
};

const PLAN_SHORT_FEATURES: Record<string, string> = {
  free: "3 exported packs · Draft building · Activity log",
  starter: "20 packs/month · Basic rules · Email support",
  growth: "100 packs/month · Advanced rules · Auto-save",
  scale: "400 packs/month · Advanced exports · Priority support",
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

/** Short-date for top-up expiry rows. Uses the merchant's locale so
 *  "Jun 20, 2026" reads naturally in French/German/etc. */
function formatExpiry(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
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
  usageRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 4,
  } as React.CSSProperties,
  usageBarTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    background: "#F1F2F4",
    overflow: "hidden",
  } as React.CSSProperties,
  usageBarFill: {
    height: "100%",
    background: "#1D4ED8",
    borderRadius: 3,
    transition: "width 0.3s ease",
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
  topUpCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 16,
    borderRadius: 8,
    border: "1px solid #E1E3E5",
    background: "#FFFFFF",
  } as React.CSSProperties,
  extraCreditsBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    border: "1px solid #E1E3E5",
    background: "#F7F8FB",
  } as React.CSSProperties,
  extraCreditsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 4,
    paddingBottom: 4,
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

function BillingPageInner() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const planParam = parsePlanQuery(searchParams.get("plan"));
  // Polaris's `smDown` is true under ~490px (matches the mobile
  // breakpoint we use elsewhere — see coverage/page.tsx). Used to
  // collapse the 4-up plan grid into a single column and stack the
  // next-plan recommendation banner so neither overflows the
  // embedded iframe at 320–393 px viewports.
  const { smDown } = useBreakpoints();

  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [topups, setTopups] = useState<TopupInfo[]>([]);
  /** Set from /api/billing/usage. When false, the CTA labels say
   *  "Upgrade to <plan>" instead of "Start 14-Day Trial" and the
   *  trial-note paragraph drops the "14-day trial" sentence — the
   *  shop has already trialed once, plan changes happen instantly.
   *  Default false so a slow load doesn't briefly mislabel buttons. */
  const [trialEligible, setTrialEligible] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [showAllPlans, setShowAllPlans] = useState(true);
  const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  /** Which top-up SKU is currently being purchased — drives the
   *  per-button spinner so the merchant has feedback while the
   *  Shopify call is in flight. */
  const [topupInFlight, setTopupInFlight] = useState<string | null>(null);
  const [topupError, setTopupError] = useState<string | null>(null);
  /** Read once on mount: when the topup-callback redirects back
   *  with `?topup_success=…&packs=…`, the merchant sees an in-app
   *  confirmation instead of having to trust the email. Stripped
   *  from the URL after the banner mounts so a reload doesn't
   *  re-show it. */
  const topupSuccessPacks = (() => {
    const ok = searchParams.get("topup_success");
    const packs = searchParams.get("topup_packs");
    if (ok !== "1" || !packs) return null;
    const n = Number(packs);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const topupFailedReason = searchParams.get("topup_failed");

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/billing/usage");
    const data = await res.json();
    setPlan(data.plan);
    setUsage(data.usage);
    setTopups(Array.isArray(data.topups) ? (data.topups as TopupInfo[]) : []);
    setTrialEligible(Boolean(data.trialEligible));
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
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
        {/* Error banner — "Open in Shopify Admin" link aligned right
         *  to match the chrome banner's CTA placement. */}
        {upgradeError && (
          <Banner
            title={upgradeError}
            tone="critical"
            onDismiss={() => setUpgradeError(null)}
          >
            {showOpenInShopifyLink && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <a
                  href="https://admin.shopify.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600, textDecoration: "underline" }}
                >
                  {t("billing.openInShopifyAdmin")}
                </a>
              </div>
            )}
          </Banner>
        )}

        {/* Top-up success — surfaced after topup-callback redirect.
            Confirms the +N packs are live; complements the email. */}
        {topupSuccessPacks !== null && (
          <Banner
            title={t("billing.topupSuccessTitle", { count: topupSuccessPacks })}
            tone="success"
            onDismiss={() => {
              // Strip the query params so a reload doesn't re-show.
              router.replace(pathname, { scroll: false });
            }}
          >
            <p>{t("billing.topupSuccessBody")}</p>
          </Banner>
        )}

        {/* Top-up failure — fed from ?topup_failed=… on the redirect
            OR from a same-page error during the POST call. */}
        {(topupFailedReason || topupError) && (
          <Banner
            title={t("billing.topupFailedTitle")}
            tone="critical"
            onDismiss={() => {
              setTopupError(null);
              if (topupFailedReason) router.replace(pathname, { scroll: false });
            }}
          >
            <p>{topupError ?? decodeURIComponent(topupFailedReason ?? "")}</p>
          </Banner>
        )}

        {/* Main container card */}
        <Card padding="0">
          {/* Current plan section */}
          <Box padding="600" borderBlockEndWidth="025" borderColor="border">
            {/* Top row: [icon + plan name + subtitle]  [price]
             *  The header already had justify-content:space-between
             *  but nothing on the right, so the price ended up dumped
             *  below as its own block. Move the price into the right
             *  side of the same row, stack on mobile. */}
            <div
              style={{
                ...styles.currentPlanHeader,
                flexDirection: smDown ? "column" : "row",
                alignItems: smDown ? "flex-start" : "center",
                gap: smDown ? 12 : 16,
                marginBottom: 12,
              }}
            >
              <InlineStack gap="300" blockAlign="center">
                <div style={styles.planIconBox}>
                  <CheckCircleSvg />
                </div>
                <BlockStack gap="050">
                  <Text as="p" variant="headingMd" fontWeight="semibold">
                    {currentPlanName}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {plan?.packsPerMonth
                      ? t("billing.monthlyRevenue", { count: plan.packsPerMonth })
                      : t("billing.unlimitedRevenue")}
                  </Text>
                </BlockStack>
              </InlineStack>

              <p style={{ ...styles.priceText, margin: 0, lineHeight: 1 }}>
                {PLAN_PRICES[plan?.id ?? "free"].label}
                {PLAN_PRICES[plan?.id ?? "free"].monthly && (
                  <span style={styles.priceSuffix}>
                    {PLAN_PRICES[plan?.id ?? "free"].monthly}
                  </span>
                )}
              </p>
            </div>

            {/* Usage row — slim, lives beneath the header. Only shows
             *  on metered plans (packsLimit set). */}
            {usage && usage.packsLimit != null && (
              <div style={styles.usageRow}>
                <div style={styles.usageBarTrack}>
                  <div
                    style={{
                      ...styles.usageBarFill,
                      width: `${Math.min(
                        100,
                        Math.round((usage.packsUsed / usage.packsLimit) * 100),
                      )}%`,
                    }}
                  />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("billing.packsUsed", { used: usage.packsUsed, limit: usage.packsLimit })}
                </Text>
              </div>
            )}

            {/* Active top-ups — credits the merchant bought on top of the
             *  monthly allowance. Listed individually so they can see what
             *  they purchased and the expiry date. Top-up packs expire 30
             *  days from purchase (TOPUP_EXPIRY_DAYS), independent of the
             *  billing cycle. The ledger does not track per-bundle
             *  consumption, so we show the granted amount, not "remaining
             *  in this bundle" — copy reflects that. */}
            {topups.length > 0 && (
              <div style={styles.extraCreditsBox}>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("billing.extraCreditsTitle", {
                    total: topups.reduce((sum, tu) => sum + tu.packs, 0),
                  })}
                </Text>
                <div style={{ marginTop: 8 }}>
                  {topups.map((tu, i) => {
                    const expiry = formatExpiry(tu.expiresAt, locale);
                    return (
                      <div key={`${tu.purchasedAt}-${i}`} style={styles.extraCreditsRow}>
                        <Text as="span" variant="bodySm">
                          {t("billing.extraCreditsBundle", { packs: tu.packs })}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {expiry
                            ? t("billing.extraCreditsExpires", { date: expiry })
                            : t("billing.extraCreditsNoExpiry")}
                        </Text>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next plan recommendation banner */}
            {nextPlanId && nextPlanPrice && (
              <div
                style={{
                  ...styles.nextPlanBanner,
                  flexDirection: smDown ? "column" : "row",
                  alignItems: smDown ? "stretch" : "center",
                  gap: smDown ? 12 : 16,
                }}
              >
                <div>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("billing.nextPlan", { plan: nextPlanName ?? "" })}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {PLAN_SHORT_FEATURES[nextPlanId]}
                  </Text>
                </div>
                <div
                  style={{
                    ...styles.nextPlanRight,
                    justifyContent: smDown ? "space-between" : undefined,
                    width: smDown ? "100%" : undefined,
                  }}
                >
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
            <Box padding={smDown ? "400" : "600"}>
              <div
                style={{
                  ...styles.planCardsGrid,
                  gridTemplateColumns: smDown ? "1fr" : "repeat(4, 1fr)",
                  gap: smDown ? 16 : 24,
                }}
              >
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
                              : trialEligible
                                ? t("billing.startTrial", { plan: t(planNameKeys[planId]) })
                                : t("billing.upgradeTo", { plan: t(planNameKeys[planId]) })}
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

              {/* Trial note — branches on eligibility so a returning
                  merchant doesn't see "14-day trial" copy that no
                  longer applies to them. The downgrade-instant clause
                  is shared between variants. */}
              <p style={styles.trialNote}>
                {trialEligible
                  ? t("billing.trialNote")
                  : t("billing.trialNoteNoTrial")}
              </p>
            </Box>
          )}
        </Card>

        {/* Top-ups section — two distinct cards, packs label + price
         *  stacked, with a clear "Buy" CTA on each. Replaces the
         *  earlier one-line button that crammed pack count and price
         *  into a single label. */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("billing.topUps")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("billing.topUpsDesc")}
              </Text>
            </BlockStack>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: smDown ? "1fr" : `repeat(${TOP_UPS.length}, 1fr)`,
                gap: 12,
              }}
            >
              {TOP_UPS.map((topUp) => {
                const inFlight = topupInFlight === topUp.sku;
                const disabled = topupInFlight !== null;
                const onBuy = async () => {
                  setTopupError(null);
                  setTopupInFlight(topUp.sku);
                  try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const res = await fetch("/api/billing/topup", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sku: topUp.sku,
                        host: urlParams.get("host") ?? undefined,
                        shop: urlParams.get("shop") ?? undefined,
                      }),
                    });
                    const data = (await res.json()) as {
                      confirmationUrl?: string;
                      error?: string;
                    };
                    if (data.confirmationUrl) {
                      window.top!.location.href = data.confirmationUrl;
                      return;
                    }
                    const message =
                      typeof data.error === "string" && data.error.length > 0
                        ? data.error
                        : t("billing.topupFailedGeneric");
                    setTopupError(message);
                  } catch {
                    setTopupError(t("billing.topupFailedGeneric"));
                  } finally {
                    setTopupInFlight((cur) => (cur === topUp.sku ? null : cur));
                  }
                };
                return (
                  <div key={topUp.sku} style={styles.topUpCard}>
                    <div>
                      <Text as="p" variant="headingMd" fontWeight="semibold">
                        {topUp.label}
                      </Text>
                      <Text as="p" variant="bodyLg" tone="subdued">
                        {`$${topUp.priceUsd}`}
                      </Text>
                    </div>
                    <Button
                      variant="primary"
                      onClick={onBuy}
                      disabled={disabled}
                      loading={inFlight}
                    >
                      {inFlight
                        ? t("billing.topupProcessing")
                        : t("billing.topUpBuyCta")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </BlockStack>
        </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

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
              content: t("common.cancel"),
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
