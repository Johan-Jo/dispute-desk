"use client";

/**
 * The five conditions DisputeDesk always holds for merchant review, whatever
 * handling mode the shop picked.
 *
 * These are FACTS ABOUT THE ENGINE, not settings — there is deliberately no
 * toggle. Rendered on both /app/rules and the setup wizard's handling step
 * from ONE component so the two surfaces can never describe the engine
 * differently.
 *
 * Every bullet traces to real code (see docs/technical.md § Auto-submit guards):
 *   product      → evaluateAutoSubmitGuards → park / product_family_strong
 *   covered      → pipeline coverage gate → skip_covered
 *   weak         → guards → block / weak | insufficient (moderate parks)
 *   fatal        → lib/automation/fatalLoss.ts → block / fatal_loss
 *   incomplete   → evaluateAutoSaveGate (score floor + blockers)
 *
 * Copy lives under `rules.alwaysReviewed*` — ONE copy, shared. Duplicating
 * the strings under `setup.handling.*` would guarantee they drift.
 */

import { Text, BlockStack, InlineStack, Icon } from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";

export const ALWAYS_REVIEWED_KEYS = [
  "alwaysReviewedProduct",
  "alwaysReviewedCovered",
  "alwaysReviewedWeak",
  "alwaysReviewedFatal",
  "alwaysReviewedIncomplete",
] as const;

interface AlwaysReviewedFactsProps {
  /**
   * Translator bound to the `rules` namespace. Passed in rather than called
   * here so the wizard (which uses the `setup` namespace for its own copy)
   * and the rules page can both render this without a second key set.
   */
  t: (key: string) => string;
}

export function AlwaysReviewedFacts({ t }: AlwaysReviewedFactsProps) {
  return (
    <BlockStack gap="200">
      <InlineStack gap="150" blockAlign="center">
        <Icon source={InfoIcon} tone="subdued" />
        <Text as="h3" variant="headingSm" tone="subdued">
          {t("alwaysReviewedTitle")}
        </Text>
      </InlineStack>
      <BlockStack gap="100">
        {ALWAYS_REVIEWED_KEYS.map((key) => (
          <InlineStack key={key} gap="200" blockAlign="start" wrap={false}>
            <div
              aria-hidden="true"
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "#8A8A8A",
                marginTop: 8,
                flexShrink: 0,
              }}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              {t(key)}
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
