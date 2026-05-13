"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  getDefaultEvidenceConfig,
  type StoreProfileForRecommendation,
  type StoreType,
  type ProofLevel,
} from "@/lib/setup/recommendTemplates";

interface AutomationStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "#1D4ED8" : "#E1E3E5",
        border: "none",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

export function AutomationStep({ onSaveRef }: AutomationStepProps) {
  const t = useTranslations("setup.automation");

  const [loading, setLoading] = useState(true);
  const [highValueEnabled, setHighValueEnabled] = useState(true);
  const [reviewThreshold, setReviewThreshold] = useState("500");
  const [automatedCount, setAutomatedCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/setup/state");
        if (cancelled) return;
        const state = res.ok ? await res.json() : null;

        // Threshold lives on the automation step. Fall back to a legacy
        // store_profile value for stores onboarded before the wizard split.
        const automationThreshold = state?.steps?.automation?.payload?.reviewThreshold;
        const legacyThreshold = state?.steps?.store_profile?.payload?.reviewThreshold;
        const threshold = automationThreshold ?? legacyThreshold;
        if (threshold) setReviewThreshold(String(threshold));

        // Re-entry: respect the merchant's previous toggle choice if set.
        const savedEnabled = state?.steps?.automation?.payload?.highValueReviewEnabled;
        if (typeof savedEnabled === "boolean") setHighValueEnabled(savedEnabled);

        // Sidebar counts are derived from Coverage step decisions — what
        // dispute families they routed to auto vs review.
        const coverageSettings = state?.steps?.coverage?.payload?.coverageSettings as
          | Record<string, string>
          | undefined;

        const toCanonical = (v: string): "auto" | "review" =>
          v === "auto" || v === "automated" || v === "auto_pack" ? "auto" : "review";

        let automationValues: Array<"auto" | "review">;
        if (coverageSettings && Object.keys(coverageSettings).length > 0) {
          automationValues = Object.values(coverageSettings).map(toCanonical);
        } else {
          const profilePayload = state?.steps?.store_profile?.payload;
          const storeTypes = (profilePayload?.storeTypes ?? ["physical"]) as StoreType[];
          const deliveryProof = (profilePayload?.deliveryProof ?? "always") as ProofLevel;
          const ec = profilePayload?.shopifyEvidenceConfig ??
            getDefaultEvidenceConfig(storeTypes, deliveryProof);
          const profile: StoreProfileForRecommendation = {
            storeTypes,
            deliveryProof,
            digitalProof: profilePayload?.digitalProof ?? "yes",
            shopifyEvidenceConfig: ec,
          };
          const confidence = deriveEvidenceConfidence(ec);
          const recs = recommendTemplates(profile).filter((r) => r.isDefault);
          const familySet = new Set(recs.map((r) => r.disputeFamily));
          automationValues = [...familySet].map((family): "auto" | "review" => {
            if (family === "general") return "review";
            if (confidence === "high") return "auto";
            if (confidence === "medium") {
              if (family === "not_as_described" || family === "refund") return "review";
              return "auto";
            }
            return "review";
          });
        }
        setAutomatedCount(automationValues.filter((v) => v === "auto").length);
        setReviewCount(automationValues.filter((v) => v === "review").length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "automation",
          payload: {
            highValueReviewEnabled: highValueEnabled,
            reviewThreshold,
          },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, highValueEnabled, reviewThreshold]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Spinner size="small" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {t("title")}
        </h2>
        <p style={{ fontSize: 15, color: "#6D7175", margin: 0 }}>
          {t("subtitle")}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #E1E3E5",
              borderRadius: 10,
              padding: "20px 24px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 4 }}>
                  {t("ruleHighValue", { threshold: reviewThreshold })}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175", lineHeight: 1.5 }}>
                  {t("ruleHighValueDesc")}
                </div>
                {highValueEnabled && (
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ fontSize: 12, color: "#6D7175" }}>
                      {t("thresholdLabel")}
                    </label>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#6D7175" }}>$</span>
                      <input
                        type="number"
                        min={0}
                        value={reviewThreshold}
                        onChange={(e) => setReviewThreshold(e.target.value)}
                        style={{
                          width: 120,
                          padding: "6px 10px 6px 22px",
                          border: "1px solid #C9CCCF",
                          borderRadius: 6,
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <ToggleSwitch
                checked={highValueEnabled}
                onChange={setHighValueEnabled}
              />
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#8C9196", margin: "4px 4px 0", lineHeight: 1.5 }}>
            {t("familyRoutingHint")}
          </p>
        </div>

        <div>
          <div style={{
            background: "#fff",
            border: "1px solid #E1E3E5",
            borderRadius: 10,
            padding: 24,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            position: "sticky" as const,
            top: 32,
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 16 }}>
              {t("sidebarTitle")}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 0",
                borderBottom: "1px solid #E1E3E5",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="#1D4ED8">
                    <path d="M11 1L5 11h4v8l6-10h-4V1z" />
                  </svg>
                  <span style={{ fontSize: 13, color: "#6D7175" }}>{t("sidebarAutomated")}</span>
                </div>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1D4ED8" }}>{automatedCount}</span>
              </div>

              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 0",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="#F59E0B">
                    <circle cx="10" cy="10" r="8" fill="none" stroke="#F59E0B" strokeWidth="2" />
                    <path d="M10 6v5M10 13v1" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 13, color: "#6D7175" }}>{t("sidebarReview")}</span>
                </div>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#F59E0B" }}>{reviewCount}</span>
              </div>
            </div>

            <div style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #E1E3E5",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="#22C55E" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3z" />
              </svg>
              <p style={{ fontSize: 12, color: "#6D7175", margin: 0, lineHeight: 1.5 }}>
                {t("sidebarNote")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
