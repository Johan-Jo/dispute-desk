"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  TEMPLATE_IDS,
  type TemplateRecommendation,
  type ShopifyEvidenceConfig,
  type StoreProfileForRecommendation,
  type TemplateSlug,
} from "@/lib/setup/recommendTemplates";

interface CoverageStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
  onCanContinueChange?: (canContinue: boolean) => void;
}

interface TemplateInfo {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  dispute_type: string;
  is_recommended: boolean;
}

type AutomationMode = "automated" | "review" | "notify";

interface FamilyRow {
  family: string;
  recs: TemplateRecommendation[];
  automation: AutomationMode;
  confidence: "high" | "medium" | "low";
}

/** Figma-aligned dispute family display data */
const FAMILY_DESCRIPTIONS: Record<string, string> = {
  fraud: "Cardholder claims they did not authorize the transaction",
  pnr: "Customer claims they never received the product",
  not_as_described: "Product quality or description issues",
  subscription: "Customer claims subscription was already canceled",
  refund: "Customer claims promised refund was not issued",
  duplicate: "Customer was charged multiple times",
  digital: "Disputes involving digital products or services",
  general: "Other dispute types that require careful review",
};

const FAMILY_HANDLING: Record<string, string> = {
  fraud: "Full evidence package with fraud signals and delivery proof",
  pnr: "Tracking data, delivery proof, and shipping policy",
  not_as_described: "Product details, photos, and return policy",
  subscription: "Subscription terms, cancellation logs, and usage data",
  refund: "Refund policy and transaction records",
  duplicate: "Transaction history and order records",
  digital: "Access logs, delivery confirmation, and usage records",
  general: "Comprehensive evidence with manual review",
};

function deriveDefaultAutomation(
  family: string,
  confidence: "high" | "medium" | "low"
): AutomationMode {
  if (family === "general") return "notify";
  if (confidence === "high") return "automated";
  if (confidence === "medium") {
    if (family === "not_as_described" || family === "refund") return "review";
    return "automated";
  }
  return "review";
}

function deriveFamilyConfidence(
  family: string,
  globalConfidence: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  if (family === "general") return "low";
  if (family === "not_as_described" || family === "refund") {
    return globalConfidence === "high" ? "medium" : globalConfidence;
  }
  return globalConfidence;
}

const CONFIDENCE_STYLES: Record<string, { bg: string; color: string }> = {
  high: { bg: "#D1FAE5", color: "#065F46" },
  medium: { bg: "#FEF3C7", color: "#92400E" },
  low: { bg: "#FEE2E2", color: "#991B1B" },
};

