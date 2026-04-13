"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import {
  getDefaultEvidenceConfig,
  EVIDENCE_GROUP_IDS,
  type ShopifyEvidenceConfig,
  type EvidenceBehavior,
  type StoreType as RecStoreType,
  type ProofLevel as RecProofLevel,
} from "@/lib/setup/recommendTemplates";

interface StoreProfileStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
}

type StoreType = "physical" | "digital" | "services" | "subscriptions";
type ProofLevel = "always" | "sometimes" | "rarely";
type DigitalProofLevel = "yes" | "sometimes" | "no";
type HandlingStyle = "automated" | "review" | "conservative";

const STORE_TYPE_OPTIONS: { value: StoreType; labelKey: string }[] = [
  { value: "physical", labelKey: "physical" },
  { value: "digital", labelKey: "digital" },
  { value: "services", labelKey: "services" },
  { value: "subscriptions", labelKey: "subscriptions" },
];

const DELIVERY_PROOF_OPTIONS: { value: ProofLevel; labelKey: string; descKey: string }[] = [
  { value: "always", labelKey: "deliveryAlways", descKey: "deliveryAlwaysDesc" },
  { value: "sometimes", labelKey: "deliverySometimes", descKey: "deliverySometimesDesc" },
  { value: "rarely", labelKey: "deliveryRarely", descKey: "deliveryRarelyDesc" },
];

const DIGITAL_PROOF_OPTIONS: { value: DigitalProofLevel; labelKey: string }[] = [
  { value: "yes", labelKey: "digitalYes" },
  { value: "sometimes", labelKey: "digitalSometimes" },
  { value: "no", labelKey: "digitalNo" },
];

const HANDLING_OPTIONS: { value: HandlingStyle; labelKey: string; descKey: string }[] = [
  { value: "automated", labelKey: "handlingAutomated", descKey: "handlingAutomatedDesc" },
  { value: "review", labelKey: "handlingReview", descKey: "handlingReviewDesc" },
  { value: "conservative", labelKey: "handlingConservative", descKey: "handlingConservativeDesc" },
];

