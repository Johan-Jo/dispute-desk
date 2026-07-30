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

function isValidEmail(value: string): boolean {
  // Pragmatic check — matches what users will reasonably enter without
  // false-rejecting plus-tags or sub-domains. Server-side use will be
  // through Resend's own validation anyway.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ActivateStep({ onSaveRef }: ActivateStepProps) {
  const t = useTranslations("setup.activate");

  const [loading, setLoading] = useState(true);
  const [activePacks, setActivePacks] = useState<PackInfo[]>([]);
  const [storeMode, setStoreMode] = useState<"auto" | "review">("auto");
  const [safeguardEnabled, setSafeguardEnabled] = useState(true);
  const [reviewThreshold, setReviewThreshold] = useState("500");
  const [teamEmail, setTeamEmail] = useState("");
  const [teamEmailSource, setTeamEmailSource] = useState<"shopify" | "saved" | "edited">("shopify");
  const [teamEmailTouched, setTeamEmailTouched] = useState(false);
  const [shopId, setShopId] = useState<string | null>(null);

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

        if (state?.shopId) setShopId(state.shopId);

        // Handling mode + threshold come from the STORE CONFIG (the rules
        // rows), not from wizard payloads. That is the source of truth the
        // engine actually reads, so this summary can never disagree with what
        // will happen. Previously both were derived from per-family payloads
        // that no longer exist.
        const storeRes = await fetch("/api/automation/store");
        if (!cancelled && storeRes.ok) {
          const cfg = await storeRes.json();
          setStoreMode(cfg?.mode === "auto" ? "auto" : "review");
          setSafeguardEnabled(Boolean(cfg?.safeguard?.enabled));
          if (cfg?.safeguard?.amount) setReviewThreshold(String(cfg.safeguard.amount));
        }

        // Packs for activation
        const packs = (automation.activePacks ?? []) as PackInfo[];
        setActivePacks(packs);

        // Team email — prefer the value the merchant has already saved
        // (re-entry into the step), otherwise fall back to the Shopify
        // shop contact email so they can confirm with one click.
        const savedTeamEmail = (
          state?.steps?.team?.payload as { teamEmail?: string } | undefined
        )?.teamEmail;
        if (savedTeamEmail) {
          if (!cancelled) {
            setTeamEmail(savedTeamEmail);
            setTeamEmailSource("saved");
          }
        } else if (state?.shopId) {
          try {
            const detailsRes = await fetch(
              `/api/shop/details?shop_id=${state.shopId}`,
            );
            if (!cancelled && detailsRes.ok) {
              const details = (await detailsRes.json()) as { email?: string };
              if (details.email) {
                setTeamEmail(details.email);
                setTeamEmailSource("shopify");
              }
            }
          } catch {
            /* non-fatal — merchant can type manually */
          }
        }
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
      // Refuse to activate without a valid alert email — block advance
      // and surface the inline error by marking the field as touched.
      if (!isValidEmail(teamEmail)) {
        setTeamEmailTouched(true);
        return false;
      }

      // Persist the team email + notification defaults via the canonical
      // preferences route. The wizard's "team" bucket was removed from
      // StepId when the wizard collapsed to 6 steps, so /api/setup/step
      // now rejects stepId:"team" with 400. /api/shop/preferences writes
      // into shop_setup.steps.team.payload — the same shape email helpers
      // and the high-value alert pipeline already read from.
      if (!shopId) return false;
      const teamRes = await fetch("/api/shop/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_id: shopId,
          teamEmail: teamEmail.trim(),
          notifications: {
            newDispute: true,
            beforeDue: true,
            evidenceReady: true,
          },
        }),
      });
      if (!teamRes.ok) return false;

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
  }, [onSaveRef, activePacks, teamEmail, shopId]);

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

      {/* Stats grid — mode / playbooks / threshold. Reads the store config
          (the rules rows the engine actually evaluates), so this summary can
          never disagree with what will really happen. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {/* Handling mode — blue filled, the headline decision */}
        <div style={{
          background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
          borderRadius: 12,
          padding: "24px 24px 20px",
          color: "#fff",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 1L5 11h4v8l6-10h-4V1z" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("statModeLabel")}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
            {storeMode === "auto" ? t("statModeAuto") : t("statModeReview")}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{t("statModeDesc")}</div>
        </div>

        {/* Playbooks installed — green outline */}
        <div style={{
          background: "#fff",
          border: "2px solid #22C55E",
          borderRadius: 12,
          padding: "24px 24px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="#1D4ED8">
              <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3z" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{t("statPlaybooksLabel")}</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#22C55E", lineHeight: 1 }}>{activePacks.length}</div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 6 }}>{t("statPlaybooksDesc")}</div>
        </div>

        {/* High-value threshold — neutral; reads "Off" when disabled */}
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
          <div style={{ fontSize: 36, fontWeight: 700, color: "#202223", lineHeight: 1 }}>
            {safeguardEnabled ? `$${reviewThreshold}` : t("statThresholdOff")}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 6 }}>{t("statThresholdDesc")}</div>
        </div>
      </div>

      {/* Team email confirmation */}
      <div style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        padding: "24px 28px",
        marginBottom: 24,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" strokeWidth="1.8" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M4 6h16v12H4z" />
            <path d="m4 6 8 7 8-7" />
          </svg>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#202223", margin: 0 }}>
              {t("teamEmailTitle")}
            </h3>
            <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0", lineHeight: 1.5 }}>
              {t("teamEmailDesc")}
            </p>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <label htmlFor="dd-team-email" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#202223", marginBottom: 6 }}>
            {t("teamEmailLabel")}
          </label>
          <input
            id="dd-team-email"
            type="email"
            value={teamEmail}
            onChange={(e) => {
              setTeamEmail(e.target.value);
              setTeamEmailSource("edited");
            }}
            onBlur={() => setTeamEmailTouched(true)}
            placeholder="you@example.com"
            autoComplete="email"
            style={{
              width: "100%",
              padding: "10px 14px",
              border: `2px solid ${teamEmailTouched && !isValidEmail(teamEmail) ? "#DC2626" : "#E1E3E5"}`,
              borderRadius: 8,
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {teamEmailTouched && !isValidEmail(teamEmail) ? (
            <p style={{ fontSize: 12, color: "#DC2626", margin: "6px 0 0" }}>
              {t("teamEmailInvalid")}
            </p>
          ) : teamEmailSource === "shopify" && teamEmail ? (
            <p style={{ fontSize: 12, color: "#6D7175", margin: "6px 0 0", fontStyle: "italic" }}>
              {t("teamEmailFromShopify")}
            </p>
          ) : null}
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
