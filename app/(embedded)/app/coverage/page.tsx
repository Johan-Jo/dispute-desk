/**
 * Lifecycle-aware coverage page.
 *
 * Shows per-family, per-phase handling: how inquiries and chargebacks
 * are handled for each dispute family. Derives coverage from rules,
 * active packs, and reason_template_mappings.
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
  deriveLifecycleCoverage,
  type LifecycleCoverageSummary,
  type LifecycleFamilyCoverage,
  type LifecyclePhaseHandling,
} from "@/lib/coverage/deriveLifecycleCoverage";
import { type AutomationMode } from "@/lib/coverage/deriveCoverage";

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

function automationBadgeTone(mode: AutomationMode): "success" | "info" | "warning" | undefined {
  switch (mode) {
    case "automated": return "success";
    case "review_first": return "info";
    case "manual": return "warning";
    case "none": return undefined;
  }
}

function automationModeLabel(mode: AutomationMode, tc: (key: string) => string): string {
  switch (mode) {
    case "automated": return tc("modeAutomated");
    case "review_first": return tc("modeReviewFirst");
    case "manual": return tc("modeManual");
    case "none": return tc("phaseGap");
  }
}

export default function CoveragePage() {
  const t = useTranslations();
  const tc = useTranslations("coverage");
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<LifecycleCoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs?status=ACTIVE").then((r) => (r.ok ? r.json() : { packs: [] })),
      fetch("/api/reason-mappings").then((r) => (r.ok ? r.json() : { mappings: [] })),
    ])
      .then(([rulesData, packsData, mappingsData]) => {
        if (cancelled) return;
        const rules = Array.isArray(rulesData) ? rulesData : [];
        const packs = packsData?.packs ?? [];
        const mappings = mappingsData?.mappings ?? [];
        setCoverage(deriveLifecycleCoverage(rules, packs, mappings));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Page title={tc("title")} subtitle={tc("lifecycleSubtitle")}>
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
      subtitle={tc("lifecycleSubtitle")}
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
          <Banner tone={c.gapsCount === 0 ? "success" : "warning"}>
            <InlineStack gap="200" wrap>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {tc("fullyConfigured", { count: c.fullyConfiguredCount })}
                {" / "}
                {c.totalFamilies}
              </Text>
              <Badge tone="info">{tc("inquiryConfigured", { count: c.inquiryConfiguredCount })}</Badge>
              <Badge tone="warning">{tc("chargebackConfigured", { count: c.chargebackConfiguredCount })}</Badge>
              {c.gapsCount > 0 && (
                <Badge tone="critical">{tc("gapsFound", { count: c.gapsCount })}</Badge>
              )}
            </InlineStack>
          </Banner>
        </Layout.Section>

        {/* Family Cards */}
        {c.families.map((family) => (
          <Layout.Section key={family.familyId}>
            <LifecycleFamilyCard
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

function PhaseRow({
  handling,
  tc,
}: {
  handling: LifecyclePhaseHandling;
  tc: (key: string, params?: Record<string, string | number>) => string;
}) {
  const phaseLabel = handling.phase === "inquiry" ? tc("inquiryLabel") : tc("chargebackLabel");

  return (
    <InlineStack gap="300" blockAlign="center" wrap>
      <div style={{ minWidth: "90px" }}>
        <Badge tone={handling.phase === "inquiry" ? "info" : "warning"}>
          {phaseLabel}
        </Badge>
      </div>
      <Badge tone={automationBadgeTone(handling.automationMode)}>
        {automationModeLabel(handling.automationMode, tc)}
      </Badge>
      {handling.mappedTemplateName && (
        <Text as="span" variant="bodySm" tone="subdued">
          {tc("mappedTemplate", { name: handling.mappedTemplateName })}
        </Text>
      )}
      {!handling.mappedTemplateName && handling.automationMode !== "none" && (
        <Text as="span" variant="bodySm" tone="subdued">
          {tc("noMappedTemplate")}
        </Text>
      )}
      {handling.playbooks.length > 0 && (
        <Text as="span" variant="bodySm" tone="subdued">
          {tc("activePacks", { count: handling.playbooks.length })}
        </Text>
      )}
      {handling.hasGap && (
        <Text as="span" variant="bodySm" tone="critical">
          {tc("noPlaybook")}
        </Text>
      )}
    </InlineStack>
  );
}

function LifecycleFamilyCard({
  family,
  tc,
  searchParams,
}: {
  family: LifecycleFamilyCoverage;
  tc: ReturnType<typeof useTranslations>;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const FamilyIcon = FAMILY_ICONS[family.familyId] ?? ClipboardCheckFilledIcon;
  const bothIdentical =
    family.inquiry.automationMode === family.chargeback.automationMode &&
    family.inquiry.mappedTemplateName === family.chargeback.mappedTemplateName &&
    family.inquiry.playbooks.length === family.chargeback.playbooks.length;

  return (
    <Card>
      <BlockStack gap="300">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="300" blockAlign="center">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: family.overallCovered ? "#DCFCE7" : "#FEF3C7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: family.overallCovered ? "#16A34A" : "#D97706",
              }}
            >
              <Icon source={FamilyIcon} />
            </div>
            <Text as="h3" variant="headingSm">
              {tc(family.labelKey.replace("coverage.", ""))}
            </Text>
          </InlineStack>
          <Badge tone={family.overallCovered ? "success" : undefined}>
            {family.overallCovered ? tc("covered") : tc("notCovered")}
          </Badge>
        </InlineStack>

        <Divider />

        {/* Phase rows */}
        <PhaseRow handling={family.inquiry} tc={tc} />
        <PhaseRow handling={family.chargeback} tc={tc} />

        {bothIdentical && (
          <Text as="p" variant="bodySm" tone="subdued">
            {tc("identicalHandling")}
          </Text>
        )}

        {/* Gap actions */}
        {(family.inquiry.hasGap || family.chargeback.hasGap) && (
          <>
            <Divider />
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
      </BlockStack>
    </Card>
  );
}
