"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  getDefaultEvidenceConfig,
  EVIDENCE_GROUP_IDS,
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
): string {
  if (family === "general") return "notify";
  if (confidence === "high") return "automated";
  if (confidence === "medium") {
    if (family === "not_as_described" || family === "refund") return "review";
    return "automated";
  }
  return "review";
}

export function ActivateStep({ onSaveRef }: ActivateStepProps) {
  const t = useTranslations("setup.activate");

  const [loading, setLoading] = useState(true);
  const [activePacks, setActivePacks] = useState<PackInfo[]>([]);
  const [evidenceCount, setEvidenceCount] = useState(7);
  const [familyCount, setFamilyCount] = useState(0);
  const [uniquePackNames, setUniquePackNames] = useState<string[]>([]);
  const [autoCount, setAutoCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

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

        // Evidence count from store profile
        const ec = state?.steps?.store_profile?.payload?.shopifyEvidenceConfig;
        if (ec) {
          setEvidenceCount(
            EVIDENCE_GROUP_IDS.filter((g) => ec[g] !== "off").length
          );
        }

        // Packs (for activation)
        const packs = (automation.activePacks ?? []) as PackInfo[];
        setActivePacks(packs);

        // Deduplicate pack names for display
        const names = [...new Set(packs.map((p) => p.name))];
        setUniquePackNames(names);

        // Coverage settings from Step 3, or derive from profile
        const coverageSettings = state?.steps?.coverage?.payload?.coverageSettings as
          | Record<string, string>
          | undefined;

        let automationValues: string[];
        if (coverageSettings && Object.keys(coverageSettings).length > 0) {
          automationValues = Object.values(coverageSettings);
          setFamilyCount(Object.keys(coverageSettings).length);
        } else {
          // Derive from store profile
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

        setAutoCount(automationValues.filter((v) => v === "automated").length);
        setReviewCount(
          automationValues.filter((v) => v === "review").length +
          automationValues.filter((v) => v === "notify").length
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Wire save: activate DRAFT packs, mark step done
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
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {t("title")}
        </h2>
        <p style={{ fontSize: 14, color: "#6D7175", margin: 0 }}>
          {t("subtitle")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Evidence sources */}
        <div style={{
          background: "#fff",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "#DBEAFE",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#1D4ED8", flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4 4h12v2H4V4zm0 4h12v2H4V8zm0 4h8v2H4v-2z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
              {t("evidenceSummary", { count: evidenceCount })}
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
              {t("evidenceManualNote")}
            </div>
          </div>
        </div>

        {/* Coverage */}
        <div style={{
          background: "#fff",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "#D1FAE5",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#059669", flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
              {t("coverageSummary", { templates: uniquePackNames.length, families: familyCount })}
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2, lineHeight: 1.5 }}>
              {uniquePackNames.length > 0
                ? uniquePackNames.slice(0, 6).join(", ") + (uniquePackNames.length > 6 ? ` (+${uniquePackNames.length - 6})` : "")
                : "—"}
            </div>
          </div>
        </div>

        {/* Automation */}
        <div style={{
          background: "#fff",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "#EDE9FE",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#7C3AED", flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 1L5 11h4v8l6-10h-4V1z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
              {t("automationSummary", { auto: autoCount, manual: reviewCount })}
            </div>
          </div>
        </div>
      </div>

      {/* Activation info */}
      <div style={{
        marginTop: 24,
        padding: "16px 20px",
        background: "#EFF6FF",
        border: "1px solid #BFDBFE",
        borderRadius: 10,
      }}>
        <p style={{ fontSize: 13, color: "#1E40AF", margin: 0, lineHeight: 1.6 }}>
          {t("activateInfo")}
        </p>
      </div>

      <p style={{ fontSize: 12, color: "#8C9196", marginTop: 12, marginBottom: 0 }}>
        {t("changeLater")}
      </p>
    </div>
  );
}
