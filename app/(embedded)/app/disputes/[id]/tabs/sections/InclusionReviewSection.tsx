/**
 * InclusionReviewSection — Review/Submit tab inclusion interface.
 *
 * Phase 1 implementation: read-only grouped view backed by
 * `data.evidenceLineItems`. Two toggle paths are active:
 *
 *   - "Not included" group → "Include in package" button — for fields
 *     that are NOT internal-only (the safe set). The override calls
 *     POST /api/packs/:packId/inclusion-override which writes
 *     pack_json.inclusionOverrides and logs an
 *     `evidence_inclusion_overridden` audit event.
 *
 *   - "Excluded by you" group → "Restore default" button — clears the
 *     prior force_exclude.
 *
 * Internal-only rows render a DISABLED toggle with an explanatory
 * tooltip. Promoting them is reserved for a Phase 2 confirmation flow.
 *
 * Critical invariant (enforced server- and client-side): a `force_include`
 * NEVER, by itself, elevates a row to "used as positive bank argument".
 * The derivation respects this — see lib/argument/evidenceLineItem.ts.
 *
 * Plan: C:\Users\johan\.claude\plans\do-a-plan-for-scalable-parrot.md §10
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BlockStack,
  Banner,
  Card,
  InlineStack,
  Text,
  Badge,
  Button,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { INTERNAL_ONLY_FIELDS } from "@/lib/defence/factClassifier";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";

type Group =
  | "usedAsBankArgument"
  | "contextOnly"
  | "keptInternal"
  | "notIncluded"
  | "excludedByMerchant";

const GROUP_ORDER: Group[] = [
  "usedAsBankArgument",
  "contextOnly",
  "keptInternal",
  "notIncluded",
  "excludedByMerchant",
];

function groupFor(li: EvidenceLineItem): Group | null {
  if (li.submissionMethod === "excluded") return "excludedByMerchant";
  if (li.usedAsPositiveBankEvidence) return "usedAsBankArgument";
  if (li.submissionMethod === "internal_only") return "keptInternal";
  if (li.includedInDefencePackage) return "contextOnly";
  if (
    li.submissionMethod === "not_included" ||
    li.submissionMethod === "not_supported" ||
    li.submissionMethod === "failed_upload" ||
    li.submissionMethod === "waived"
  ) {
    return "notIncluded";
  }
  return null;
}

interface Props {
  packId: string | null;
  lineItems: EvidenceLineItem[];
  onToggleInclusionOverride: (
    field: string,
    value: "force_include" | "force_exclude" | null,
  ) => Promise<void>;
}

export function InclusionReviewSection({
  packId,
  lineItems,
  onToggleInclusionOverride,
}: Props) {
  const t = useTranslations("disputes.reviewTab.inclusion");
  const [busyField, setBusyField] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map: Record<Group, EvidenceLineItem[]> = {
      usedAsBankArgument: [],
      contextOnly: [],
      keptInternal: [],
      notIncluded: [],
      excludedByMerchant: [],
    };
    for (const li of lineItems) {
      const g = groupFor(li);
      if (g) map[g].push(li);
    }
    return map;
  }, [lineItems]);

  const handleToggle = useCallback(
    async (li: EvidenceLineItem, target: "force_include" | "force_exclude" | null) => {
      if (!packId) return;
      setBusyField(li.field);
      setErrorMessage(null);
      try {
        // Pre-flight client-side guard for internal-only rows — mirrors
        // the server's Phase 1 OVERRIDE_NEEDS_CONFIRMATION rejection so
        // the merchant doesn't trigger a round-trip for a doomed call.
        if (target === "force_include" && INTERNAL_ONLY_FIELDS.has(li.field)) {
          setErrorMessage(t("errorOverrideNeedsConfirmation"));
          return;
        }
        await onToggleInclusionOverride(li.field, target);
      } finally {
        setBusyField(null);
      }
    },
    [packId, onToggleInclusionOverride, t],
  );

  if (!packId) return null;
  if (lineItems.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("emptyAll")}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("subtitle")}
          </Text>
        </BlockStack>

        {errorMessage ? (
          <Banner tone="warning" onDismiss={() => setErrorMessage(null)}>
            <p>{errorMessage}</p>
          </Banner>
        ) : null}

        {GROUP_ORDER.map((group) => {
          const rows = groups[group];
          if (rows.length === 0) return null;
          return (
            <BlockStack key={group} gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  {t(`groups.${group}`)}
                </Text>
                <Badge>{`${rows.length}`}</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {t(`groupHelpers.${group}`)}
              </Text>
              <BlockStack gap="150">
                {rows.map((li) => {
                  const isInternalOnly = INTERNAL_ONLY_FIELDS.has(li.field);
                  const showIncludeToggle = group === "notIncluded";
                  const showRestoreToggle = group === "excludedByMerchant";
                  const showDisabledInternalToggle =
                    group === "keptInternal" && isInternalOnly;
                  return (
                    <InlineStack
                      key={li.field}
                      align="space-between"
                      blockAlign="start"
                      gap="300"
                      wrap
                    >
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {li.label}
                        </Text>
                        <Text as="span" variant="bodyXs" tone="subdued">
                          {li.reason}
                        </Text>
                      </BlockStack>
                      {showIncludeToggle ? (
                        <Button
                          size="slim"
                          onClick={() => handleToggle(li, "force_include")}
                          loading={busyField === li.field}
                          disabled={busyField !== null && busyField !== li.field}
                        >
                          {t("toggle.include")}
                        </Button>
                      ) : showRestoreToggle ? (
                        <Button
                          size="slim"
                          onClick={() => handleToggle(li, null)}
                          loading={busyField === li.field}
                          disabled={busyField !== null && busyField !== li.field}
                        >
                          {t("toggle.restore")}
                        </Button>
                      ) : showDisabledInternalToggle ? (
                        <Button
                          size="slim"
                          disabled
                          accessibilityLabel={t("toggle.disabledInternalOnly")}
                        >
                          {t("toggle.include")}
                        </Button>
                      ) : null}
                    </InlineStack>
                  );
                })}
              </BlockStack>
            </BlockStack>
          );
        })}
      </BlockStack>
    </Card>
  );
}
