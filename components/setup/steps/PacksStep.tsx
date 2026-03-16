"use client";

import { useEffect, useState } from "react";
import { BlockStack, Text, InlineStack, Spinner } from "@shopify/polaris";
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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        body: JSON.stringify({ stepId, payload: { installedTemplates: Array.from(selected) } }),
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
          {templates.map((tpl) => {
            const isChecked = selected.has(tpl.id);

            return (
              <div
                key={tpl.id}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={() => toggle(tpl.id)}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") toggle(tpl.id); }}
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
                      {tpl.name}
                    </span>
                    {tpl.is_recommended && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 12,
                          fontWeight: 500,
                          lineHeight: "16px",
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#E3F1DF",
                          color: "#1A6A30",
                        }}
                      >
                        {t("recommended")}
                      </span>
                    )}
                  </div>
                  {tpl.short_description && (
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
                      {tpl.short_description}
                    </p>
                  )}
                  {tpl.dispute_type && (
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8C9196", lineHeight: "16px" }}>
                      {tpl.dispute_type}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </BlockStack>
      )}
    </BlockStack>
  );
}
