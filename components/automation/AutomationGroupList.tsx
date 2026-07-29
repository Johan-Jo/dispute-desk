"use client";

/**
 * Per-dispute-type overrides, layered on the store-wide switch.
 *
 * Deliberately NOT a fourth card on the Automation page. Three cards all
 * answering "what happens to a dispute" is the duplication this codebase spent
 * several PRs deleting. These nest inside the switch card as progressive
 * disclosure, so the page reads as one specificity ladder:
 *
 *   Everything is handled THIS way [switch]
 *     · except these types [groups]
 *     · except above this amount [safeguard]
 *     · and these always get reviewed no matter what [facts]
 *     · plus your own rules [custom]
 *
 * That ladder mirrors the tier system exactly: tier-2 → tier-1 → tier-0 →
 * engine guards → tier-1 custom.
 *
 * Copy lives under `rules.group*` — one key set, passed in via `t`.
 */

import { Text, BlockStack, InlineStack, Badge, Select } from "@shopify/polaris";
import {
  AUTOMATION_GROUPS,
  type AutomationGroupId,
  type GroupOverrides,
} from "@/lib/rules/automationGroups";
import type { StoreAutomationMode } from "@/lib/rules/storeAutomation";

interface AutomationGroupListProps {
  /** The store-wide switch — names the inherited mode in the "use default" option. */
  storeMode: StoreAutomationMode;
  value: GroupOverrides;
  onChange: (next: GroupOverrides) => void;
  /** Translator bound to the `rules` namespace. */
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Plan-gated or saving — renders non-interactive but still readable. */
  disabled?: boolean;
}

/** `""` is the absence of an override, which is a real state, not a null. */
const INHERIT = "";

export function AutomationGroupList({
  storeMode,
  value,
  onChange,
  t,
  disabled = false,
}: AutomationGroupListProps) {
  // The inherited mode is named in the option label and must re-render when
  // the switch above changes — that is what makes "use default" legible
  // rather than mysterious.
  const inheritedLabel = t("groupUseDefault", {
    mode: storeMode === "auto" ? t("modeAutoTitle") : t("modeReviewTitle"),
  });

  const select = (id: AutomationGroupId, next: string) => {
    const draft = { ...value };
    if (next === INHERIT) {
      delete draft[id];
    } else {
      draft[id] = next as "auto" | "review";
    }
    onChange(draft);
  };

  return (
    <BlockStack gap="300">
      {AUTOMATION_GROUPS.map((group) => (
        <InlineStack
          key={group.id}
          align="space-between"
          blockAlign="center"
          gap="400"
          wrap={false}
        >
          <div style={{ minWidth: 0 }}>
            <Text as="span" variant="bodyMd">
              {t(group.labelKey)}
            </Text>
          </div>

          {/* Locked rows keep the same row geometry so the list still reads as
              one table, but the control slot renders a badge + explanation
              rather than a disabled Select. A greyed-out dropdown reads as
              "you can't afford this" — the plan-gate idiom already used on
              this page. A badge reads as a fact. */}
          {group.locked ? (
            <div style={{ maxWidth: 320, textAlign: "right" }}>
              <BlockStack gap="100" inlineAlign="end">
                <Badge tone="info">{t("modeReviewTitle")}</Badge>
                {group.lockedReasonKey && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t(group.lockedReasonKey)}
                  </Text>
                )}
              </BlockStack>
            </div>
          ) : (
            <div style={{ minWidth: 220 }}>
              <Select
                label={t(group.labelKey)}
                labelHidden
                disabled={disabled}
                value={value[group.id] ?? INHERIT}
                onChange={(next) => select(group.id, next)}
                options={[
                  { label: inheritedLabel, value: INHERIT },
                  { label: t("autoPack"), value: "auto" },
                  { label: t("review"), value: "review" },
                ]}
              />
            </div>
          )}
        </InlineStack>
      ))}

      {/* Accounts for GENERAL without giving it a row. A second control for
          what the catch-all already does at a different tier is exactly the
          duplication this design avoids. */}
      <Text as="p" variant="bodySm" tone="subdued">
        {t("groupsGeneralNote")}
      </Text>
    </BlockStack>
  );
}
