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
import { Spinner, Checkbox, TextField, Text, BlockStack, InlineStack } from "@shopify/polaris";
import { useTranslations, useLocale } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { StoreModeSelector } from "@/components/automation/StoreModeSelector";
import { AlwaysReviewedFacts } from "@/components/automation/AlwaysReviewedFacts";
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

interface HandlingStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
  onCanContinueChange?: (canContinue: boolean) => void;
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

      // 2) Persist the store-wide handling choice. No plan-gate exemption
      //    header is needed: the switch is core product and is not gated
      //    anywhere (see app/api/automation/store/route.ts).
      const effectiveSafeguard = safeguardEnabled && amountValid;
      const storeRes = await fetch("/api/automation/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          safeguard: {
            enabled: effectiveSafeguard,
            amount: effectiveSafeguard ? parsedAmount : 0,
          },
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

  const cardStyle: React.CSSProperties = {
    background: "#FFFFFF",
    border: "1px solid #E1E3E5",
    borderRadius: 12,
    padding: 20,
  };

  return (
    <BlockStack gap="500">
      <BlockStack gap="200">
        <Text as="h2" variant="headingLg">
          {t("title")}
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued">
          {t("subtitle")}
        </Text>
      </BlockStack>

      {/* ── The switch ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <StoreModeSelector value={mode} onChange={setMode} t={tr} disabled={saving} />
      </div>

      {/* ── Safeguards + the always-reviewed facts ─────────────────── */}
      <div style={cardStyle}>
        <BlockStack gap="400">
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              {t("safeguardTitle")}
            </Text>
            <Checkbox
              label={t("safeguardToggle")}
              checked={safeguardEnabled}
              disabled={saving}
              onChange={setSafeguardEnabled}
            />
            {safeguardEnabled && (
              <div style={{ maxWidth: 200 }}>
                <TextField
                  label={t("thresholdLabel")}
                  type="number"
                  value={safeguardAmount}
                  onChange={setSafeguardAmount}
                  disabled={saving}
                  prefix="$"
                  autoComplete="off"
                  error={!amountValid ? t("thresholdInvalid") : undefined}
                />
              </div>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              {t("safeguardHint")}
            </Text>
          </BlockStack>

          <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: 16 }}>
            <AlwaysReviewedFacts t={tr} />
          </div>
        </BlockStack>
      </div>

      {/* ── What we've set up for you ──────────────────────────────── */}
      <div style={{ ...cardStyle, background: "#F6F8FB" }}>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            {t("setupSummaryTitle")}
          </Text>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="start" wrap={false}>
              <span style={{ color: "#22C55E", flexShrink: 0 }}>✓</span>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("setupSummaryPlaybooks", { count: defaultTemplateIds.length })}
              </Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="start" wrap={false}>
              <span style={{ color: "#22C55E", flexShrink: 0 }}>✓</span>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("setupSummaryInquiry")}
              </Text>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </div>
    </BlockStack>
  );
}
