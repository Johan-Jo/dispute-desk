"use client";

import { useEffect, useState } from "react";
import { BlockStack, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

const DATE_RANGES = [
  { value: "30", titleKey: "days30Title", descKey: "days30Desc", recommended: false },
  { value: "90", titleKey: "days90Title", descKey: "days90Desc", recommended: true },
  { value: "180", titleKey: "days180Title", descKey: "days180Desc", recommended: false },
] as const;

type TitleKey = "days30Title" | "days90Title" | "days180Title";
type DescKey = "days30Desc" | "days90Desc" | "days180Desc";

interface SyncDisputesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function SyncDisputesStep({ stepId, onSaveRef }: SyncDisputesStepProps) {
  const t = useTranslations("setup.syncDisputes");
  const [dateRange, setDateRange] = useState("90");
  const [autoSync, setAutoSync] = useState(true);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: { dateRange, autoSync } }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, dateRange, autoSync]);

  const unlockItems = [t("unlock1"), t("unlock2"), t("unlock3")];

  return (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant="headingLg">{t("title")}</Text>
        <Text as="p" variant="bodyMd" tone="subdued">{t("subtitle")}</Text>
      </BlockStack>

      {/* Date range choice cards */}
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" fontWeight="semibold">{t("dateRangeHeading")}</Text>
        <BlockStack gap="200">
          {DATE_RANGES.map(({ value, titleKey, descKey, recommended }) => {
            const isSelected = dateRange === value;
            return (
              <div
                key={value}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => setDateRange(value)}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setDateRange(value); }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 8,
                  border: isSelected ? "2px solid #2C6ECB" : "1px solid #C9CCCF",
                  background: isSelected ? "#F2F7FE" : "#FFFFFF",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  userSelect: "none",
                }}
              >
                {/* Radio dot */}
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: isSelected ? "5px solid #2C6ECB" : "2px solid #8C9196",
                      background: "transparent",
                    }}
                  />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: "20px" }}>
                      {t(titleKey as TitleKey)}
                    </span>
                    {recommended && (
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
                        {t("days90Recommended")}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
                    {t(descKey as DescKey)}
                  </p>
                </div>
              </div>
            );
          })}
        </BlockStack>
      </BlockStack>

      {/* Auto-sync toggle card */}
      <div
        role="checkbox"
        aria-checked={autoSync}
        tabIndex={0}
        onClick={() => setAutoSync((v) => !v)}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setAutoSync((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 8,
          border: autoSync ? "2px solid #2C6ECB" : "1px solid #C9CCCF",
          background: autoSync ? "#F2F7FE" : "#FFFFFF",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          userSelect: "none",
        }}
      >
        <div style={{ marginTop: 2, flexShrink: 0 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: autoSync ? "none" : "2px solid #8C9196",
              background: autoSync ? "#2C6ECB" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {autoSync && (
              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: "20px" }}>
            {t("autoSyncTitle")}
          </span>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
            {t("autoSyncDesc")}
          </p>
        </div>
      </div>

      {/* What you'll get */}
      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: "14px 16px",
          background: "#F6F6F7",
        }}
      >
        <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#202223" }}>
          {t("unlockHeading")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {unlockItems.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="#008060">
                <path d="M8.5 13.5l-3-3 1.06-1.06L8.5 11.38l4.94-4.94L14.5 7.5l-6 6z" />
              </svg>
              <span style={{ fontSize: 13, color: "#4A5568", lineHeight: "18px" }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </BlockStack>
  );
}