export function StoreProfileStep({ onSaveRef }: StoreProfileStepProps) {
  const t = useTranslations("setup.storeProfile");

  const [storeTypes, setStoreTypes] = useState<StoreType[]>(["physical"]);
  const [deliveryProof, setDeliveryProof] = useState<ProofLevel>("always");
  const [digitalProof, setDigitalProof] = useState<DigitalProofLevel>("sometimes");
  const [reviewThreshold, setReviewThreshold] = useState("500");
  const [handlingStyle, setHandlingStyle] = useState<HandlingStyle>("automated");
  const [evidenceConfig, setEvidenceConfig] = useState<ShopifyEvidenceConfig>(
    () => getDefaultEvidenceConfig(["physical"] as RecStoreType[], "always" as RecProofLevel)
  );

  const [loaded, setLoaded] = useState(false);
  const showDigitalProof = storeTypes.includes("digital") || storeTypes.includes("services");

  // Load previously saved payload on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((state) => {
        if (cancelled) return;
        const p = state?.steps?.store_profile?.payload;
        if (p) {
          if (p.storeTypes?.length) setStoreTypes(p.storeTypes);
          if (p.deliveryProof) setDeliveryProof(p.deliveryProof);
          if (p.digitalProof) setDigitalProof(p.digitalProof);
          if (p.reviewThreshold != null) setReviewThreshold(String(p.reviewThreshold));
          if (p.handlingStyle) setHandlingStyle(p.handlingStyle);
          if (p.shopifyEvidenceConfig) setEvidenceConfig(p.shopifyEvidenceConfig);
        }
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Recalculate evidence defaults when store type or delivery proof changes (only after initial load)
  useEffect(() => {
    if (!loaded) return;
    setEvidenceConfig(
      getDefaultEvidenceConfig(storeTypes as RecStoreType[], deliveryProof as RecProofLevel)
    );
  }, [storeTypes, deliveryProof, loaded]);

  const toggleStoreType = useCallback((type: StoreType) => {
    setStoreTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  // Wire up save
  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "store_profile",
          payload: { storeTypes, deliveryProof, digitalProof, reviewThreshold, handlingStyle, shopifyEvidenceConfig: evidenceConfig },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, storeTypes, deliveryProof, digitalProof, reviewThreshold, handlingStyle, evidenceConfig]);

  // Derive summary values
  const shippingCoverage =
    deliveryProof === "always" ? t("coverageStrong") :
    deliveryProof === "sometimes" ? t("coverageGood") : t("coverageBasic");
  const digitalCoverage = digitalProof === "yes" ? t("coverageEnhanced") : t("coverageStandard");
  const automationLabel =
    handlingStyle === "automated" ? t("handlingAutomated") :
    handlingStyle === "review" ? t("handlingReview") : t("handlingConservative");

  const cardStyle = (selected: boolean) => ({
    padding: "14px 16px",
    border: `2px solid ${selected ? "#1D4ED8" : "#E1E3E5"}`,
    borderRadius: 8,
    background: selected ? "#EFF6FF" : "#fff",
    cursor: "pointer" as const,
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 10,
  });

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        {/* Left Column */}
        <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* What do you sell? */}
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
              {t("whatDoYouSell")}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {STORE_TYPE_OPTIONS.map((opt) => {
                const selected = storeTypes.includes(opt.value);
                return (
                  <button key={opt.value} type="button" onClick={() => toggleStoreType(opt.value)} style={cardStyle(selected)}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: selected ? "#1D4ED8" : "#202223" }}>
                      {t(opt.labelKey as Parameters<typeof t>[0])}
                    </span>
                    {selected && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="#1D4ED8" style={{ marginLeft: "auto" }}>
                        <path d="M6.5 11.5l-3-3 1.06-1.06L6.5 9.38l4.94-4.94L12.5 5.5l-6 6z" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: "#6D7175", marginTop: 10, marginBottom: 0 }}>
              {t("sellHint")}
            </p>
          </div>

          {/* Delivery Proof */}
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
              {t("deliveryProof")}
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DELIVERY_PROOF_OPTIONS.map((opt) => {
                const selected = deliveryProof === opt.value;
                return (
                  <label key={opt.value} style={cardStyle(selected)}>
                    <input
                      type="radio"
                      name="deliveryProof"
                      value={opt.value}
                      checked={selected}
                      onChange={() => setDeliveryProof(opt.value)}
                      style={{ marginTop: 1 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                        {t(opt.labelKey as Parameters<typeof t>[0])}
                      </div>
                      <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                        {t(opt.descKey as Parameters<typeof t>[0])}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: "#6D7175", marginTop: 10, marginBottom: 0 }}>
              {t("deliveryHint")}
            </p>
          </div>

          {/* Digital/Service Proof — shown when digital or services selected */}
          {showDigitalProof && (
            <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
                {t("digitalProof")}
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                {DIGITAL_PROOF_OPTIONS.map((opt) => {
                  const selected = digitalProof === opt.value;
                  return (
                    <label key={opt.value} style={{ ...cardStyle(selected), flex: 1, justifyContent: "center" }}>
                      <input
                        type="radio"
                        name="digitalProof"
                        value={opt.value}
                        checked={selected}
                        onChange={() => setDigitalProof(opt.value)}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                        {t(opt.labelKey as Parameters<typeof t>[0])}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: "#6D7175", marginTop: 10, marginBottom: 0 }}>
                {t("digitalHint")}
              </p>
            </div>
          )}

          {/* Review Threshold */}
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
              {t("reviewThreshold")}
            </label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#6D7175" }}>$</span>
              <input
                type="number"
                value={reviewThreshold}
                onChange={(e) => setReviewThreshold(e.target.value)}
                placeholder="500"
                style={{
                  width: "100%", padding: "10px 14px 10px 28px",
                  border: "2px solid #E1E3E5", borderRadius: 8,
                  fontSize: 13, outline: "none",
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "#6D7175", marginTop: 10, marginBottom: 0 }}>
              {t("reviewThresholdHint")}
            </p>
          </div>

          {/* Handling Style */}
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
              {t("handlingStyle")}
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {HANDLING_OPTIONS.map((opt) => {
                const selected = handlingStyle === opt.value;
                return (
                  <label key={opt.value} style={cardStyle(selected)}>
                    <input
                      type="radio"
                      name="handlingStyle"
                      value={opt.value}
                      checked={selected}
                      onChange={() => setHandlingStyle(opt.value)}
                      style={{ marginTop: 1 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                        {t(opt.labelKey as Parameters<typeof t>[0])}
                      </div>
                      <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                        {t(opt.descKey as Parameters<typeof t>[0])}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Shopify Evidence Config */}
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#202223", margin: "0 0 6px" }}>
              {t("evidenceTitle")}
            </h3>
            <p style={{ fontSize: 12, color: "#6D7175", margin: "0 0 16px" }}>
              {t("evidenceSubtitle")}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {EVIDENCE_GROUP_IDS.map((groupId, i) => {
                const labelKey = `evidence_${groupId}` as Parameters<typeof t>[0];
                const descKey = `evidence_${groupId}Desc` as Parameters<typeof t>[0];
                return (
                  <div
                    key={groupId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 0",
                      borderTop: i > 0 ? "1px solid #F3F3F3" : undefined,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                        {t(labelKey)}
                      </div>
                      <div style={{ fontSize: 12, color: "#8C9196", marginTop: 1 }}>
                        {t(descKey)}
                      </div>
                    </div>
                    <select
                      value={evidenceConfig[groupId]}
                      onChange={(e) =>
                        setEvidenceConfig((prev) => ({
                          ...prev,
                          [groupId]: e.target.value as EvidenceBehavior,
                        }))
                      }
                      style={{
                        padding: "6px 28px 6px 10px",
                        border: "1px solid #C9CCCF",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "#202223",
                        background: "#fff",
                        cursor: "pointer",
                        flexShrink: 0,
                        appearance: "auto" as const,
                      }}
                    >
                      <option value="always">{t("evidenceAlways")}</option>
                      <option value="when_present">{t("evidenceWhenPresent")}</option>
                      <option value="review">{t("evidenceReview")}</option>
                      <option value="off">{t("evidenceOff")}</option>
                    </select>
                  </div>
                );
              })}
            </div>

            {/* Other evidence (manual) */}
            <div style={{ marginTop: 16, padding: "14px 16px", background: "#F6F6F7", borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6D7175", marginBottom: 8 }}>
                {t("otherEvidenceTitle")}
              </div>
              {["carrierProof", "supportConversations", "digitalAccessLogs", "customDocuments"].map((key) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                  }}
                >
                  <span style={{ fontSize: 12, color: "#6D7175" }}>
                    {t(`otherEvidence_${key}` as Parameters<typeof t>[0])}
                  </span>
                  <span style={{ fontSize: 11, color: "#8C9196", fontStyle: "italic" }}>
                    {t("manualUploadOnly")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column — Summary Card */}
        <div style={{ gridColumn: "span 1" }}>
          <div style={{
            background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
            borderRadius: 12, padding: 20, color: "#fff",
            position: "sticky" as const, top: 32,
            boxShadow: "0 4px 12px rgba(29,78,216,0.25)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3z" />
              </svg>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("summaryTitle")}</h3>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>{t("summaryStoreType")}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {storeTypes.length === 0 ? "—" : storeTypes.map((tt) => t(tt as Parameters<typeof t>[0])).join(", ")}
                </div>
              </div>

              {storeTypes.includes("physical") && (
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>{t("summaryShipping")}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{shippingCoverage}</div>
                </div>
              )}

              {showDigitalProof && (
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>{t("summaryDigital")}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{digitalCoverage}</div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>{t("summaryAutomation")}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{automationLabel}</div>
              </div>

              <div>
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>{t("summaryThreshold")}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>${reviewThreshold || "—"}</div>
              </div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                {t("summaryFooter")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
