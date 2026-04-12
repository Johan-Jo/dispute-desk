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
  Banner,
  Collapsible,
} from "@shopify/polaris";
import {
  ShieldPersonIcon,
  AlertTriangleIcon,
  DeliveryIcon,
  OrderIcon,
  ReceiptRefundIcon,
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

const EXPLAINER_DISMISSED_KEY = "dd_coverage_explainer_dismissed";

function automationBadgeTone(mode: AutomationMode, hasPlaybooks: boolean): "success" | "info" | "warning" | undefined {
  switch (mode) {
    case "automated": return "success";
    case "review_first": return "info";
    case "manual": return "warning";
    case "none": return hasPlaybooks ? "warning" : undefined;
  }
}

function automationModeLabel(mode: AutomationMode, hasPlaybooks: boolean, tc: (key: string) => string): string {
  switch (mode) {
    case "automated": return tc("modeAutomated");
    case "review_first": return tc("modeReviewFirst");
    case "manual": return tc("modeManual");
    case "none": return hasPlaybooks ? tc("modeManualPlaybookReady") : tc("phaseGap");
  }
}

interface VisiblePack {
  id: string;
  name: string;
  dispute_type: string;
  status: string;
}

export default function CoveragePage() {
  const tc = useTranslations("coverage");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<LifecycleCoverageSummary | null>(null);
  const [installedInquiryCount, setInstalledInquiryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [installModalFamily, setInstallModalFamily] = useState<string | null>(null);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(EXPLAINER_DISMISSED_KEY) !== "1";
  });

  const dismissExplainer = useCallback(() => {
    setExplainerOpen(false);
    try { localStorage.setItem(EXPLAINER_DISMISSED_KEY, "1"); } catch {}
  }, []);

  const loadCoverage = useCallback(async () => {
    const [rulesData, packsData, mappingsData] = await Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs").then((r) => (r.ok ? r.json() : { packs: [] })),
      fetch("/api/reason-mappings").then((r) => (r.ok ? r.json() : { mappings: [] })),
    ]);
    const rules = Array.isArray(rulesData) ? rulesData : [];
    const allPacks: Array<{ id: string; name: string; template_id?: string | null; status?: string; dispute_type?: string }> =
      packsData?.packs ?? [];
    const inquiryIds = new Set<string>();
    for (const p of allPacks) {
      if (p.template_id && INQUIRY_TEMPLATE_ID_SET.has(p.template_id)) {
        inquiryIds.add(p.template_id);
      }
    }
    setInstalledInquiryCount(inquiryIds.size);
    const visiblePacks: VisiblePack[] = allPacks
      .filter(
        (p) =>
          p.status === "ACTIVE" &&
          (!p.template_id || !INQUIRY_TEMPLATE_ID_SET.has(p.template_id)),
      )
      .map((p) => ({
        id: p.id,
        name: p.name ?? "",
        dispute_type: p.dispute_type ?? "",
        status: p.status ?? "",
      }));
    const mappings = mappingsData?.mappings ?? [];
    setCoverage(deriveLifecycleCoverage(rules, visiblePacks, mappings));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCoverage().finally(() => {
      if (!cancelled) setLoading(false);
    });
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
    setShowInquiryModal(false);
    loadCoverage();
  }, [loadCoverage]);

  if (loading) {
    return (
      <Page
        title={tc("title")}
        subtitle={tc("lifecycleSubtitle")}
        backAction={{ content: tNav("overview"), url: "/app" }}
      >
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

  // All families unconfigured → show empty state
  if (c.fullyConfiguredCount === 0 && c.gapsCount === c.totalFamilies) {
    return (
      <Page
        title={tc("title")}
        subtitle={tc("coveragePurpose")}
        backAction={{ content: tNav("overview"), url: "/app" }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    background: "#FEE2E2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#DC2626",
                  }}
                >
                  <Icon source={ShieldPersonIcon} />
                </div>
                <Text as="h2" variant="headingMd" alignment="center">
                  {tc("emptyStateTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  {tc("emptyStateBody")}
                </Text>
                <InlineStack gap="200" align="center">
                  <Button
                    variant="primary"
                    url={withShopParams("/app/rules", searchParams)}
                  >
                    {tc("emptyStatePrimaryCta")}
                  </Button>
                  <Button
                    url={withShopParams("/app/packs", searchParams)}
                  >
                    {tc("primaryBrowsePlaybooks")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Priority gap = first family with any gap, in DISPUTE_FAMILIES order.
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
      : tc("stateWithGaps", {
            covered: c.fullyConfiguredCount,
            total: c.totalFamilies,
            gaps: c.gapsCount,
          });

  return (
    <Page
      title={tc("title")}
      subtitle={tc("coveragePurpose")}
      backAction={{ content: tNav("overview"), url: "/app" }}
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
        {/* Dismissable explainer */}
        <Layout.Section>
          <Collapsible id="coverage-explainer" open={explainerOpen}>
            <Banner onDismiss={dismissExplainer}>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {tc("explainerTitle")}
                </Text>
                <Text as="p" variant="bodySm">
                  • {tc("explainerBullet1")}
                </Text>
                <Text as="p" variant="bodySm">
                  • {tc("explainerBullet2")}
                </Text>
                <Text as="p" variant="bodySm">
                  • {tc("explainerBullet3")}
                </Text>
              </BlockStack>
            </Banner>
          </Collapsible>
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

        {/* Inquiry coverage */}
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
              {installedInquiryCount === 0 && (
                <InlineStack gap="200">
                  <Button
                    size="slim"
                    onClick={() => setShowInquiryModal(true)}
                  >
                    {tc("inquiryInstallCta")}
                  </Button>
                </InlineStack>
              )}
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
      {shopId && showInquiryModal && (
        <TemplateLibraryModal
          isOpen
          onClose={() => setShowInquiryModal(false)}
          shopId={shopId}
          locale={locale}
          onInstalled={handleInstalled}
          initialCategory=""
        />
      )}
    </Page>
  );
}

function phasesIdentical(a: LifecyclePhaseHandling, b: LifecyclePhaseHandling): boolean {
  if (a.automationMode !== b.automationMode) return false;
  if (a.hasGap !== b.hasGap) return false;
  const aPacks = new Set(a.playbooks.map((p) => p.name));
  const bPacks = new Set(b.playbooks.map((p) => p.name));
  if (aPacks.size !== bPacks.size) return false;
  for (const n of aPacks) if (!bPacks.has(n)) return false;
  return true;
}

function PhaseRow({
  handling,
  mergedLabel,
  tc,
  familyId,
  searchParams,
  onInstallClick,
}: {
  handling: LifecyclePhaseHandling;
  mergedLabel?: string;
  tc: (key: string, params?: Record<string, string | number>) => string;
  familyId: string;
  searchParams: ReturnType<typeof useSearchParams>;
  onInstallClick: () => void;
}) {
  const phaseLabel = mergedLabel ?? (handling.phase === "inquiry" ? tc("inquiryLabel") : tc("chargebackLabel"));

  return (
    <InlineStack gap="300" blockAlign="center" wrap>
      <div style={{ minWidth: "90px" }}>
        <Badge tone={handling.phase === "inquiry" ? "info" : "warning"}>
          {phaseLabel}
        </Badge>
      </div>
      <Badge tone={automationBadgeTone(handling.automationMode, handling.playbooks.length > 0)}>
        {automationModeLabel(handling.automationMode, handling.playbooks.length > 0, tc)}
      </Badge>
      {handling.playbooks.length > 0 && (
        <Text as="span" variant="bodySm" tone="subdued">
          {tc("activePacks", { count: new Set(handling.playbooks.map((p) => p.name)).size })}
        </Text>
      )}
      {handling.hasGap && (
        <>
          <Text as="span" variant="bodySm" tone="critical">
            {tc("noPlaybook")}
          </Text>
          <Button
            size="slim"
            variant="plain"
            url={withShopParams(
              `/app/rules?family=${familyId}&phase=${handling.phase}`,
              searchParams,
            )}
          >
            {tc("fixPhaseGap")}
          </Button>
          <Button
            size="slim"
            variant="plain"
            onClick={onInstallClick}
          >
            {tc("installPlaybook")}
          </Button>
        </>
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

        {/* Phase rows — merge into one when both phases have identical handling */}
        {phasesIdentical(family.inquiry, family.chargeback) ? (
          <PhaseRow
            handling={family.inquiry}
            mergedLabel={tc("bothPhases")}
            tc={tc}
            familyId={family.familyId}
            searchParams={searchParams}
            onInstallClick={onInstallClick}
          />
        ) : (
          <>
            <PhaseRow
              handling={family.inquiry}
              tc={tc}
              familyId={family.familyId}
              searchParams={searchParams}
              onInstallClick={onInstallClick}
            />
            <PhaseRow
              handling={family.chargeback}
              tc={tc}
              familyId={family.familyId}
              searchParams={searchParams}
              onInstallClick={onInstallClick}
            />
          </>
        )}

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
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
