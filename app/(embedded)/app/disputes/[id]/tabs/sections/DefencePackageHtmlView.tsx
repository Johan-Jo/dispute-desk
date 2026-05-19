/**
 * DefencePackageHtmlView — Polaris-rendered, web-native version of the
 * Defence Package PDF.
 *
 * Mirrors the deterministic PDF document structure (`lib/defence/pdf/
 * DefencePackageDocument.tsx`) section-for-section so what the merchant
 * sees in-app matches what the bank receives. The Polaris idiom replaces
 * the @react-pdf primitives but the content + ordering + filtering
 * rules are identical.
 *
 * Inputs:
 *   - row: latest defence_packages row (narrative_json, facts_json,
 *     status, version, mode, evidence_hash, prompt + model metadata).
 *   - dispute: optional dispute meta used to render the case-details
 *     table at the top.
 */

"use client";

import { useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  NarrativeSectionKey,
  PackageMode,
} from "@/lib/defence/types";
import { isSectionDeniedForModule } from "@/lib/defence/sectionVisibility";
import {
  buildChronologyEvents,
  type ChronologyEvent,
} from "@/lib/defence/chronology";
import {
  SECTION_ORDER,
  SECTION_TITLES,
} from "@/lib/defence/render/sections";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import { renderThesis } from "@/lib/defence/pdf/renderThesis";
import { familyKeyForModule } from "@/lib/defence/reasonCodes/registry";
import { buildCaseDetailsRows } from "@/lib/defence/render/caseDetails";
import {
  buildLineItems,
  type LineItem,
} from "@/lib/defence/render/lineItems";
import type { ReasonCodeModuleKey } from "@/lib/defence/types";

/**
 * Resolve the thesis blockquote text for a section.
 *
 * Both renderers now call `renderThesis()` from the templated thesis
 * system in `lib/defence/pdf/renderThesis.ts`. The HTML view's old
 * static per-module library (`GENERIC_THESIS` + `VISA_10_4_FRAUD_THESIS`)
 * is gone — it was a parallel implementation that needed to be
 * hand-synced with `lib/defence/pdf/thesisTemplates.ts`. Now both
 * surfaces produce identical thesis text for the same pack because
 * they share the same template registry + token resolver.
 *
 * Returns "" when the template's required tokens don't resolve
 * (no fact to ground the thesis claim). The renderer skips the
 * blockquote in that case.
 */
function thesisFor(
  sectionKey: NarrativeSectionKey,
  moduleKey: string | null | undefined,
  mode: PackageMode,
  facts: EvidenceFact[],
): string | null {
  const familyKey = moduleKey
    ? familyKeyForModule(moduleKey as ReasonCodeModuleKey)
    : null;
  if (!familyKey) return null;
  const out = renderThesis({
    sectionKey,
    familyKey,
    packageMode: mode,
    approvedFacts: facts,
  });
  return out || null;
}

// ─── Inputs ──────────────────────────────────────────────────────────

interface DefencePackageRow {
  id: string;
  version: number;
  status:
    | "draft"
    | "stale"
    | "final"
    | "submitted"
    | "superseded"
    | "failed"
    | "skipped";
  package_mode: PackageMode | null;
  generated_at: string;
  pdf_path: string | null;
  evidence_hash: string;
  llm_model: string | null;
  prompt_family: string | null;
  prompt_version: number | null;
  reason_code_module: string | null;
  validation_status: "ok" | "failed" | "skipped" | null;
  narrative_json: DefenceNarrativeOutput | null;
  facts_json: EvidenceFact[] | null;
}

export interface DisputeContextLike {
  /** Used by sibling fetches that hit `/api/defence-packages/*` routes
   *  with explicit `?shop_id=` query params, defence-in-depth alongside
   *  the middleware-injected `x-shop-id` header. */
  shopId?: string | null;
  disputeGid?: string | null;
  orderName?: string | null;
  reason?: string | null;
  reasonCodeDisplay?: string | null;
  amount?: number | string | null;
  currencyCode?: string | null;
  cardNetwork?: string | null;
  cardLast4?: string | null;
  paymentGateway?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  cardholderName?: string | null;
  customerEmail?: string | null;
  transactionDate?: string | null;
  merchantName?: string | null;
  shopName?: string | null;
  /** Full event timeline from the pack's access_log section. Threaded
   *  through by the workspace API so the HTML view renders the SAME
   *  chronology bullets the PDF shows the bank — no parallel
   *  synthesis. When absent/empty, the renderer falls back to the
   *  synthetic 2-event path (only fires on packs built before the
   *  orderSource events capture was added). */
  timelineEvents?: Array<{ at: string; text: string }>;
}

