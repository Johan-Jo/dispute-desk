"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  EVIDENCE_GROUP_IDS,
  TEMPLATE_IDS,
  type TemplateRecommendation,
  type ShopifyEvidenceConfig,
  type StoreProfileForRecommendation,
  type EvidenceGroupId,
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

const BEHAVIOR_LABELS: Record<string, string> = {
  always: "Always include",
  when_present: "When present",
  review: "Review first",
  off: "Off",
};

export function CoverageStep({ onSaveRef, onCanContinueChange }: CoverageStepProps) {
  const tCoverage = useTranslations("setup.coverage");
  const tProfile = useTranslations("setup.storeProfile");
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recommendations, setRecommendations] = useState<TemplateRecommendation[]>([]);
  const [templateCatalog, setTemplateCatalog] = useState<TemplateInfo[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [installedTemplateIds, setInstalledTemplateIds] = useState<Set<string>>(new Set());
  const [evidenceConfig, setEvidenceConfig] = useState<ShopifyEvidenceConfig | null>(null);

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

        // Read store profile
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

        // Template catalog
        const catalogData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
        setTemplateCatalog(catalogData.templates ?? []);

        // Already installed
        const automationData = automationRes.ok ? await automationRes.json() : {};
        setInstalledTemplateIds(
          new Set((automationData.installedTemplateIds ?? []) as string[])
        );

        // Check if re-entering: load previously selected from coverage payload
        const coveragePayload = state?.steps?.coverage?.payload;
        if (coveragePayload?.installedTemplateIds?.length > 0) {
          // Re-entry: use previously installed template IDs to derive selected slugs
          const prevIds = new Set(coveragePayload.installedTemplateIds as string[]);
          const allRecs = recommendTemplates(profile);
          setRecommendations(allRecs);
          setSelectedSlugs(
            new Set(allRecs.filter((r) => prevIds.has(r.templateId) || r.isDefault).map((r) => r.slug))
          );
        } else {
          // First visit: use recommendation defaults
          const recs = recommendTemplates(profile);
          setRecommendations(recs);
          setSelectedSlugs(new Set(recs.filter((r) => r.isDefault).map((r) => r.slug)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Update canContinue when selection changes
  useEffect(() => {
    onCanContinueChange?.(selectedSlugs.size > 0);
  }, [selectedSlugs, onCanContinueChange]);

  const toggleSlug = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  // Wire save
  useEffect(() => {
    onSaveRef.current = async () => {
      setSaving(true);
      try {
        // Install selected templates that aren't already installed
        const toInstall = [...selectedSlugs]
          .map((slug) => TEMPLATE_IDS[slug as keyof typeof TEMPLATE_IDS])
          .filter((id) => id && !installedTemplateIds.has(id));

        for (const templateId of toInstall) {
          await fetch(`/api/templates/${templateId}/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        }

        // Derive confidence for downstream steps
        const confidence = evidenceConfig
          ? deriveEvidenceConfidence(evidenceConfig)
          : "medium";

        // Save step
        const allSelectedIds = [...selectedSlugs]
          .map((slug) => TEMPLATE_IDS[slug as keyof typeof TEMPLATE_IDS])
          .filter(Boolean);

        const families = [
          ...new Set(
            recommendations
              .filter((r) => selectedSlugs.has(r.slug))
              .map((r) => r.disputeFamily)
          ),
        ];

        const res = await fetch("/api/setup/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stepId: "coverage",
            payload: {
              installedTemplateIds: allSelectedIds,
              selectedFamilies: families,
              evidenceConfidence: confidence,
            },
          }),
        });
        return res.ok;
      } finally {
        setSaving(false);
      }
    };
  }, [onSaveRef, selectedSlugs, installedTemplateIds, evidenceConfig, recommendations]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Spinner size="small" />
      </div>
    );
  }

  // Group recommendations by family
  const families = new Map<string, TemplateRecommendation[]>();
  for (const rec of recommendations) {
    const group = families.get(rec.disputeFamily) ?? [];
    group.push(rec);
    families.set(rec.disputeFamily, group);
  }

  const getTemplateName = (slug: string) => {
    const id = TEMPLATE_IDS[slug as keyof typeof TEMPLATE_IDS];
    return templateCatalog.find((t) => t.id === id)?.name ?? slug.replace(/_/g, " ");
  };

  const getTemplateDesc = (slug: string) => {
    const id = TEMPLATE_IDS[slug as keyof typeof TEMPLATE_IDS];
    return templateCatalog.find((t) => t.id === id)?.short_description ?? "";
  };

  const enabledEvidenceCount = evidenceConfig
    ? EVIDENCE_GROUP_IDS.filter((g) => evidenceConfig[g] !== "off").length
    : 0;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {tCoverage("title")}
        </h2>
        <p style={{ fontSize: 14, color: "#6D7175", margin: 0 }}>
          {tCoverage("subtitle")}
        </p>
      </div>

      {/* Section A: Evidence summary */}
      <div style={{
        background: "#F6F6F7",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 24,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#202223", margin: 0 }}>
            {tCoverage("evidenceSummaryTitle")}
          </h3>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {evidenceConfig && EVIDENCE_GROUP_IDS.map((groupId) => {
            const val = evidenceConfig[groupId as EvidenceGroupId];
            if (val === "off") return null;
            return (
              <span
                key={groupId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  background: val === "always" ? "#D1FAE5" : val === "when_present" ? "#DBEAFE" : "#FEF3C7",
                  color: val === "always" ? "#065F46" : val === "when_present" ? "#1E40AF" : "#92400E",
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {tProfile(`evidence_${groupId}` as Parameters<typeof tProfile>[0])}
                <span style={{ opacity: 0.7 }}>
                  ({BEHAVIOR_LABELS[val] ?? val})
                </span>
              </span>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: "#8C9196", margin: 0 }}>
          {tCoverage("evidenceNote", { count: enabledEvidenceCount })}
        </p>
      </div>

      {/* Section B: Coverage selection */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[...families.entries()].map(([family, recs]) => {
          const anySelected = recs.some((r) => selectedSlugs.has(r.slug));
          const allDefault = recs.some((r) => r.isDefault);

          return (
            <div
              key={family}
              style={{
                border: `2px solid ${anySelected ? "#1D4ED8" : "#E1E3E5"}`,
                borderRadius: 10,
                padding: "16px 20px",
                background: anySelected ? "#FAFBFF" : "#fff",
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: recs.length > 1 ? 12 : 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                      {tCoverage(`family_${family}` as Parameters<typeof tCoverage>[0])}
                    </span>
                    {allDefault && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 8px",
                        background: "#DBEAFE",
                        color: "#1D4ED8",
                        borderRadius: 10,
                      }}>
                        {tCoverage("recommendedBadge")}
                      </span>
                    )}
                    {!allDefault && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 500,
                        padding: "2px 8px",
                        background: "#F3F3F3",
                        color: "#6D7175",
                        borderRadius: 10,
                      }}>
                        {tCoverage("optionalBadge")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {recs.map((rec) => {
                const isSelected = selectedSlugs.has(rec.slug);
                const isInstalled = installedTemplateIds.has(rec.templateId);

                return (
                  <label
                    key={rec.slug}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "8px 0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSlug(rec.slug)}
                      style={{ marginTop: 3, accentColor: "#1D4ED8" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                          {getTemplateName(rec.slug)}
                        </span>
                        {isInstalled && (
                          <span style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            background: "#D1FAE5",
                            color: "#065F46",
                            borderRadius: 8,
                            fontWeight: 500,
                          }}>
                            {tCoverage("installedBadge")}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: "#6D7175", margin: "2px 0 0" }}>
                        {getTemplateDesc(rec.slug)}
                      </p>
                      {rec.reason && (
                        <p style={{ fontSize: 11, color: "#8C9196", margin: "4px 0 0", fontStyle: "italic" }}>
                          {rec.reason}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>

      {selectedSlugs.size === 0 && (
        <p style={{ fontSize: 13, color: "#D72C0D", marginTop: 12 }}>
          {tCoverage("noTemplatesSelected")}
        </p>
      )}

      {saving && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <Spinner size="small" />
          <span style={{ fontSize: 13, color: "#6D7175" }}>{tCoverage("installingSaving")}</span>
        </div>
      )}

      <p style={{ fontSize: 12, color: "#8C9196", marginTop: 16, marginBottom: 0 }}>
        {tCoverage("coverageSummary", { count: selectedSlugs.size, total: 10 })}
      </p>
    </div>
  );
}
