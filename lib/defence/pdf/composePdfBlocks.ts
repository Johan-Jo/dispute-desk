/**
 * Compose the prose blocks that reach the PDF.
 *
 * Phase 4 (this file): thesisText comes from fact-templated thesis
 * (renderThesis). Sections without LLM body fall back to the
 * deterministic fallback prose (only the fulfillment fallback exists
 * today). The block list IS the source of truth for what the renderer
 * writes — anything not in `composedBlocks` is dropped entirely.
 *
 * The composed-PDF validator (`validateComposedDocument`) runs
 * forbidden-phrase + claim-guard checks against every sub-text of
 * every block before the PDF is rendered.
 */

import { renderThesis } from "./renderThesis";
import { isSectionDeniedForModule } from "../sectionVisibility";
import { SECTION_ORDER, SECTION_TITLES } from "../render/sections";
import type {
  ComposedDocumentBlock,
  DefenceNarrativeOutput,
  EvidenceFact,
  PackageMode,
  ReasonCodeFamilyKey,
} from "../types";

// SECTION_HEADINGS lives in `lib/defence/render/sections.ts` as
// SECTION_TITLES — both renderers share the same map. Local alias for
// readability inside this file.
const SECTION_HEADINGS = SECTION_TITLES;

/** Hard-coded deterministic fallback prose. Currently only
 *  fulfillmentArgument has one — Phase 5 may add others on a per-
 *  family basis. Every fallback string MUST pass the composed
 *  validator just like any other prose. */
const FULFILLMENT_FALLBACK_TEXT =
  "The merchant's order record marks the order as fulfilled. " +
  "No separate delivery, access-use, or service-completion claim is " +
  "made in this section unless supported by approved evidence.";

export interface ComposePdfBlocksInput {
  narrative: DefenceNarrativeOutput;
  approvedFacts: EvidenceFact[];
  packageMode: PackageMode;
  familyKey: ReasonCodeFamilyKey;
  /** Reason-code module key (e.g. "visa_10_4_fraud"). Used to consult
   *  the per-module section deny list — sections deny-listed for this
   *  module are dropped from the output regardless of LLM emission. */
  moduleKey: string | null;
  fulfillmentStatus: string | null;
  /**
   * F6 — CANONICAL CLAIM AUTHORITY for the deterministic fulfilment fallback.
   *
   * When supplied, it REPLACES the raw-scalar test below. The scalar is
   * `orderContext.fulfillmentStatus`, read straight off `pack_json`, and on the
   * legacy path a bare `"FULFILLED"` is enough to write
   * `FULFILLMENT_FALLBACK_TEXT` into the issuer-facing document — a
   * deterministic sentence asserting fulfilment with no approved fact behind
   * it. The narrative claim guard covers the opposite case (UNFULFILLED with no
   * delivery fact) and says nothing about this one, so the scalar has been the
   * sole authority for that sentence.
   *
   * On the canonical route authority comes from the plan: an order fact the
   * plan included and the classifier deemed bank-citable, or a held
   * `delivery_occurred` capability. Undefined keeps the shipped behaviour
   * exactly, which is what makes the dark period a true no-op here.
   */
  fulfillmentClaimAuthority?: boolean;
}

export function composePdfBlocks(
  input: ComposePdfBlocksInput,
): ComposedDocumentBlock[] {
  const omittedKeys = new Set(
    input.narrative.omittedSections.map((o) => o.sectionKey),
  );
  const isFulfilled =
    input.fulfillmentClaimAuthority ??
    (typeof input.fulfillmentStatus === "string" &&
      input.fulfillmentStatus.toUpperCase() === "FULFILLED");

  const blocks: ComposedDocumentBlock[] = [];

  for (const sectionKey of SECTION_ORDER) {
    // Per-module section deny list — sections ruled out for this
    // reason code are dropped before any fallback/LLM logic runs.
    // See lib/defence/sectionVisibility.ts.
    if (isSectionDeniedForModule(sectionKey, input.moduleKey)) {
      continue;
    }

    const section = input.narrative[sectionKey];
    const llmText = section.text.trim();
    const sectionOmitted = omittedKeys.has(sectionKey);

    // Pick a deterministic fallback when one applies. Currently only
    // the fulfillment section has a fallback path (FULFILLED order
    // record with the LLM correctly refusing to overclaim delivery).
    let fallbackText = "";
    if (
      sectionKey === "fulfillmentArgument" &&
      (sectionOmitted || llmText === "") &&
      isFulfilled
    ) {
      fallbackText = FULFILLMENT_FALLBACK_TEXT;
    }

    const hasFallback = fallbackText.length > 0;
    const hasLlm = !sectionOmitted && llmText.length > 0;

    if (!hasFallback && !hasLlm) {
      // Section is completely absent from the rendered PDF — produce
      // no block. Renderer drops the heading too.
      continue;
    }

    // Thesis is only attached when the section ACTUALLY renders body
    // prose. Template returns "" when its required tokens don't
    // resolve — the renderer drops the blockquote entirely in that
    // case.
    const thesisText = renderThesis({
      sectionKey,
      familyKey: input.familyKey,
      packageMode: input.packageMode,
      approvedFacts: input.approvedFacts,
    });

    blocks.push({
      sectionKey,
      heading: SECTION_HEADINGS[sectionKey],
      thesisText,
      llmText: hasLlm ? llmText : "",
      fallbackText,
      usedFactIds: section.usedFactIds.slice(),
    });
  }

  return blocks;
}
