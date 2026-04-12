/**
 * Lifecycle-aware coverage page.
 *
 * Shows per-family, per-phase handling: how inquiries and chargebacks
 * are handled for each dispute family. Derives coverage from rules,
 * active packs, and reason_template_mappings.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
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
import {
  INQUIRY_TEMPLATE_IDS,
  INQUIRY_TEMPLATE_ID_SET,
} from "@/lib/setup/recommendTemplates";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";

/** Maps the coverage page's family IDs to pack_templates.dispute_type values
 * used by the template library catalog. */
const FAMILY_TO_DISPUTE_TYPE: Record<string, string> = {
  fraud: "FRAUD",
  pnr: "PNR",
  not_as_described: "NOT_AS_DESCRIBED",
  subscription: "SUBSCRIPTION",
  refund: "REFUND",
  duplicate: "DUPLICATE",
  general: "GENERAL",
};

const TOTAL_INQUIRY_TEMPLATES = Object.keys(INQUIRY_TEMPLATE_IDS).length;

const FAMILY_ICONS: Record<string, typeof ShieldPersonIcon> = {
  fraud: ShieldPersonIcon,
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
  const tc = useTranslations("coverage");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<LifecycleCoverageSummary | null>(null);
  const [installedInquiryCount, setInstalledInquiryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [installModalFamily, setInstallModalFamily] = useState<string | null>(null);

  const loadCoverage = useCallback(async () => {
    const [rulesData, packsData, mappingsData] = await Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs").then((r) => (r.ok ? r.json() : { packs: [] })),
      fetch("/api/reason-mappings").then((r) => (r.ok ? r.json() : { mappings: [] })),
    ]);
    const rules = Array.isArray(rulesData) ? rulesData : [];
    const allPacks: Array<{ template_id?: string | null; status?: string }> =
      packsData?.packs ?? [];
    const inquiryIds = new Set<string>();
    for (const p of allPacks) {
      if (p.template_id && INQUIRY_TEMPLATE_ID_SET.has(p.template_id)) {
        inquiryIds.add(p.template_id);
      }
    }
    setInstalledInquiryCount(inquiryIds.size);
    const visiblePacks = allPacks.filter(
      (p) =>
        p.status === "ACTIVE" &&
        (!p.template_id || !INQUIRY_TEMPLATE_ID_SET.has(p.template_id)),
    );
    const mappings = mappingsData?.mappings ?? [];
    setCoverage(deriveLifecycleCoverage(rules, visiblePacks as never, mappings));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCoverage().finally(() => {
      if (!cancelled) setLoading(false);
    });
    // Resolve shopId for the template library modal.
    fetch("/api/setup/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.shopId) setShopId(data.shopId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadCoverage]);

  const handleInstalled = useCallback(() => {
    setInstallModalFamily(null);
    loadCoverage();
  }, [loadCoverage]);

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

  // Priority gap = first family with any gap, in DISPUTE_FAMILIES order.
  // If the priority family has no playbooks at all, the first step is installing one.
  const priorityGap = c.families.find((f) => !f.overallCovered) ?? null;
  const priorityNeedsPlaybook =
    priorityGap !== null &&
    priorityGap.inquiry.playbooks.length === 0 &&
    priorityGap.chargeback.playbooks.length === 0;

  const primaryActionContent = priorityGap
    ? tc("primaryFixGap", {
        family: tc(priorityGap.labelKey.replace("coverage.", "")),
      })
    : tc("primaryReviewRules");
  const primaryActionUrl = withShopParams(
    priorityNeedsPlaybook ? "/app/packs" : "/app/rules",
    searchParams,
  );

  const stateText =
    c.gapsCount === 0
      ? tc("stateAllSetup", { total: c.totalFamilies })
      : c.fullyConfiguredCount === 0
        ? tc("stateNoSetup")
        : tc("stateWithGaps", {
            covered: c.fullyConfiguredCount,
            total: c.totalFamilies,
            gaps: c.gapsCount,
          });

  return (
    <Page
      title={tc("title")}
      subtitle={tc("coveragePurpose")}
      primaryAction={{
        content: primaryActionContent,
        url: primaryActionUrl,
      }}
      secondaryActions={[
        {
          content: tc("primaryBrowsePlaybooks"),
          url: withShopParams("/app/packs", searchParams),
        },
      ]}
    >
      <Layout>
        {/* Plain-language explainer — first-time visitors need to know what
            this page is actually for before the state sentence makes sense. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {tc("explainerTitle")}
              </Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  • {tc("explainerBullet1")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  • {tc("explainerBullet2")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  • {tc("explainerBullet3")}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Current state — plain language */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyLg" fontWeight="semibold">
                {stateText}
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone={c.gapsCount === 0 ? "success" : undefined}>
                  {tc("fullyConfigured", { count: c.fullyConfiguredCount })}
                </Badge>
                {c.gapsCount > 0 && (
                  <Badge tone="attention">
                    {tc("gapsFound", { count: c.gapsCount })}
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Inquiry coverage — read-only reassurance that silent pairing is wired up */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">
                  {tc("inquiryCoverageTitle")}
                </Text>
                <Badge tone={installedInquiryCount > 0 ? "success" : undefined}>
                  {installedInquiryCount > 0
                    ? tc("inquiryCoverageOn")
                    : tc("inquiryCoverageOff")}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {tc("inquiryCoverageBody", {
                  installed: installedInquiryCount,
                  total: TOTAL_INQUIRY_TEMPLATES,
                })}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Family Cards */}
        {c.families.map((family) => (
          <Layout.Section key={family.familyId}>
            <LifecycleFamilyCard
              family={family}
              tc={tc}
              searchParams={searchParams}
              onInstallClick={() => setInstallModalFamily(family.familyId)}
            />
          </Layout.Section>
        ))}
      </Layout>
      {shopId && installModalFamily && (
        <TemplateLibraryModal
          isOpen
          onClose={() => setInstallModalFamily(null)}
          shopId={shopId}
          locale={locale}
          onInstalled={handleInstalled}
          initialCategory={FAMILY_TO_DISPUTE_TYPE[installModalFamily] ?? ""}
        />
      )}
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
  onInstallClick,
}: {
  family: LifecycleFamilyCoverage;
  tc: ReturnType<typeof useTranslations>;
  searchParams: ReturnType<typeof useSearchParams>;
  onInstallClick: () => void;
}) {
  const FamilyIcon = FAMILY_ICONS[family.familyId] ?? ClipboardCheckFilledIcon;
  // Three-state: fully covered, partial, not covered
  const isPartial = !family.overallCovered && (!family.inquiry.hasGap || !family.chargeback.hasGap);
  const statusLabel = family.overallCovered
    ? tc("statusFullyCovered")
    : isPartial
      ? tc("statusPartial")
      : tc("statusNotCovered");
  const statusTone = family.overallCovered
    ? ("success" as const)
    : isPartial
      ? ("warning" as const)
      : undefined;
  const iconBg = family.overallCovered ? "#DCFCE7" : isPartial ? "#FEF3C7" : "#FEE2E2";
  const iconColor = family.overallCovered ? "#16A34A" : isPartial ? "#D97706" : "#DC2626";

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
                background: iconBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: iconColor,
              }}
            >
              <Icon source={FamilyIcon} />
            </div>
            <Text as="h3" variant="headingSm">
              {tc(family.labelKey.replace("coverage.", ""))}
            </Text>
          </InlineStack>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </InlineStack>

        <Divider />

        {/* Phase rows */}
        <PhaseRow handling={family.inquiry} tc={tc} />
        <PhaseRow handling={family.chargeback} tc={tc} />

        {/* Edit handling — always visible so the merchant has a clear path to
            change how this family is handled (automated / review / manual /
            installed playbooks). Deep-links to /app/rules with the family id
            so the rules page can scroll to the matching row. */}
        <Divider />
        <InlineStack gap="200" wrap>
          <Button
            size="slim"
            url={withShopParams(
              `/app/rules?family=${family.familyId}`,
              searchParams,
            )}
          >
            {tc("editHandling")}
          </Button>
          {family.inquiry.playbooks.length === 0 &&
            family.chargeback.playbooks.length === 0 && (
              <Button
                size="slim"
                variant="plain"
                onClick={onInstallClick}
              >
                {tc("installPlaybook")}
              </Button>
            )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
