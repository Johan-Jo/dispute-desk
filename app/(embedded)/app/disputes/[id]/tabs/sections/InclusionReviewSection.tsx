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
    <Card padding="0">
      <BlockStack gap="0">
        <div style={{ padding: 20 }}>
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              {t("title")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("subtitle")}
            </Text>
          </BlockStack>
        </div>

        {errorMessage ? (
          <div style={{ padding: "0 20px 12px" }}>
            <Banner tone="warning" onDismiss={() => setErrorMessage(null)}>
              <p>{errorMessage}</p>
            </Banner>
          </div>
        ) : null}

        {/* Color-coded disposition groups. Each group is bordered top
            with a 4px left accent rail. Per-design CSS in
            disputedesk/project/Dispute Page Review Submit.html — the
            React surface uses the same hex values + rail width so
            the embedded HTML view matches the design pixel-for-pixel. */}
        {GROUP_ORDER.map((group) => {
          const rows = groups[group];
          if (rows.length === 0) return null;
          const tone = GROUP_TONE[group];
          return (
            <div
              key={group}
              style={{
                position: "relative",
                borderTop: "1px solid #E1E3E5",
                padding: "18px 20px 18px 28px",
                background: "#FFFFFF",
              }}
            >
              {/* Left accent rail */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: 4,
                  background: tone.accent,
                }}
              />
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">
                  {t(`groups.${group}`)}
                </Text>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 22,
                    height: 20,
                    padding: "0 7px",
                    borderRadius: 10,
                    background: tone.countBg,
                    color: tone.countColor,
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {rows.length}
                </span>
                {/* Status tag — pushed to the right with margin-left auto. */}
                <span
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 22,
                    padding: "0 10px",
                    borderRadius: 11,
                    background: tone.tagBg,
                    color: tone.tagColor,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "currentColor",
                      opacity: 0.85,
                    }}
                  />
                  {t(`groupTags.${group}`)}
                </span>
              </InlineStack>
              <div style={{ marginTop: 6, marginBottom: 14, maxWidth: 680 }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t(`groupHelpers.${group}`)}
                </Text>
              </div>

              {rows.map((li, i) => {
                const isInternalOnly = INTERNAL_ONLY_FIELDS.has(li.field);
                // An "Include in package" button only makes sense on a
                // not-included row whose data is something the merchant
                // can actually act on. When canBeForceIncluded is false
                // (the source lives outside DisputeDesk — payment
                // gateway, carrier, Shopify risk engine) clicking the
                // button is a no-op even server-side; the row's
                // outside-data callout below already explains why. So
                // we drop the button entirely instead of rendering it
                // disabled — disabled buttons read as "almost active"
                // and create UI noise.
                const showIncludeButton =
                  group === "notIncluded" && li.canBeForceIncluded;
                // Kept-internal rows used to render a disabled
                // "Include in package" stub to communicate "you can't
                // do this from here." The group header pill
                // ("Hidden from bank") plus the group helper text
                // already carry that message; no button needed.
                const showRestoreButton = group === "excludedByMerchant";
                const hasAction = showIncludeButton || showRestoreButton;
                // Suppress unused-var warning on isInternalOnly — it
                // used to gate the kept-internal stub button above.
                void isInternalOnly;
                return (
                  <div
                    key={li.field}
                    style={{
                      display: "grid",
                      // Collapse the action column when nothing is
                      // rendered there — keeps the title + body flush
                      // against the right edge instead of leaving
                      // dead space.
                      gridTemplateColumns: hasAction
                        ? "22px 1fr auto"
                        : "22px 1fr",
                      gap: 14,
                      alignItems: "start",
                      padding: i === 0 ? "6px 0 12px" : "12px 0",
                      borderTop:
                        i === 0 ? "0" : "1px dashed #E1E3E5",
                    }}
                  >
                    {/* Disposition marker — coloured circle with an SVG glyph */}
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: tone.markerBg,
                        color: "#FFFFFF",
                        marginTop: 1,
                      }}
                    >
                      <GroupMarker group={group} />
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "#202223",
                          lineHeight: "18px",
                        }}
                      >
                        {li.label}
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "#4A4A4A",
                          lineHeight: "18px",
                          marginTop: 3,
                        }}
                      >
                        {li.reason}
                      </div>
                      {/* When the row is in the Not-included group but
                          its data lives outside the merchant's control,
                          the callout explains why no action is offered.
                          Replaces the previous disabled-button stub. */}
                      {group === "notIncluded" && !li.canBeForceIncluded ? (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "flex-start",
                            gap: 8,
                            marginTop: 8,
                            padding: "8px 10px",
                            background: "#F6F6F7",
                            borderLeft: "3px solid #8A8A8A",
                            borderRadius: "0 6px 6px 0",
                            fontSize: 12,
                            color: "#5C5F62",
                            lineHeight: "17px",
                          }}
                        >
                          <InfoGlyph />
                          <span>{t("outsideDataCallout")}</span>
                        </div>
                      ) : null}
                    </div>
                    {hasAction ? (
                      <div style={{ alignSelf: "start", marginTop: 1 }}>
                        {showIncludeButton ? (
                          <Button
                            size="slim"
                            onClick={() => handleToggle(li, "force_include")}
                            loading={busyField === li.field}
                            disabled={busyField !== null && busyField !== li.field}
                          >
                            {t("toggle.include")}
                          </Button>
                        ) : showRestoreButton ? (
                          <Button
                            size="slim"
                            onClick={() => handleToggle(li, null)}
                            loading={busyField === li.field}
                            disabled={busyField !== null && busyField !== li.field}
                          >
                            {t("toggle.restore")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </BlockStack>
    </Card>
  );
}

/* ── Group tone palette (matches the design CSS) ────────────────── */

interface GroupTone {
  accent: string;
  countBg: string;
  countColor: string;
  tagBg: string;
  tagColor: string;
  markerBg: string;
}

const GROUP_TONE: Record<Group, GroupTone> = {
  usedAsBankArgument: {
    accent: "#2BAA68",
    countBg: "#CDFEE1",
    countColor: "#0C5132",
    tagBg: "#E3FBE9",
    tagColor: "#0C5132",
    markerBg: "#2BAA68",
  },
  contextOnly: {
    accent: "#8A8A8A",
    countBg: "#E3E3E3",
    countColor: "#303030",
    tagBg: "#F1F1F1",
    tagColor: "#4A4A4A",
    markerBg: "#8A8A8A",
  },
  keptInternal: {
    accent: "#D9A300",
    countBg: "#FFEDB3",
    countColor: "#5C4500",
    tagBg: "#FFF7DB",
    tagColor: "#7A5A00",
    markerBg: "#E0A500",
  },
  notIncluded: {
    accent: "#B73B33",
    countBg: "#FED3D1",
    countColor: "#8B1F19",
    tagBg: "#FDE9E7",
    tagColor: "#8B1F19",
    markerBg: "#C9524A",
  },
  excludedByMerchant: {
    accent: "#B73B33",
    countBg: "#FED3D1",
    countColor: "#8B1F19",
    tagBg: "#FDE9E7",
    tagColor: "#8B1F19",
    markerBg: "#C9524A",
  },
};

/* ── Per-group marker glyph ──────────────────────────────────────── */

function GroupMarker({ group }: { group: Group }) {
  // Per the design: checkmark for positive, dash for context, padlock
  // for internal, X for excluded / not_included. SVGs match the
  // design file's stroke-width + path data.
  if (group === "usedAsBankArgument") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (group === "contextOnly") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    );
  }
  if (group === "keptInternal") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  // notIncluded / excludedByMerchant
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 1, color: "#8A8A8A" }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
