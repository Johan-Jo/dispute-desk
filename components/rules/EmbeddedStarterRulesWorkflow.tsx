"use client";

import {
  BlockStack,
  Text,
  Badge,
  InlineStack,
  Select,
  TextField,
} from "@shopify/polaris";
import { RULE_PRESETS } from "@/lib/rules/presets";

const PRESET_HIGH = "preset-high-value-review";

export interface EmbeddedStarterRulesWorkflowProps {
  /** `rules` namespace: (key) => string */
  tr: (key: string) => string;
  starterModes: Record<string, "auto_pack" | "review">;
  onStarterModeChange: (presetId: string, mode: "auto_pack" | "review") => void;
  activatedPacks: { id: string; name: string }[];
  /**
   * When false, fraud/PNR rows only offer "review" (setup: no templates installed).
   */
  allowAutoPackForFraudAndPnr?: boolean;
  /** Shown under row 3 when high-value review is on (setup step). */
  highValueMin?: number;
  onHighValueMinChange?: (value: number) => void;
  highValueReviewEnabled?: boolean;
  /** Label for the high-value amount field (e.g. setup.rules `highValueMinLabel`). */
  highValueMinLabel?: string;
  /** Primary actions below starter rows (e.g. Save on Rules page). Omit in setup wizard. */
  primaryFooter?: React.ReactNode;
}

function routingBadgeTone(
  mode: "auto_pack" | "review"
): "success" | "warning" {
  return mode === "auto_pack" ? "success" : "warning";
}

function routingBadgeLabel(
  mode: "auto_pack" | "review",
  tr: (key: string) => string
): string {
  return mode === "auto_pack" ? tr("autoPack") : tr("review");
}

export function EmbeddedStarterRulesWorkflow({
  tr,
  starterModes,
  onStarterModeChange,
  activatedPacks,
  allowAutoPackForFraudAndPnr = true,
  highValueMin,
  onHighValueMinChange,
  highValueReviewEnabled,
  highValueMinLabel,
  primaryFooter,
}: EmbeddedStarterRulesWorkflowProps) {
  const baseChoices = [
    { label: tr("autoPack"), value: "auto_pack" as const },
    { label: tr("review"), value: "review" as const },
  ];

  return (
    <BlockStack gap="500">
      <BlockStack gap="400" inlineAlign="center">
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "linear-gradient(145deg, #1D4ED8 0%, #3B82F6 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)",
          }}
          aria-hidden
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <Text as="h2" variant="headingLg">
          {tr("setupTitle")}
        </Text>
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <Text as="p" variant="bodyMd" tone="subdued">
            {tr("setupDescription")}
          </Text>
        </div>
        <Text
          as="p"
          variant="bodySm"
          tone="subdued"
          fontWeight="semibold"
        >
          {tr("suggestedRules")}
        </Text>
      </BlockStack>

      <BlockStack gap="300">
        {RULE_PRESETS.map((preset, index) => {
          const mode =
            starterModes[preset.id] ?? preset.action.mode ?? "review";
          const restrictAuto =
            !allowAutoPackForFraudAndPnr &&
            (preset.id === "preset-fraud-auto" ||
              preset.id === "preset-pnr-auto");
          const actionOptions = restrictAuto
            ? baseChoices.filter((o) => o.value === "review")
            : baseChoices;
          const effectiveValue = restrictAuto ? "review" : mode;

          return (
            <div key={preset.id}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 16,
                  padding: "16px 18px",
                  borderRadius: 10,
                  border: "1px solid #E3E5E8",
                  background: "#FAFBFB",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontWeight: 700,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <BlockStack gap="100">
                    <Text as="h3" variant="bodyMd" fontWeight="semibold">
                      {tr(preset.nameKey)}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tr(preset.descriptionKey)}
                    </Text>
                  </BlockStack>
                </div>
                <div
                  style={{
                    width: "auto",
                    minWidth: 200,
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 8,
                  }}
                >
                  <Badge tone={routingBadgeTone(effectiveValue as "auto_pack" | "review")}>
                    {routingBadgeLabel(effectiveValue as "auto_pack" | "review", tr)}
                  </Badge>
                  <div style={{ width: "100%", minWidth: 180 }}>
                    <Select
                      label={tr("actionRouting")}
                      labelHidden
                      options={actionOptions}
                      value={effectiveValue}
                      onChange={(value) =>
                        onStarterModeChange(
                          preset.id,
                          value as "auto_pack" | "review"
                        )
                      }
                    />
                  </div>
                </div>
              </div>
              {preset.id === PRESET_HIGH &&
                highValueReviewEnabled &&
                onHighValueMinChange !== undefined &&
                highValueMin !== undefined && (
                  <div style={{ paddingLeft: 48, paddingTop: 8, maxWidth: 280 }}>
                    <TextField
                      label={highValueMinLabel ?? "Minimum amount"}
                      type="number"
                      autoComplete="off"
                      value={String(highValueMin)}
                      onChange={(v) =>
                        onHighValueMinChange(Math.max(0, Number.parseFloat(v) || 0))
                      }
                    />
                  </div>
                )}
            </div>
          );
        })}
      </BlockStack>

      {primaryFooter ? (
        <InlineStack align="end">{primaryFooter}</InlineStack>
      ) : null}

      <div
        style={{
          paddingTop: 16,
          borderTop: "1px solid #E3E5E8",
        }}
      >
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            {tr("activatedPackagesTitle")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {tr("activatedPackagesHint")}
          </Text>
          {activatedPacks.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {tr("activatedPackagesEmpty")}
            </Text>
          ) : (
            <BlockStack gap="200">
              {activatedPacks.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid #E3E5E8",
                    background: "#FFFFFF",
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      background: "linear-gradient(135deg, #64748B, #94A3B8)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  <Text as="span" variant="bodyMd">
                    {p.name}
                  </Text>
                </div>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </div>
    </BlockStack>
  );
}
