/**
 * Embedded Coverage page — Figma-matched single-table layout.
 * Replaces the prior per-family stacked-card UI. Live data wiring
 * (rules, packs, reason mappings → deriveLifecycleCoverage) is unchanged;
 * only the presentation collapses inquiry + chargeback into a single row
 * per dispute family.
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
  Icon,
  useBreakpoints,
} from "@shopify/polaris";
import { ShieldPersonIcon, InfoIcon, XIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import {
  deriveLifecycleCoverage,
  type LifecycleCoverageSummary,
} from "@/lib/coverage/deriveLifecycleCoverage";
import {
  INQUIRY_TEMPLATE_IDS,
  INQUIRY_TEMPLATE_ID_SET,
} from "@/lib/setup/recommendTemplates";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";
import { CoverageTable } from "./CoverageTable";
import { MobileCoverageList } from "./MobileCoverageList";
import { toRow } from "./coverageHelpers";

const TOTAL_INQUIRY_TEMPLATES = Object.keys(INQUIRY_TEMPLATE_IDS).length;
const EXPLAINER_DISMISSED_KEY = "dd_coverage_explainer_dismissed";

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
  const { smDown } = useBreakpoints();

  const [coverage, setCoverage] = useState<LifecycleCoverageSummary | null>(null);
  const [installedInquiryCount, setInstalledInquiryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
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
    setShowInquiryModal(false);
    loadCoverage();
  }, [loadCoverage]);

  if (loading) {
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
                <Spinner size="large" />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const c = coverage!;

  // All families unconfigured → show empty state (unchanged behaviour).
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
                  <Button url={withShopParams("/app/packs", searchParams)}>
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

  const rows = c.families.map(toRow);

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
        content: tc("primaryReviewRules"),
        url: withShopParams("/app/rules", searchParams),
      }}
      secondaryActions={[
        {
          content: tc("primaryBrowsePlaybooks"),
          url: withShopParams("/app/packs", searchParams),
        },
      ]}
    >
      <Layout>
        {/* Dismissable explainer — Figma soft-blue card */}
        {explainerOpen && (
          <Layout.Section>
            <div
              style={{
                background: "#EBF5FA",
                border: "1px solid #B4E1FA",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  marginTop: 2,
                  color: "#005BD3",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon source={InfoIcon} tone="info" />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
                  {tc("explainerTitle")}
                </div>
                <ul style={{ listStyle: "disc", margin: 0, paddingLeft: 18, color: "#202223", fontSize: 14, lineHeight: 1.5 }}>
                  <li style={{ marginBottom: 6 }}>{tc("explainerBullet1")}</li>
                  <li style={{ marginBottom: 6 }}>{tc("explainerBullet2")}</li>
                  <li>{tc("explainerBullet3")}</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={dismissExplainer}
                aria-label="Dismiss"
                style={{
                  flexShrink: 0,
                  background: "transparent",
                  border: "none",
                  padding: 4,
                  cursor: "pointer",
                  color: "#6D7175",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ width: 20, height: 20, display: "inline-flex" }}>
                  <Icon source={XIcon} />
                </span>
              </button>
            </div>
          </Layout.Section>
        )}

        {/* Status summary */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
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
                  <Button size="slim" onClick={() => setShowInquiryModal(true)}>
                    {tc("inquiryInstallCta")}
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Coverage table / mobile list */}
        <Layout.Section>
          <Card padding="0">
            {smDown ? (
              <MobileCoverageList rows={rows} searchParams={searchParams} tc={tc} />
            ) : (
              <CoverageTable rows={rows} searchParams={searchParams} tc={tc} />
            )}
          </Card>
        </Layout.Section>
      </Layout>

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
