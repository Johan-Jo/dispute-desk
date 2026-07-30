"use client";

/**
 * Wizard step: "How should we handle disputes?"
 *
 * Merges the former Coverage + Automation steps (2026-07-27). The naming was
 * inverted: the step called "Automation" held only a high-value toggle, while
 * the real auto/review choice sat in a per-family dropdown table on the
 * "Coverage" step. Merchants had to configure seven rows to express one
 * intention — and the per-type choice only ever governed the clean-Strong
 * slice anyway (see docs/technical.md § Store-wide automation mode).
 *
 * Now: one store-wide switch + the amount safeguard, with the always-reviewed
 * facts stated plainly so nobody expects auto-pilot to submit everything.
 *
 * Playbook install is no longer a merchant decision — it is derived silently
 * from the store profile on save, exactly as the Coverage step's default path
 * did, minus the "advanced" disclosure.
 */

import { useEffect, useState, useCallback } from "react";
import { Spinner } from "@shopify/polaris";
import { useTranslations, useLocale } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { StoreModeSelector } from "@/components/automation/StoreModeSelector";
import { ALWAYS_REVIEWED_KEYS } from "@/components/automation/AlwaysReviewedFacts";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  getDefaultEvidenceConfig,
  inquiryPairsFor,
  type StoreProfileForRecommendation,
  type StoreType,
} from "@/lib/setup/recommendTemplates";
import {
  DEFAULT_SAFEGUARD_AMOUNT,
  type StoreAutomationMode,
} from "@/lib/rules/storeAutomation";
import { findGroup, type GroupOverrides } from "@/lib/rules/automationGroups";

interface HandlingStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
  onCanContinueChange?: (canContinue: boolean) => void;
}

/**
 * The design's responsive rules, keyed on its own `data-r` hooks. Same pattern
 * as the Automation page transcription (app/(embedded)/app/rules/page.tsx:95).
 *
 * The design's breakpoint is 760px — wider than the rules page's 700px because
 * this step's mode cards carry a footnote line each, so they crowd sooner.
 * Stepper/footer rules from the design are omitted: both are owned by
 * SetupWizardShell and shared by all five steps.
 */
const RESPONSIVE_CSS = `
@media (max-width: 760px) {
  [data-r="modes"] { grid-template-columns: 1fr !important; }
  [data-r="always"] { grid-template-columns: 1fr !important; }
  [data-r="always"] > span { padding: 11px 14px !important; }
  [data-r="sgrow"] { align-items: flex-start !important; }
  [data-r="amount"] { padding-left: 2px !important; }
}
`;

