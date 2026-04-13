"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  inquiryPairsFor,
  TEMPLATE_IDS,
  INQUIRY_TEMPLATE_IDS,
  INQUIRY_TEMPLATE_ID_SET,
  type TemplateRecommendation,
  type ShopifyEvidenceConfig,
  type StoreProfileForRecommendation,
  type TemplateSlug,
} from "@/lib/setup/recommendTemplates";

const TOTAL_INQUIRY_TEMPLATES = Object.keys(INQUIRY_TEMPLATE_IDS).length;

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extraSelectedIds, setExtraSelectedIds] = useState<Set<string>>(new Set());

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
        // Install default templates plus any extras the merchant ticked from
        // the "advanced" disclosure, plus the silent inquiry siblings for
        // every chargeback template being installed.
        const defaultRecs = recommendations.filter((r) => r.isDefault);
        const chargebackIds = [
          ...defaultRecs.map((r) => r.templateId),
          ...extraSelectedIds,
        ];
        const inquiryPairIds = inquiryPairsFor(chargebackIds);
        const toInstall = [...chargebackIds, ...inquiryPairIds].filter(
          (id) => !installedTemplateIds.has(id)
        );

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

        // The wizard's persisted state still tracks chargeback templates only;
        // inquiry pairs are an implementation detail of the runtime routing.
        const allSelectedIds = chargebackIds;
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
        if (!res.ok) return false;

        // Create family-level automation rules from coverage settings
        await fetch("/api/setup/coverage-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coverageSettings }),
        });

        return true;
      } finally {
        setSaving(false);
      }
    };
  }, [onSaveRef, recommendations, installedTemplateIds, evidenceConfig, familyRows, extraSelectedIds]);

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

  // Count inquiry templates the merchant already has installed (silently
  // paired during a previous save). Used by the read-only inquiry coverage
  // block below the table.
  let installedInquiryCount = 0;
  for (const id of installedTemplateIds) {
    if (INQUIRY_TEMPLATE_ID_SET.has(id)) installedInquiryCount++;
  }

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
                      {tCoverage(`desc_${row.family}` as Parameters<typeof tCoverage>[0])}
                    </div>
                  </td>

                  {/* Recommended Handling */}
                  <td style={{ padding: "14px 20px", verticalAlign: "top", maxWidth: 240 }}>
                    <div style={{ fontSize: 12, color: "#6D7175", lineHeight: 1.5 }}>
                      {tCoverage(`handling_${row.family}` as Parameters<typeof tCoverage>[0])}
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

      {/* Inquiry coverage — read-only reassurance about silent pairing */}
      <div
        style={{
          background: "#F0FDF4",
          border: "1px solid #BBF7D0",
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#DCFCE7",
            color: "#166534",
            fontWeight: 700,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden
        >
          ✓
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#14532D",
              marginBottom: 4,
            }}
          >
            {tCoverage("inquiryCoverageTitle")}
          </div>
          <p
            style={{
              fontSize: 12,
              color: "#166534",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {installedInquiryCount > 0
              ? tCoverage("inquiryCoverageBody", {
                  installed: installedInquiryCount,
                  total: TOTAL_INQUIRY_TEMPLATES,
                })
              : tCoverage("inquiryCoverageBodyPending")}
          </p>
        </div>
      </div>

      {/* Advanced playbooks disclosure — non-recommended chargeback templates */}
      {(() => {
        const extras = recommendations.filter((r) => !r.isDefault);
        if (extras.length === 0) return null;
        return (
          <div
            style={{
              background: "#fff",
              border: "1px solid #E1E3E5",
              borderRadius: 10,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#202223",
              }}
              aria-expanded={showAdvanced}
            >
              <span style={{ fontSize: 11 }}>{showAdvanced ? "▼" : "▶"}</span>
              {tCoverage("advancedTitle")}
              <span style={{ fontSize: 11, fontWeight: 500, color: "#6D7175" }}>
                ({extras.length})
              </span>
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 12, color: "#6D7175", margin: "0 0 12px" }}>
                  {tCoverage("advancedSubtitle")}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {extras.map((rec) => {
                    const id = rec.templateId;
                    const checked =
                      extraSelectedIds.has(id) || installedTemplateIds.has(id);
                    const alreadyInstalled = installedTemplateIds.has(id);
                    return (
                      <label
                        key={id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          fontSize: 12,
                          color: "#202223",
                          cursor: alreadyInstalled ? "default" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={alreadyInstalled}
                          onChange={(e) => {
                            setExtraSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(id);
                              else next.delete(id);
                              return next;
                            });
                          }}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          <strong>{getTemplateName(rec.slug)}</strong>
                          {alreadyInstalled && (
                            <span style={{ color: "#6D7175", fontWeight: 400 }}>
                              {" "}
                              · {tCoverage("advancedAlreadyInstalled")}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
