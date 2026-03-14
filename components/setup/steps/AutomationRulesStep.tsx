"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  Badge,
  Box,
  Divider,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { RULE_PRESETS } from "@/lib/rules/presets";
import type { StepId } from "@/lib/setup/types";

const DEFAULT_SELECTED = new Set(["preset-fraud-auto", "preset-pnr-auto"]);

interface AutomationRulesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

function matchSummary(preset: (typeof RULE_PRESETS)[number]): string {
  const parts: string[] = [];
  if (preset.match.reason?.length) {
    parts.push(preset.match.reason.join(", "));
  }
  if (preset.match.amount_range?.min !== undefined) {
    parts.push(`≥ $${preset.match.amount_range.min}`);
  }
  if (parts.length === 0) return "All disputes";
  return parts.join(" · ");
}

export function AutomationRulesStep({ stepId, onSaveRef }: AutomationRulesStepProps) {
  const t = useTranslations("setup.rules");
  const tRules = useTranslations("rules");
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTED));

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
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
        body: JSON.stringify({
          stepId,
          payload: { installedPresets: Array.from(selected) },
        }),
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

      <BlockStack gap="300">
        {RULE_PRESETS.map((preset, i) => {
          const isChecked = selected.has(preset.id);
          return (
            <Box key={preset.id}>
              {i > 0 && <Divider />}
              <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                <InlineStack align="space-between" blockAlign="start" wrap={false}>
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <Checkbox
                      label=""
                      labelHidden
                      checked={isChecked}
                      onChange={(checked) => toggle(preset.id, checked)}
                    />
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {tRules(preset.nameKey)}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {tRules(preset.descriptionKey)}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {matchSummary(preset)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Badge tone={preset.action.mode === "auto_pack" ? "info" : "warning"}>
                    {preset.action.mode === "auto_pack" ? t("badgeAutoPack") : t("badgeReview")}
                  </Badge>
                </InlineStack>
              </Box>
            </Box>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