export function CoverageStep({ onSaveRef, onCanContinueChange }: CoverageStepProps) {
  const tCoverage = useTranslations("setup.coverage");
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recommendations, setRecommendations] = useState<TemplateRecommendation[]>([]);
  const [templateCatalog, setTemplateCatalog] = useState<TemplateInfo[]>([]);
  const [installedTemplateIds, setInstalledTemplateIds] = useState<Set<string>>(new Set());
  const [evidenceConfig, setEvidenceConfig] = useState<ShopifyEvidenceConfig | null>(null);
  const [familyRows, setFamilyRows] = useState<FamilyRow[]>([]);

  // Load data on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stateRes, templatesRes, automationRes] = await Promise.all([
          fetch("/api/setup/state"),
          fetch(`/api/templates?locale=${locale}`),
          fetch("/api/setup/automation"),
        ]);

        if (cancelled) return;

        const state = stateRes.ok ? await stateRes.json() : null;
        const profilePayload = state?.steps?.store_profile?.payload;

        const profile: StoreProfileForRecommendation = {
          storeTypes: profilePayload?.storeTypes ?? ["physical"],
          deliveryProof: profilePayload?.deliveryProof ?? "always",
          digitalProof: profilePayload?.digitalProof ?? "yes",
          shopifyEvidenceConfig: profilePayload?.shopifyEvidenceConfig ?? {
            orderDetails: "always",
            customerAddress: "always",
            fulfillmentRecords: "when_present",
            trackingDetails: "when_present",
            orderTimeline: "when_present",
            refundHistory: "always",
            notesMetadata: "when_present",
          },
        };

        setEvidenceConfig(profile.shopifyEvidenceConfig);

        const catalogData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
        setTemplateCatalog(catalogData.templates ?? []);

        const automationData = automationRes.ok ? await automationRes.json() : {};
        setInstalledTemplateIds(
          new Set((automationData.installedTemplateIds ?? []) as string[])
        );

        const recs = recommendTemplates(profile);
        setRecommendations(recs);

        // Build family rows
        const globalConfidence = deriveEvidenceConfidence(profile.shopifyEvidenceConfig);
        const familyMap = new Map<string, TemplateRecommendation[]>();
        for (const rec of recs.filter((r) => r.isDefault)) {
          const group = familyMap.get(rec.disputeFamily) ?? [];
          group.push(rec);
          familyMap.set(rec.disputeFamily, group);
        }

        const rows: FamilyRow[] = [...familyMap.entries()].map(([family, fRecs]) => {
          const conf = deriveFamilyConfidence(family, globalConfidence);
          return {
            family,
            recs: fRecs,
            automation: deriveDefaultAutomation(family, conf),
            confidence: conf,
          };
        });

        setFamilyRows(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [locale]);

  // Always allow continue (all families pre-selected)
  useEffect(() => {
    onCanContinueChange?.(familyRows.length > 0);
  }, [familyRows, onCanContinueChange]);

  const updateAutomation = (family: string, mode: AutomationMode) => {
    setFamilyRows((prev) =>
      prev.map((r) => (r.family === family ? { ...r, automation: mode } : r))
    );
  };

  // Wire save
  useEffect(() => {
    onSaveRef.current = async () => {
      setSaving(true);
      try {
        // Install default templates that aren't already installed
        const defaultRecs = recommendations.filter((r) => r.isDefault);
        const toInstall = defaultRecs
          .map((r) => r.templateId)
          .filter((id) => !installedTemplateIds.has(id));

        for (const templateId of toInstall) {
          await fetch(`/api/templates/${templateId}/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        }

        const confidence = evidenceConfig
          ? deriveEvidenceConfidence(evidenceConfig)
          : "medium";

        const allSelectedIds = defaultRecs.map((r) => r.templateId);
        const families = [...new Set(defaultRecs.map((r) => r.disputeFamily))];

        // Save coverage settings (family automation modes) for Step 4
        const coverageSettings = Object.fromEntries(
          familyRows.map((r) => [r.family, r.automation])
        );

        const res = await fetch("/api/setup/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stepId: "coverage",
            payload: {
              installedTemplateIds: allSelectedIds,
              selectedFamilies: families,
              evidenceConfidence: confidence,
              coverageSettings,
            },
          }),
        });
        return res.ok;
      } finally {
        setSaving(false);
      }
    };
  }, [onSaveRef, recommendations, installedTemplateIds, evidenceConfig, familyRows]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Spinner size="small" />
      </div>
    );
  }

  const getTemplateName = (slug: string) => {
    const id = TEMPLATE_IDS[slug as TemplateSlug];
    return templateCatalog.find((t) => t.id === id)?.name ?? slug.replace(/_/g, " ");
  };

  // Stats
  const automatedCount = familyRows.filter((r) => r.automation === "automated").length;
  const reviewCount = familyRows.filter((r) => r.automation === "review").length;
  const notifyCount = familyRows.filter((r) => r.automation === "notify").length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {tCoverage("title")}
        </h2>
        <p style={{ fontSize: 15, color: "#6D7175", margin: 0 }}>
          {tCoverage("subtitle")}
        </p>
      </div>

      {/* Summary banner */}
      <div style={{
        background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)",
        border: "1px solid #BFDBFE",
        borderRadius: 10,
        padding: "20px 24px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#202223", margin: "0 0 4px" }}>
            {tCoverage("summaryTitle")}
          </h3>
          <p style={{ fontSize: 13, color: "#6D7175", margin: 0 }}>
            {tCoverage("summarySubtitle")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1D4ED8" }}>{automatedCount}</div>
            <div style={{ fontSize: 11, color: "#6D7175" }}>{tCoverage("statAutomated")}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#F59E0B" }}>{reviewCount}</div>
            <div style={{ fontSize: 11, color: "#6D7175" }}>{tCoverage("statReview")}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#6D7175" }}>{notifyCount}</div>
            <div style={{ fontSize: 11, color: "#6D7175" }}>{tCoverage("statNotify")}</div>
          </div>
        </div>
      </div>

      {/* Coverage table */}
      <div style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F7F8FA", borderBottom: "1px solid #E1E3E5" }}>
                {["colDisputeType", "colHandling", "colAutomation", "colConfidence"].map((key) => (
                  <th
                    key={key}
                    style={{
                      padding: "10px 20px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6D7175",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {tCoverage(key as Parameters<typeof tCoverage>[0])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {familyRows.map((row) => (
                <tr
                  key={row.family}
                  style={{ borderBottom: "1px solid #E1E3E5" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F7F8FA"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  {/* Dispute Type */}
                  <td style={{ padding: "14px 20px", verticalAlign: "top" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 3 }}>
                      {tCoverage(`family_${row.family}` as Parameters<typeof tCoverage>[0])}
                    </div>
                    <div style={{ fontSize: 12, color: "#6D7175" }}>
                      {FAMILY_DESCRIPTIONS[row.family] ?? ""}
                    </div>
                  </td>

                  {/* Recommended Handling */}
                  <td style={{ padding: "14px 20px", verticalAlign: "top", maxWidth: 240 }}>
                    <div style={{ fontSize: 12, color: "#6D7175", lineHeight: 1.5 }}>
                      {FAMILY_HANDLING[row.family] ?? ""}
                    </div>
                  </td>

                  {/* Automation dropdown */}
                  <td style={{ padding: "14px 20px", verticalAlign: "top" }}>
                    <select
                      value={row.automation}
                      onChange={(e) => updateAutomation(row.family, e.target.value as AutomationMode)}
                      style={{
                        padding: "6px 28px 6px 10px",
                        border: "1px solid #E1E3E5",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#202223",
                        background: "#fff",
                        cursor: "pointer",
                        appearance: "auto" as const,
                        outline: "none",
                      }}
                    >
                      <option value="automated">{tCoverage("modeAutomated")}</option>
                      <option value="review">{tCoverage("modeReview")}</option>
                      <option value="notify">{tCoverage("modeNotify")}</option>
                    </select>
                  </td>

                  {/* Confidence badge */}
                  <td style={{ padding: "14px 20px", verticalAlign: "top" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 600,
                      background: CONFIDENCE_STYLES[row.confidence].bg,
                      color: CONFIDENCE_STYLES[row.confidence].color,
                    }}>
                      {tCoverage(`confidence_${row.confidence}` as Parameters<typeof tCoverage>[0])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info note */}
      <div style={{
        background: "#EFF6FF",
        border: "1px solid #BFDBFE",
        borderRadius: 10,
        padding: 16,
      }}>
        <p style={{ fontSize: 13, color: "#1E40AF", margin: 0, lineHeight: 1.6 }}>
          <strong>{tCoverage("noteLabel")}</strong> {tCoverage("noteText")}
        </p>
      </div>

      {saving && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <Spinner size="small" />
          <span style={{ fontSize: 13, color: "#6D7175" }}>{tCoverage("installingSaving")}</span>
        </div>
      )}
    </div>
  );
}