/** The design's one check mark, at three sizes. Stroked, never a glyph font. */
function CheckGlyph({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function HandlingStep({ onSaveRef, onCanContinueChange }: HandlingStepProps) {
  const t = useTranslations("setup.handling");
  const tr = useTranslations("rules");
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<StoreAutomationMode>("auto");
  const [safeguardEnabled, setSafeguardEnabled] = useState(true);
  const [safeguardAmount, setSafeguardAmount] = useState(
    String(DEFAULT_SAFEGUARD_AMOUNT),
  );
  /**
   * Per-group overrides are NOT editable here — a six-row table on a first-run
   * screen would undo the merge to one step. But they must be carried through
   * the save: `PUT /api/automation/store` treats an omitted `groups` as "keep
   * what's stored", and a returning merchant re-running the wizard would
   * otherwise depend on that. Echoing them back states the intent explicitly.
   */
  const [groups, setGroups] = useState<GroupOverrides>({});

  // Derived from the store profile — shown read-only as reassurance, and used
  // by the save handler to install the right playbooks.
  const [defaultTemplateIds, setDefaultTemplateIds] = useState<string[]>([]);
  const [installedTemplateIds, setInstalledTemplateIds] = useState<Set<string>>(
    new Set(),
  );
  const [evidenceConfidence, setEvidenceConfidence] = useState<
    "high" | "medium" | "low"
  >("medium");
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [storeRes, stateRes, automationRes] = await Promise.all([
          fetch("/api/automation/store"),
          fetch("/api/setup/state"),
          fetch("/api/setup/automation"),
        ]);
        if (cancelled) return;

        // Pre-select from the CURRENT stored config. A brand-new shop was
        // seeded auto-pilot + $500 at install, so the merchant sees the
        // recommended default already chosen rather than a blank form.
        if (storeRes.ok) {
          const cfg = await storeRes.json();
          if (cfg?.mode === "auto" || cfg?.mode === "review") setMode(cfg.mode);
          if (typeof cfg?.safeguard?.enabled === "boolean") {
            setSafeguardEnabled(cfg.safeguard.enabled);
          }
          if (cfg?.safeguard?.amount) {
            setSafeguardAmount(String(cfg.safeguard.amount));
          }
          if (cfg?.groups && typeof cfg.groups === "object") {
            setGroups(cfg.groups as GroupOverrides);
          }
        }

        if (automationRes.ok) {
          const data = await automationRes.json();
          setInstalledTemplateIds(new Set(data.installedTemplateIds ?? []));
        }

        // Derive the playbook set from the store profile the merchant just
        // filled in on the previous step.
        const state = stateRes.ok ? await stateRes.json() : null;
        const profilePayload = state?.steps?.store_profile?.payload;
        const storeTypes = (profilePayload?.storeTypes ?? ["physical"]) as StoreType[];
        const evidenceConfig =
          profilePayload?.shopifyEvidenceConfig ?? getDefaultEvidenceConfig(storeTypes);
        const profile: StoreProfileForRecommendation = {
          storeTypes,
          digitalProof: profilePayload?.digitalProof ?? "yes",
          shopifyEvidenceConfig: evidenceConfig,
        };
        const defaults = recommendTemplates(profile).filter((r) => r.isDefault);
        setDefaultTemplateIds(defaults.map((r) => r.templateId));
        setSelectedFamilies([...new Set(defaults.map((r) => r.disputeFamily))]);
        setEvidenceConfidence(deriveEvidenceConfidence(evidenceConfig));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // The step is always completable — a mode is always selected.
  useEffect(() => {
    onCanContinueChange?.(true);
  }, [onCanContinueChange]);

  const parsedAmount = Number.parseInt(safeguardAmount, 10);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      // 1) Install the derived playbooks + their silent inquiry siblings.
      //    Non-interactive: the merchant never picks these.
      const inquiryIds = inquiryPairsFor(defaultTemplateIds);
      const toInstall = [...defaultTemplateIds, ...inquiryIds].filter(
        (id) => !installedTemplateIds.has(id),
      );
      for (const templateId of toInstall) {
        await fetch(`/api/templates/${templateId}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }

      // 2) Persist the store-wide handling choice. The x-dd-setup header
      //    exempts this write from the rules plan gate — a free-plan merchant
      //    must be able to choose their mode during onboarding.
      const effectiveSafeguard = safeguardEnabled && amountValid;
      const storeRes = await fetch("/api/automation/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-dd-setup": "1" },
        body: JSON.stringify({
          mode,
          safeguard: {
            enabled: effectiveSafeguard,
            amount: effectiveSafeguard ? parsedAmount : 0,
          },
          // Echoed back unchanged — this step doesn't render group controls.
          groups,
        }),
      });
      if (!storeRes.ok) return false;

      // 3) Record the step. Payload is telemetry/audit only — the rules rows
      //    are the source of truth for the mode and the threshold.
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "handling",
          payload: {
            mode,
            safeguardEnabled: effectiveSafeguard,
            safeguardAmount: effectiveSafeguard ? parsedAmount : null,
            installedTemplateIds: defaultTemplateIds,
            selectedFamilies,
            evidenceConfidence,
          },
        }),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    defaultTemplateIds,
    installedTemplateIds,
    mode,
    safeguardEnabled,
    amountValid,
    parsedAmount,
    selectedFamilies,
    evidenceConfidence,
    groups,
  ]);

  useEffect(() => {
    onSaveRef.current = handleSave;
  }, [onSaveRef, handleSave]);

  if (loading) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <Spinner size="large" />
      </div>
    );
  }

  /**
   * The summary lines, derived from state already in this component — no extra
   * fetches.
   *
   * It used to read "{n} playbooks matched to what your store sells". That
   * number meant nothing to a merchant AND it disagreed with the very next
   * screen, which counts the installed packs (~8, because the wizard silently
   * installs the inquiry siblings too). Naming the dispute types is the thing
   * the merchant can actually check against their own store.
   *
   * `digital` / `general` have no group of their own by design — they follow
   * the store default, exactly as `rules.groupsGeneralNote` says on the
   * Automation page — so they are not listed.
   */
  const familyNames = selectedFamilies
    .map((family) => findGroup(family))
    .filter((group): group is NonNullable<typeof group> => Boolean(group))
    .map((group) => tr(group.labelKey));
  const familyList = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(familyNames);

  // "submitted" is accurate ONLY with its destination named. Unqualified it
  // reads as "filed with the card network", which DisputeDesk does not do —
  // the merchant submits from Shopify Admin. See CLAUDE.md.
  const summaryLines = [
    familyNames.length > 0 ? t("setupSummaryReady", { families: familyList }) : null,
    mode === "auto" ? t("setupSummaryModeAuto") : t("setupSummaryModeReview"),
    t("setupSummaryInquiry"),
    safeguardEnabled && amountValid
      ? t("setupSummarySafeguard", { amount: parsedAmount })
      : null,
    t("setupSummaryPointer"),
  ].filter((line): line is string => Boolean(line));

  const cardStyle: React.CSSProperties = {
    background: "#FFFFFF",
    border: "1px solid #E1E3E5",
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
    padding: "18px 20px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{RESPONSIVE_CSS}</style>

      {/* ── Header: bolt chip + title ──────────────────────────────── */}
      <div
        style={{ display: "flex", gap: 13, alignItems: "flex-start", padding: "6px 4px 0" }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            flexShrink: 0,
            background: "#1D4ED8",
            color: "#FFFFFF",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 3px 10px rgba(29,78,216,0.22)",
          }}
        >
          <svg width="21" height="21" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M11 1L5 11h4v8l6-10h-4V1z" />
          </svg>
        </span>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 1 }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 23,
              lineHeight: 1.2,
              fontWeight: 700,
              letterSpacing: "-0.018em",
            }}
          >
            {t("title")}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#6D7175", textWrap: "pretty" }}>
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* ── The switch ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <StoreModeSelector value={mode} onChange={setMode} t={tr} disabled={saving} />
      </div>

      {/* ── What we've set up for you ──────────────────────────────────
          Sits ABOVE Safeguards per the design: the merchant reads what the
          choice just did before being offered extra brakes on it. */}
      <div
        style={{
          background: "#F5FAFF",
          border: "1px solid #C9E1FB",
          borderRadius: 14,
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "#1D4ED8",
              color: "#FFFFFF",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CheckGlyph size={15} strokeWidth={2.2} />
          </span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {t("setupSummaryTitle")}
          </h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {summaryLines.map((line) => (
            <div key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0, marginTop: 2, color: "#22C55E" }}>
                <CheckGlyph size={15} strokeWidth={2.6} />
              </span>
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#3B4149",
                  textWrap: "pretty",
                }}
              >
                {line}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Safeguards ─────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {t("safeguardTitle")}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>
            {t("safeguardSubtitle")}
          </p>
        </div>

        {/* Always-held facts. Keys come from ALWAYS_REVIEWED_KEYS so this and
            /app/rules can never describe the engine differently — only the
            presentation differs, which is what the design changes. */}
        <div
          style={{
            border: "1px solid #C9E1FB",
            borderRadius: 12,
            background: "#FFFFFF",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: "#F0F7FF",
              borderBottom: "1px solid #DCE9FA",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "#1D4ED8",
                color: "#FFFFFF",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#202223" }}>
                {t("alwaysHeldTitle")}
              </span>
              <span style={{ fontSize: 12.5, color: "#4A5568" }}>
                {t("alwaysHeldSubtitle")}
              </span>
            </span>
          </div>
          <div
            data-r="always"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            {ALWAYS_REVIEWED_KEYS.map((key) => (
              <span
                key={key}
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  fontWeight: 500,
                  color: "#202223",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "12px 16px",
                  borderTop: "1px solid #F1F2F3",
                  textWrap: "pretty",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: "#EEF2FF",
                    color: "#1D4ED8",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  <CheckGlyph size={11} strokeWidth={3.2} />
                </span>
                {tr(key)}
              </span>
            ))}
          </div>
        </div>

        {/* High-value safeguard — a switch, not a checkbox, per the design. */}
        <label
          data-r="sgrow"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            cursor: saving ? "not-allowed" : "pointer",
            borderRadius: 12,
            padding: "14px 16px",
            transition: "background 140ms ease, border-color 140ms ease",
            border: `1px solid ${safeguardEnabled ? "#C9E1FB" : "#E9EBED"}`,
            background: safeguardEnabled ? "#F5FAFF" : "#FFFFFF",
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 140ms ease",
              background: safeguardEnabled ? "#1D4ED8" : "#F1F2F3",
              color: safeguardEnabled ? "#FFFFFF" : "#6D7175",
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("safeguardToggle")}</span>
            <span style={{ fontSize: 12.5, color: "#6D7175", textWrap: "pretty" }}>
              {t("safeguardHint")}
            </span>
          </span>
          <span
            style={{
              position: "relative",
              width: 44,
              height: 24,
              borderRadius: 12,
              flexShrink: 0,
              transition: "background 200ms ease",
              background: safeguardEnabled ? "#1D4ED8" : "#E1E3E5",
            }}
          >
            <input
              type="checkbox"
              role="switch"
              checked={safeguardEnabled}
              disabled={saving}
              onChange={(e) => setSafeguardEnabled(e.target.checked)}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                margin: 0,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            />
            <span
              style={{
                position: "absolute",
                top: 2,
                left: safeguardEnabled ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#FFFFFF",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                transition: "left 200ms ease",
                pointerEvents: "none",
              }}
            />
          </span>
        </label>

        {safeguardEnabled && (
          <div
            data-r="amount"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "0 2px 0 62px",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#3B4149" }}>
              {t("thresholdLabel")}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                border: `1px solid ${amountValid ? "#C9CCCF" : "#D72C0D"}`,
                borderRadius: 8,
                background: "#FFFFFF",
                overflow: "hidden",
                boxShadow: "0 1px 0 rgba(16,24,40,0.04)",
              }}
            >
              <span style={{ padding: "7px 2px 7px 10px", fontSize: 13, color: "#6D7175" }}>
                $
              </span>
              <input
                type="number"
                min="0"
                value={safeguardAmount}
                disabled={saving}
                aria-label={t("thresholdLabel")}
                aria-invalid={!amountValid}
                onChange={(e) => setSafeguardAmount(e.target.value)}
                style={{
                  font: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#202223",
                  border: "none",
                  outline: "none",
                  padding: "7px 10px 7px 4px",
                  width: 88,
                  background: "transparent",
                }}
              />
            </span>
            {!amountValid && (
              <span style={{ fontSize: 12.5, color: "#D72C0D" }}>
                {t("thresholdInvalid")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
