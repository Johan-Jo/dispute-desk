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

interface ActivateStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
}

interface PackInfo {
  id: string;
  name: string;
  status: string;
  dispute_type: string;
}

function deriveFamilyAutomation(
  family: string,
  confidence: "high" | "medium" | "low"
): "auto" | "review" {
  if (family === "general") return "review";
  if (confidence === "high") return "auto";
  if (confidence === "medium") {
    if (family === "not_as_described" || family === "refund") return "review";
    return "auto";
  }
  return "review";
}

/**
 * Coverage settings may still contain legacy values ("automated", "notify")
 * from rows saved before the two-mode migration. Normalize here so the
 * sidebar counts always match the two merchant-facing options.
 */
function toCanonicalMode(value: string): "auto" | "review" {
  if (value === "auto" || value === "automated" || value === "auto_pack") {
    return "auto";
  }
  return "review";
}

export function ActivateStep({ onSaveRef }: ActivateStepProps) {
  const t = useTranslations("setup.activate");

  const [loading, setLoading] = useState(true);
  const [activePacks, setActivePacks] = useState<PackInfo[]>([]);
  const [familyCount, setFamilyCount] = useState(0);
  const [autoCount, setAutoCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewThreshold, setReviewThreshold] = useState("500");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stateRes, automationRes] = await Promise.all([
          fetch("/api/setup/state"),
          fetch("/api/setup/automation"),
        ]);

        if (cancelled) return;

        const state = stateRes.ok ? await stateRes.json() : null;
        const automation = automationRes.ok ? await automationRes.json() : {};

        // Review threshold from store profile
        const threshold = state?.steps?.store_profile?.payload?.reviewThreshold;
        if (threshold) setReviewThreshold(String(threshold));

        // Packs for activation
        const packs = (automation.activePacks ?? []) as PackInfo[];
        setActivePacks(packs);

        // Coverage settings from Step 3, or derive
        const coverageSettings = state?.steps?.coverage?.payload?.coverageSettings as
          | Record<string, string>
          | undefined;

        let automationValues: Array<"auto" | "review">;
        if (coverageSettings && Object.keys(coverageSettings).length > 0) {
          automationValues = Object.values(coverageSettings).map(toCanonicalMode);
          setFamilyCount(Object.keys(coverageSettings).length);
        } else {
          const profilePayload = state?.steps?.store_profile?.payload;
          const storeTypes = (profilePayload?.storeTypes ?? ["physical"]) as StoreType[];
          const deliveryProof = (profilePayload?.deliveryProof ?? "always") as ProofLevel;
          const evidenceConfig = profilePayload?.shopifyEvidenceConfig ??
            getDefaultEvidenceConfig(storeTypes, deliveryProof);
          const profile: StoreProfileForRecommendation = {
            storeTypes,
            deliveryProof,
            digitalProof: profilePayload?.digitalProof ?? "yes",
            shopifyEvidenceConfig: evidenceConfig,
          };
          const confidence = deriveEvidenceConfidence(evidenceConfig);
          const recs = recommendTemplates(profile).filter((r) => r.isDefault);
          const familySet = new Set(recs.map((r) => r.disputeFamily));
          setFamilyCount(familySet.size);
          automationValues = [...familySet].map((f) =>
            deriveFamilyAutomation(f, confidence)
          );
        }

        setAutoCount(automationValues.filter((v) => v === "auto").length);
        setReviewCount(automationValues.filter((v) => v === "review").length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Wire save
  useEffect(() => {
    onSaveRef.current = async () => {
      const draftPacks = activePacks.filter((p) => p.status === "DRAFT");
      for (const pack of draftPacks) {
        await fetch(`/api/packs/${pack.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ACTIVE" }),
        });
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "activate",
          payload: { activatedAt: new Date().toISOString() },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, activePacks]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Spinner size="small" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {t("title")}
        </h2>
        <p style={{ fontSize: 15, color: "#6D7175", margin: 0 }}>
          {t("subtitle")}
        </p>
      </div>

      {/* Stats grid — 2x2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Coverage Enabled — blue filled */}
        <div style={{
          background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
          borderRadius: 12,
          padding: "24px 24px 20px",
          color: "#fff",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3z" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("statCoverageLabel")}</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1 }}>{familyCount}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{t("statCoverageDesc")}</div>
        </div>

        {/* Automated — green outline */}
        <div style={{
          background: "#fff",
          border: "2px solid #22C55E",
          borderRadius: 12,
          padding: "24px 24px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="#1D4ED8">
              <path d="M11 1L5 11h4v8l6-10h-4V1z" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{t("statAutomatedLabel")}</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#22C55E", lineHeight: 1 }}>{autoCount}</div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 6 }}>{t("statAutomatedDesc")}</div>
        </div>

        {/* Review First — amber outline */}
        <div style={{
          background: "#fff",
          border: "2px solid #F59E0B",
          borderRadius: 12,
          padding: "24px 24px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="#F59E0B" strokeWidth="2" />
              <path d="M10 6v5M10 13v1" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{t("statReviewLabel")}</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#F59E0B", lineHeight: 1 }}>{reviewCount}</div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 6 }}>{t("statReviewDesc")}</div>
        </div>

        {/* Review Threshold — neutral */}
        <div style={{
          background: "#fff",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: "24px 24px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="#6D7175">
              <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm.75 4v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5V10.5a.75.75 0 0 1-1.5 0V9h-1.5a.75.75 0 0 1 0-1.5h1.5V6a.75.75 0 0 1 1.5 0zM6.5 12h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1 0-1.5z" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{t("statThresholdLabel")}</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#202223", lineHeight: 1 }}>${reviewThreshold}</div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 6 }}>{t("statThresholdDesc")}</div>
        </div>
      </div>

      {/* What happens next */}
      <div style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        padding: "24px 28px",
        marginBottom: 24,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#202223", margin: "0 0 20px" }}>
          {t("nextTitle")}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {(["next1", "next2", "next3"] as const).map((key) => (
            <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="#22C55E" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.7-9.3-4.2 4.2a.75.75 0 0 1-1.06 0L6.8 11.3a.75.75 0 1 1 1.06-1.06l1.1 1.1 3.7-3.7a.75.75 0 0 1 1.06 1.06z" />
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>
                  {t(`${key}Title` as Parameters<typeof t>[0])}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                  {t(`${key}Desc` as Parameters<typeof t>[0])}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ready banner */}
      <div style={{
        background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)",
        border: "2px solid #1D4ED8",
        borderRadius: 14,
        padding: "32px 24px",
        textAlign: "center",
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", marginBottom: 16,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "#202223", margin: "0 0 8px" }}>
          {t("readyTitle")}
        </h3>
        <p style={{ fontSize: 14, color: "#6D7175", margin: 0 }}>
          {t("readyDesc")}
        </p>
      </div>
    </div>
  );
}
