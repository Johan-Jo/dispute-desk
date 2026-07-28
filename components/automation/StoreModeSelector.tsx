"use client";

/**
 * The store-wide handling switch: Auto-pilot vs Review everything.
 *
 * Two selectable cards with radio semantics. Shared by /app/rules and the
 * setup wizard's handling step so the merchant sees the SAME choice, worded
 * the same way, in both places — this used to be three surfaces (rules page
 * grid, Settings radio, wizard dropdowns) writing two backing stores.
 *
 * Copy lives under `rules.mode*` — one key set, passed in via `t`.
 */

import { Text, BlockStack, InlineStack, Badge, Icon } from "@shopify/polaris";
import { AutomationIcon, ViewIcon } from "@shopify/polaris-icons";
import type { StoreAutomationMode } from "@/lib/rules/storeAutomation";

interface StoreModeSelectorProps {
  value: StoreAutomationMode;
  onChange: (mode: StoreAutomationMode) => void;
  /** Translator bound to the `rules` namespace. */
  t: (key: string) => string;
  /** Plan-gated or saving — renders non-interactive but still readable. */
  disabled?: boolean;
}

interface ModeCardProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: typeof AutomationIcon;
  accent: string;
  title: string;
  description: string;
  badge?: string;
}

function ModeCard({
  selected,
  disabled,
  onSelect,
  icon,
  accent,
  title,
  description,
  badge,
}: ModeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      style={{
        flex: "1 1 240px",
        minWidth: 0,
        textAlign: "left",
        padding: 16,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        background: selected ? "#F7FAFF" : "#FFFFFF",
        border: selected ? `2px solid ${accent}` : "1px solid #D9DBDE",
        // Keep the box from shifting by 1px when the border thickens.
        boxShadow: selected ? `0 0 0 1px ${accent}22` : "none",
        opacity: disabled ? 0.6 : 1,
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <span style={{ color: accent, display: "inline-flex" }}>
            <Icon source={icon} tone="base" />
          </span>
          <Text as="span" variant="headingSm" fontWeight="semibold">
            {title}
          </Text>
          {badge ? <Badge tone="success">{badge}</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </button>
  );
}

export function StoreModeSelector({
  value,
  onChange,
  t,
  disabled = false,
}: StoreModeSelectorProps) {
  return (
    <div role="radiogroup" aria-label={t("modeSectionTitle")}>
      <InlineStack gap="300" wrap>
        <ModeCard
          selected={value === "auto"}
          disabled={disabled}
          onSelect={() => onChange("auto")}
          icon={AutomationIcon}
          accent="#22C55E"
          title={t("modeAutoTitle")}
          description={t("modeAutoDesc")}
          badge={t("modeAutoBadge")}
        />
        <ModeCard
          selected={value === "review"}
          disabled={disabled}
          onSelect={() => onChange("review")}
          icon={ViewIcon}
          accent="#0EA5E9"
          title={t("modeReviewTitle")}
          description={t("modeReviewDesc")}
        />
      </InlineStack>
    </div>
  );
}
