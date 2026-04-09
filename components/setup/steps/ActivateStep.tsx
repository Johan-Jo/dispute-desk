"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

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

export function ActivateStep({ onSaveRef }: ActivateStepProps) {
  const t = useTranslations("setup.activate");

  const [loading, setLoading] = useState(true);
  const [activePacks, setActivePacks] = useState<PackInfo[]>([]);
  const [packModes, setPackModes] = useState<Record<string, string>>({});
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [familyCount, setFamilyCount] = useState(0);

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
          const enabled = Object.values(ec).filter((v) => v !== "off").length;
          setEvidenceCount(enabled);
        }

        // Families from coverage step
        const families = state?.steps?.coverage?.payload?.selectedFamilies ?? [];
        setFamilyCount(families.length);

        // Packs + modes
        setActivePacks(automation.activePacks ?? []);
        setPackModes(automation.pack_modes ?? {});
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
      // Activate all DRAFT packs
      const draftPacks = activePacks.filter((p) => p.status === "DRAFT");
      for (const pack of draftPacks) {
        await fetch(`/api/packs/${pack.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ACTIVE" }),
        });
      }

      // Mark step done
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

  const autoCount = Object.values(packModes).filter((m) => m === "auto").length;
  const manualCount = activePacks.length - autoCount;

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

      {/* Summary sections */}
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
              {t("coverageSummary", { templates: activePacks.length, families: familyCount })}
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
              {activePacks.map((p) => p.name).join(", ") || "—"}
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
              {t("automationSummary", { auto: autoCount, manual: manualCount })}
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
