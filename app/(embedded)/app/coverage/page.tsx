/**
 * Coverage page — merchant-facing view of dispute family coverage.
 *
 * Reads from /api/rules and /api/packs?status=ACTIVE to derive coverage
 * state per dispute family using the deriveCoverage utility.
 */
"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  Spinner,
  Divider,
  Icon,
} from "@shopify/polaris";
import {
  ShieldPersonIcon,
  AlertTriangleIcon,
  DeliveryIcon,
  OrderIcon,
  ReceiptRefundIcon,
  CashDollarIcon,
  DuplicateIcon,
  QuestionCircleIcon,
  ClipboardCheckFilledIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import {
  deriveCoverage,
  DISPUTE_FAMILIES,
  type CoverageSummary,
  type FamilyCoverage,
  type AutomationMode,
} from "@/lib/coverage/deriveCoverage";

const FAMILY_ICONS: Record<string, typeof ShieldPersonIcon> = {
  fraud: ShieldPersonIcon,
  unrecognized: QuestionCircleIcon,
  pnr: DeliveryIcon,
  not_as_described: AlertTriangleIcon,
  subscription: OrderIcon,
  refund: ReceiptRefundIcon,
  duplicate: DuplicateIcon,
  general: ClipboardCheckFilledIcon,
};

function automationBadgeTone(mode: AutomationMode): "success" | "info" | "warning" | "attention" | undefined {
  switch (mode) {
    case "automated": return "success";
    case "review_first": return "info";
    case "manual": return "warning";
    case "none": return undefined;
  }
}

export default function CoveragePage() {
  const t = useTranslations();
  const tc = useTranslations("coverage");
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs?status=ACTIVE").then((r) => (r.ok ? r.json() : { packs: [] })),
    ])
      .then(([rulesData, packsData]) => {
        if (cancelled) return;
        const rules = Array.isArray(rulesData) ? rulesData : [];
        const packs = packsData?.packs ?? [];
        setCoverage(deriveCoverage(rules, packs));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Page title={tc("title")} subtitle={tc("subtitle")}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const c = coverage!;

  return (
    <Page
      title={tc("title")}
      subtitle={tc("subtitle")}
      primaryAction={{
        content: t("nav.automation"),
        url: withShopParams("/app/rules", searchParams),
      }}
      secondaryActions={[
        { content: t("nav.playbooks"), url: withShopParams("/app/packs", searchParams) },
      ]}
    >
      <Layout>
        {/* Summary Banner */}
        <Layout.Section>
          <Banner tone={c.coveredCount === c.totalFamilies ? "success" : "warning"}>
            <InlineStack gap="200" wrap>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {tc("summaryBanner", { covered: c.coveredCount, total: c.totalFamilies })}
              </Text>
              {c.automatedCount > 0 && (
                <Badge tone="success">{tc("automatedCount", { count: c.automatedCount })}</Badge>
              )}
              {c.reviewFirstCount > 0 && (
                <Badge tone="info">{tc("reviewFirstCount", { count: c.reviewFirstCount })}</Badge>
              )}
            </InlineStack>
          </Banner>
        </Layout.Section>

        {/* Family Cards */}
        {c.families.map((family) => (
          <Layout.Section key={family.familyId}>
            <FamilyCard
              family={family}
              tc={tc}
              searchParams={searchParams}
            />
          </Layout.Section>
        ))}
      </Layout>
    </Page>
  );
}

function FamilyCard({
  family,
  tc,
  searchParams,
}: {
  family: FamilyCoverage;
  tc: ReturnType<typeof useTranslations>;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const FamilyIcon = FAMILY_ICONS[family.familyId] ?? ClipboardCheckFilledIcon;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="300" blockAlign="center">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: family.hasCoverage ? "#DCFCE7" : "#FEF3C7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: family.hasCoverage ? "#16A34A" : "#D97706",
              }}
            >
              <Icon source={FamilyIcon} />
            </div>
            <BlockStack gap="050">
              <Text as="h3" variant="headingSm">{tc(family.labelKey.replace("coverage.", ""))}</Text>
              {family.activePackCount > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {tc("activePacks", { count: family.activePackCount })}
                </Text>
              )}
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200" blockAlign="center">
            <Badge tone={family.hasCoverage ? "success" : undefined}>
              {family.hasCoverage ? tc("covered") : tc("notCovered")}
            </Badge>
            {family.automationMode !== "none" && (
              <Badge tone={automationBadgeTone(family.automationMode)}>
                {tc(`mode${family.automationMode === "automated" ? "Automated" : family.automationMode === "review_first" ? "ReviewFirst" : "Manual"}`)}
              </Badge>
            )}
          </InlineStack>
        </InlineStack>

        {!family.hasCoverage && (
          <>
            <Divider />
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" variant="bodySm" tone="subdued">
                {tc("familyRecommendation")}
              </Text>
            </InlineStack>
            <InlineStack gap="200">
              <Button
                size="slim"
                url={withShopParams("/app/packs", searchParams)}
              >
                {tc("installPlaybook")}
              </Button>
              <Button
                size="slim"
                variant="plain"
                url={withShopParams("/app/rules", searchParams)}
              >
                {tc("addAutomation")}
              </Button>
            </InlineStack>
          </>
        )}

        {family.hasCoverage && family.automationMode === "none" && (
          <>
            <Divider />
            <InlineStack gap="200">
              <Button
                size="slim"
                variant="plain"
                url={withShopParams("/app/rules", searchParams)}
              >
                {tc("addAutomation")}
              </Button>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