interface Props {
  row: DefencePackageRow;
  dispute?: DisputeContextLike;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function disputeIdShort(gid: string | null | undefined): string {
  if (!gid) return "—";
  return gid.split("/").pop() ?? gid;
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtAmount(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  return currency ? `${currency} ${amount}` : String(amount);
}

// SECTION_ORDER + SECTION_TITLES imported from
// `lib/defence/render/sections.ts` — single source of truth shared
// with the PDF render pipeline (`lib/defence/pdf/composePdfBlocks.ts`).

// Evidence Basis filter + sort + per-fact value rendering all live in
// `lib/defence/pdf/evidenceBasisRows.ts` — single source of truth shared
// with the PDF renderer. Call `buildEvidenceBasisRows(facts)` to get
// the same {factId, category, label, value} rows the bank sees.
//
// The old local `buildEvidenceBasis()` + `renderFactValue()` here were
// a parallel implementation that drifted from the canonical version
// (e.g. they output raw "AVS Y / CVV M" gateway codes and
// "Order on record (UNFULFILLED)" — both bank-readability problems the
// canonical formatter now translates to plain language).

/**
 * Chronology rendering is now a thin wrapper over the shared
 * `buildChronologyEvents()` in `lib/defence/chronology.ts`. Both the
 * PDF and this HTML view import from there — there is no parallel
 * implementation anywhere. The wrapper exists only to map this
 * file's `DisputeContextLike` (a UI prop type) to the
 * `ChronologyContext` shape the shared builder expects.
 */
function chronologyEvents(
  dispute: DisputeContextLike | undefined,
  facts: EvidenceFact[],
): ChronologyEvent[] {
  return buildChronologyEvents(
    {
      timelineEvents: dispute?.timelineEvents ?? null,
      transactionDate: dispute?.transactionDate ?? null,
      orderName: dispute?.orderName ?? null,
      cardNetwork: dispute?.cardNetwork ?? null,
      cardLast4: dispute?.cardLast4 ?? null,
    },
    facts,
  );
}

// ─── Component ───────────────────────────────────────────────────────

export function DefencePackageHtmlView({ row, dispute }: Props) {
  // No narrative → render nothing (e.g., skipped / failed packages).
  if (!row.narrative_json || !row.facts_json) {
    return null;
  }
  const narrative = row.narrative_json;
  const facts = row.facts_json;
  const omitted = new Set<NarrativeSectionKey>(
    narrative.omittedSections.map((o) => o.sectionKey),
  );
  const mode: PackageMode = row.package_mode ?? "full";
  const moduleKey = row.reason_code_module;

  const evidenceBasis = buildEvidenceBasisRows(facts);
  const chrono = chronologyEvents(dispute, facts);
  // Line items extracted via the shared builder so the PDF and HTML
  // view show the same rows with the same shape validation.
  const lineItems: LineItem[] = buildLineItems(facts);

  const fulfillmentFallbackVisible =
    omitted.has("fulfillmentArgument") &&
    (typeof dispute?.fulfillmentStatus === "string" && dispute.fulfillmentStatus.toUpperCase() === "FULFILLED");

  // Case Details rows come from the shared builder so the PDF and
  // this HTML view show the same fields in the same order — no
  // parallel implementation.
  const caseRows = buildCaseDetailsRows({
    disputeIdShort: disputeIdShort(dispute?.disputeGid),
    merchantName: dispute?.merchantName ?? dispute?.shopName ?? null,
    cardNetwork: dispute?.cardNetwork ?? null,
    transactionDateDisplay: fmtIso(dispute?.transactionDate),
    amountDisplay: fmtAmount(dispute?.amount, dispute?.currencyCode),
    reasonCodeDisplay: dispute?.reasonCodeDisplay ?? dispute?.reason ?? null,
    claimType: null, // Workspace API doesn't expose claimType today; falls back to "—".
    orderName: dispute?.orderName ?? null,
    cardholderName: dispute?.cardholderName ?? null,
    cardLast4: dispute?.cardLast4 ?? null,
    paymentGateway: dispute?.paymentGateway ?? null,
    financialStatus: dispute?.financialStatus ?? null,
    fulfillmentStatus: dispute?.fulfillmentStatus ?? null,
  });

  return (
    <Card padding="500">
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">
            CHARGEBACK REPRESENTMENT
          </Text>
          <Text as="h2" variant="headingLg">
            Complete Defence Package
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Prepared for{" "}
            {dispute?.merchantName ?? dispute?.shopName ?? "the merchant"}
          </Text>
        </BlockStack>

        <Divider />

        {/* Case Details (collapsible — collapsed by default; merchant
            expands to verify the metadata) */}
        <CaseDetailsSection rows={caseRows} />

        {/* LLM-authored sections. Per-module section deny list is
            consulted at render time (see lib/defence/sectionVisibility.ts)
            so stale narrative_json rows never surface a section that's
            been ruled out for the reason code. */}
        {SECTION_ORDER.filter(
          (key) => !isSectionDeniedForModule(key, moduleKey),
        ).map((key) => {
          if (key === "chronologyArgument") {
            // Chronology has its own bullet list below the paragraph.
            const section = narrative[key];
            if (omitted.has(key) || !section.text.trim()) return null;
            const thesis = thesisFor(key, moduleKey, mode, facts);
            return (
              <BlockStack key={key} gap="200">
                <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                {thesis && <ThesisBox text={thesis} />}
                <Text as="p" variant="bodyMd">{section.text}</Text>
                {chrono.length > 0 && (
                  <BlockStack gap="100">
                    {chrono.map((e, i) => (
                      <InlineStack key={`${e.at}-${i}`} gap="200" wrap={false}>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {e.at}
                        </Text>
                        <Text as="span" variant="bodySm">{e.text}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            );
          }

          if (key === "fulfillmentArgument") {
            // Either the LLM-authored body, or the minimal deterministic
            // fallback when only fulfillmentStatus=FULFILLED is on file.
            const section = narrative[key];
            const hasBody = !omitted.has(key) && section.text.trim();
            if (hasBody) {
              const thesis = thesisFor(key, moduleKey, mode, facts);
              return (
                <BlockStack key={key} gap="200">
                  <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                  {thesis && <ThesisBox text={thesis} />}
                  <Text as="p" variant="bodyMd">{section.text}</Text>
                </BlockStack>
              );
            }
            if (fulfillmentFallbackVisible) {
              return (
                <BlockStack key={key} gap="200">
                  <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                  <Text as="p" variant="bodyMd">
                    The merchant&apos;s order record marks the order as fulfilled. No
                    separate delivery, access-use, or service-completion claim is made
                    in this section unless supported by approved evidence.
                  </Text>
                </BlockStack>
              );
            }
            return null;
          }

          if (key === "conclusion") {
            // Render the conclusion with a framed call-out.
            const section = narrative[key];
            if (omitted.has(key) || !section.text.trim()) return null;
            const thesis = thesisFor(key, moduleKey, mode, facts);
            return (
              <BlockStack key={key} gap="200">
                <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                {thesis && <ThesisBox text={thesis} />}
                <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                  <Text as="p" variant="bodyMd">{section.text}</Text>
                </Box>
              </BlockStack>
            );
          }

          return (
            <SectionBlock
              key={key}
              title={SECTION_TITLES[key]}
              thesis={thesisFor(key, moduleKey, mode, facts)}
              section={narrative[key]}
              omitted={omitted.has(key)}
            />
          );
        })}

        {/* Order Line Items (deterministic) */}
        {lineItems.length > 0 && (
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Order Line Items</Text>
            <BlockStack gap="100">
              {lineItems.map((it, i) => (
                <InlineStack key={i} gap="400" align="space-between" wrap={false}>
                  <Text as="span" variant="bodySm">
                    {it.description} (×{it.quantity})
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">{it.price}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        )}

        {/* Evidence Basis (deterministic, from approved facts) */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Evidence Basis</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Approved bank-facing facts used to ground this package.
          </Text>
          {evidenceBasis.length === 0 ? (
            <Text as="p" variant="bodyMd">(No bank-eligible facts available.)</Text>
          ) : (
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="100">
                {evidenceBasis.map((r, i) => (
                  <InlineStack key={i} gap="400" align="space-between" wrap={false}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.label}</Text>
                    <Text as="span" variant="bodySm">{r.value}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Box>
          )}
        </BlockStack>

        {/* Package Metadata block intentionally NOT rendered here.
            That section (Package ID / Evidence hash / Prompt family /
            Prompt version / Reason-code module / LLM model / Generated)
            is admin/operator audit data and must not appear on the
            merchant-facing embedded review page — same content surfaces
            in /admin/defence-package/runs/[id] for ops. Removed
            2026-05-16 after operator review caught it leaking. */}
      </BlockStack>
    </Card>
  );
}

function SectionBlock({
  title,
  thesis,
  section,
  omitted,
}: {
  title: string;
  thesis: string | null;
  section: NarrativeSection;
  omitted: boolean;
}) {
  if (omitted || !section.text.trim()) return null;
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingMd">{title}</Text>
      {thesis && <ThesisBox text={thesis} />}
      <Text as="p" variant="bodyMd">{section.text}</Text>
    </BlockStack>
  );
}

function ThesisBox({ text }: { text: string }) {
  return (
    <Box
      background="bg-surface-secondary"
      borderInlineStartWidth="050"
      borderColor="border-emphasis"
      padding="300"
    >
      <Text as="p" variant="bodySm" tone="subdued">
        {text}
      </Text>
    </Box>
  );
}

function CaseDetailsSection({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <BlockStack gap="200">
      <Button
        onClick={() => setOpen((v) => !v)}
        ariaExpanded={open}
        ariaControls="defence-pkg-case-details"
        disclosure={open ? "up" : "down"}
        variant="plain"
        textAlign="left"
      >
        Case Details
      </Button>
      <Collapsible
        id="defence-pkg-case-details"
        open={open}
        transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
        expandOnPrint
      >
        <Box
          background="bg-surface-secondary"
          borderRadius="200"
          padding="300"
        >
          <BlockStack gap="100">
            {rows.map(([k, v]) => (
              <InlineStack key={k} gap="400" align="space-between" wrap={false}>
                <Text as="span" variant="bodySm" tone="subdued">{k}</Text>
                <Text as="span" variant="bodySm">{v}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        </Box>
      </Collapsible>
    </BlockStack>
  );
}

// MetaRow helper removed alongside the Package Metadata block — it had
// no other callers.
