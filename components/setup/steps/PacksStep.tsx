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
  Spinner,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

interface Template {
  id: string;
  name: string;
  short_description: string;
  dispute_type: string | null;
  is_recommended: boolean;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

interface PacksStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function PacksStep({ stepId, onSaveRef }: PacksStepProps) {
  const t = useTranslations("setup.packs");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/templates?locale=en-US")
      .then((r) => r.json())
      .then((data: { templates: Template[] }) => {
        const list = data.templates ?? [];
        setTemplates(list);
        setSelected(new Set(list.filter((t) => t.is_recommended).map((t) => t.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

      for (const id of selectedIds) {
        const res = await fetch(`/api/templates/${id}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopId }),
        });
        if (!res.ok) return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { installedTemplates: selectedIds },
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

      {loading ? (
        <InlineStack align="center">
          <Spinner size="small" />
        </InlineStack>
      ) : templates.length === 0 ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {t("empty")}
        </Text>
      ) : (
        <BlockStack gap="300">
          {templates.map((tpl, i) => {
            const isChecked = selected.has(tpl.id);
            return (
              <Box key={tpl.id}>
                {i > 0 && <Divider />}
                <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                  <InlineStack align="space-between" blockAlign="start" wrap={false}>
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <Checkbox
                        label=""
                        labelHidden
                        checked={isChecked}
                        onChange={(checked) => toggle(tpl.id, checked)}
                      />
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {tpl.name}
                          </Text>
                          {tpl.is_recommended && (
                            <Badge tone="success">{t("recommended")}</Badge>
                          )}
                        </InlineStack>
                        {tpl.short_description && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {tpl.short_description}
                          </Text>
                        )}
                        {tpl.dispute_type && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {tpl.dispute_type}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                  </InlineStack>
                </Box>
              </Box>
            );
          })}
        </BlockStack>
      )}
    </BlockStack>
  );
}
