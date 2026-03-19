"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BlockStack, Text, Banner } from "@shopify/polaris";
import { useLocale, useTranslations } from "next-intl";
import { RULE_PRESETS } from "@/lib/rules/presets";
import type { StepId, SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";

const DEFAULT_SELECTED = new Set(["preset-fraud-auto", "preset-pnr-auto"]);

const REASON_KEY_MAP: Record<string, "reasonFraudulent" | "reasonProductNotReceived"> = {
  FRAUDULENT: "reasonFraudulent",
  PRODUCT_NOT_RECEIVED: "reasonProductNotReceived",
};

interface AutomationRulesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

export function AutomationRulesStep({ stepId, onSaveRef }: AutomationRulesStepProps) {
  const t = useTranslations("setup.rules");
  const tRules = useTranslations("rules");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
  const [installedTemplateLabels, setInstalledTemplateLabels] = useState<string[]>([]);

  const packsHref = useMemo(
    () => withShopParams("/app/packs", searchParams),
    [searchParams]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stateRes = await fetch("/api/setup/state");
        if (!stateRes.ok || cancelled) return;
        const data = (await stateRes.json()) as SetupStateResponse;
        const raw = data.steps?.packs?.payload?.installedTemplates;
        const ids = Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === "string")
          : [];
        if (ids.length === 0 || cancelled) return;

        const tplRes = await fetch(`/api/templates?locale=${encodeURIComponent(locale)}`);
        if (!tplRes.ok || cancelled) return;
        const body = (await tplRes.json()) as {
          templates?: Array<{ id: string; name: string }>;
        };
        const byId = new Map((body.templates ?? []).map((x) => [x.id, x.name]));
        const labels = ids.map((id) => byId.get(id) ?? id);
        if (!cancelled) setInstalledTemplateLabels(labels);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function matchSummary(preset: (typeof RULE_PRESETS)[number]): string {
    const parts: string[] = [];
    if (preset.match.reason?.length) {
      const labels = preset.match.reason.map((r) => {
        const key = REASON_KEY_MAP[r];
        return key ? tRules(key) : r;
      });
      parts.push(labels.join(", "));
    }
    if (preset.match.amount_range?.min !== undefined) {
      parts.push(`≥ $${preset.match.amount_range.min}`);
    }
    if (parts.length === 0) return tRules("matchesAll");
    return parts.join(" · ");
  }

  useEffect(() => {
    onSaveRef.current = async () => {
      const shopId = getShopId();
      const selectedIds = Array.from(selected);

      if (selectedIds.length > 0) {
        const ruleRes = await fetch("/api/rules/install-preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shopId, preset_ids: selectedIds }),
        });
        if (!ruleRes.ok) return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: { installedPresets: Array.from(selected) } }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, selected]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        {t("title")}
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("subtitle")}
      </Text>

      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {t("packsRelationTitle")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("packsRelationBody")}
          </Text>
          <Text as="p" variant="bodySm">
            <a
              href={packsHref}
              style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}
            >
              {t("packsLinkLabel")}
            </a>
          </Text>
        </BlockStack>
      </Banner>

      {installedTemplateLabels.length > 0 && (
        <Text as="p" variant="bodySm" tone="subdued">
          {t("installedTemplatesSummary", { list: installedTemplateLabels.join(", ") })}
        </Text>
      )}

      <BlockStack gap="300">
        {RULE_PRESETS.map((preset) => {
          const isChecked = selected.has(preset.id);
          const isAutoPack = preset.action.mode === "auto_pack";
          const badgeLabel = isAutoPack ? t("badgeAutoPack") : t("badgeReview");

          return (
            <div
              key={preset.id}
              role="checkbox"
              aria-checked={isChecked}
              tabIndex={0}
              onClick={() => toggle(preset.id)}
              onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") toggle(preset.id); }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 8,
                border: isChecked ? "2px solid #2C6ECB" : "1px solid #C9CCCF",
                background: isChecked ? "#F2F7FE" : "#FFFFFF",
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
                userSelect: "none",
              }}
            >
              {/* Checkbox */}
              <div style={{ marginTop: 2, flexShrink: 0 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: isChecked ? "none" : "2px solid #8C9196",
                    background: isChecked ? "#2C6ECB" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isChecked && (
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: "20px" }}>
                    {tRules(preset.nameKey)}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: "16px",
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: isAutoPack ? "#EAF4FE" : "#FFF4E5",
                      color: isAutoPack ? "#0066CC" : "#B54708",
                    }}
                  >
                    {badgeLabel}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
                  {tRules(preset.descriptionKey)}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8C9196", lineHeight: "16px" }}>
                  {matchSummary(preset)}
                </p>
              </div>
            </div>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
