/**
 * Narrative validation — runs the same safety contract over LLM output
 * and (Phase 1.5+) every other prose layer that reaches the rendered
 * PDF.
 *
 *   1. Forbidden-phrase regex (with narrow-mode additions)
 *   2. Claim guards from `claimGuards.ts` (fact-property predicates)
 *   3. `usedFactIds` referential integrity (narrative only)
 *   4. `omittedSections` consistency       (narrative only)
 *
 * Fails closed. Failed validation blocks PDF render and submission.
 *
 * Two entry points:
 *   - `validateNarrative` — the historical contract over the LLM's
 *     JSON output, with all four layers.
 *   - `validateComposedDocument` — Phase 1.5; runs layers (1) and (2)
 *     over every sub-text of every block, tagging each failure with
 *     the originating layer ("thesis" | "llm" | "fallback") so
 *     `failure_reason` can route the operator to the right place.
 */

import { runClaimGuards } from "./claimGuards";
import type {
  ComposedDocumentBlock,
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
  PackageMode,
  ReasonCodeGuidance,
  ValidationError,
  ValidationResult,
} from "./types";

export const FORBIDDEN_PHRASES = [
  /\birrefutable\b/i,
  /\bdefinitive\s+proof\b/i,
  /\bdefinitively\s+prov\w+/i,
  /\bdefinitively\s+show\w*\s+authori[sz]ation\b/i,
  /\bundeniable\b/i,
  /\bprovably\b/i,
  /\bunequivocal\w*/i,
  /\bbaseless\b/i,
  /\binvalidat\w*\s+(?:the\s+claim|any\s+claim)\b/i,
  /\bfraudulent\s+cardholder\b/i,
  /\bliar\b/i,
  /\blying\b/i,
  // Absolute authorization conclusions — soften to "strongly supports",
  // "is consistent with", "supports the conclusion that".
  /\bestablishes\s+(?:that\s+)?the\s+transaction\s+was\s+authori[sz]ed\b/i,
  /\bproves\s+(?:that\s+)?the\s+transaction\s+was\s+authori[sz]ed\b/i,
  /\bconfirms\s+(?:that\s+)?the\s+transaction\s+was\s+authori[sz]ed\b/i,
  // Physical-card-possession claims — never safe in card-absent disputes
  // without an explicit card-present approved fact (none exist today).
  /\bpossession\s+of\s+the\s+(?:physical\s+)?card\b/i,
  /\bhad\s+the\s+physical\s+card\b/i,
  /\bheld\s+the\s+card\b/i,
  /\bcard\s+was\s+physically\s+present\b/i,
];

export const NARROW_AGGRESSIVE_PHRASES = [
  /\bthe\s+dispute\s+is\s+invalid\b/i,
  /\bthis\s+is\s+(clearly\s+)?not\s+fraud\b/i,
  /\bcardholder\s+is\s+lying\b/i,
];

const SECTION_KEYS: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

export interface ValidateNarrativeInput {
  narrative: DefenceNarrativeOutput;
  approvedFacts: EvidenceFact[];
  reasonCodeModule: ReasonCodeGuidance;
  packageMode: PackageMode;
  internalOnlyFactIds?: string[];
}

/** Shared phrase + guard check for any single piece of prose. The layer
 *  argument is propagated onto each emitted ValidationError so composed
 *  failures can be routed by source ("thesis" / "llm" / "fallback") in
 *  failure_reason. */
export interface RunPhraseAndGuardChecksInput {
  text: string;
  sectionKey: NarrativeSectionKey;
  approvedFacts: EvidenceFact[];
  packageMode: PackageMode;
  layer: "narrative" | "thesis" | "llm" | "fallback";
}

export function runPhraseAndGuardChecks(
  input: RunPhraseAndGuardChecksInput,
): ValidationError[] {
  const { text, sectionKey, approvedFacts, packageMode, layer } = input;
  const errors: ValidationError[] = [];
  if (!text || !text.trim()) return errors;

  // 1. Forbidden phrases (and narrow-mode additions).
  for (const pattern of FORBIDDEN_PHRASES) {
    const match = text.match(pattern);
    if (match) {
      errors.push({
        section: sectionKey,
        rule: "forbidden_phrase",
        message: `Forbidden phrase "${match[0]}" in ${sectionKey}`,
        evidenceText: match[0],
        layer,
      });
    }
  }
  if (packageMode === "narrow") {
    for (const pattern of NARROW_AGGRESSIVE_PHRASES) {
      const match = text.match(pattern);
      if (match) {
        errors.push({
          section: sectionKey,
          rule: "narrow_mode_aggressive_conclusion",
          message: `Aggressive phrasing "${match[0]}" not permitted in narrow-mode ${sectionKey}`,
          evidenceText: match[0],
          layer,
        });
      }
    }
  }

  // 2. Claim guards (fact-property predicates).
  const guardResult = runClaimGuards({
    narrativeSections: {
      [sectionKey]: { text },
    } as Record<NarrativeSectionKey, { text: string }>,
    approvedFacts,
  });
  for (const failure of guardResult.failures) {
    errors.push({
      section: failure.section,
      rule: "unsupported_claim",
      message: `Unsupported claim in ${failure.section}: "${failure.matchedText}" — requires ${failure.requiredFact}`,
      evidenceText: failure.matchedText,
      requiredFact: failure.requiredFact,
      checkedFactIds: failure.checkedFactIds,
      layer,
    });
  }

  return errors;
}

export function validateNarrative(input: ValidateNarrativeInput): ValidationResult {
  const errors: ValidationError[] = [];
  const approvedFactIds = new Set(input.approvedFacts.map((f) => f.id));
  const internalOnlyIds = new Set(input.internalOnlyFactIds ?? []);

  // 1 + 2. Forbidden phrases + claim guards — per-section.
  for (const sectionKey of SECTION_KEYS) {
    const text = input.narrative[sectionKey].text;
    errors.push(
      ...runPhraseAndGuardChecks({
        text,
        sectionKey,
        approvedFacts: input.approvedFacts,
        packageMode: input.packageMode,
        layer: "narrative",
      }),
    );
  }

  // 3. usedFactIds referential integrity + no internal-only references.
  for (const sectionKey of SECTION_KEYS) {
    const section = input.narrative[sectionKey];
    for (const id of section.usedFactIds) {
      if (internalOnlyIds.has(id)) {
        errors.push({
          section: sectionKey,
          rule: "internal_only_fact_referenced",
          message: `${sectionKey} cites internal-only fact id "${id}"`,
          evidenceText: id,
          layer: "narrative",
        });
      }
      if (!approvedFactIds.has(id) && !internalOnlyIds.has(id)) {
        errors.push({
          section: sectionKey,
          rule: "unknown_fact_id",
          message: `${sectionKey} cites unknown fact id "${id}"`,
          evidenceText: id,
          layer: "narrative",
        });
      }
    }
  }

  // 4. omittedSections consistency: any section with empty text must appear
  // in omittedSections; any section in omittedSections must have empty text.
  const omittedKeys = new Set(input.narrative.omittedSections.map((o) => o.sectionKey));
  for (const sectionKey of SECTION_KEYS) {
    const text = input.narrative[sectionKey].text.trim();
    if (text === "" && !omittedKeys.has(sectionKey)) {
      errors.push({
        section: sectionKey,
        rule: "omitted_section_inconsistent",
        message: `${sectionKey} has empty text but is not listed in omittedSections`,
        layer: "narrative",
      });
    }
    if (text !== "" && omittedKeys.has(sectionKey)) {
      errors.push({
        section: sectionKey,
        rule: "omitted_section_inconsistent",
        message: `${sectionKey} is listed in omittedSections but has non-empty text`,
        layer: "narrative",
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Composed-document validator (Phase 1.5) ──────────────────────────

export interface ValidateComposedDocumentInput {
  blocks: ComposedDocumentBlock[];
  approvedFacts: EvidenceFact[];
  packageMode: PackageMode;
}

/** Run forbidden-phrase + claim-guard checks against every sub-text of
 *  every composed block. Each ValidationError carries `layer` so the
 *  job handler can write a precise failure_reason such as
 *  `composed:thesis "<phrase>" in <sectionKey>`.
 *
 *  This is the literal enforcement of the safety contract on every byte
 *  of argumentative prose that reaches the PDF — see PRD §8. */
export function validateComposedDocument(
  input: ValidateComposedDocumentInput,
): ValidationResult {
  const errors: ValidationError[] = [];
  for (const block of input.blocks) {
    errors.push(
      ...runPhraseAndGuardChecks({
        text: block.thesisText,
        sectionKey: block.sectionKey,
        approvedFacts: input.approvedFacts,
        packageMode: input.packageMode,
        layer: "thesis",
      }),
    );
    errors.push(
      ...runPhraseAndGuardChecks({
        text: block.llmText,
        sectionKey: block.sectionKey,
        approvedFacts: input.approvedFacts,
        packageMode: input.packageMode,
        layer: "llm",
      }),
    );
    errors.push(
      ...runPhraseAndGuardChecks({
        text: block.fallbackText,
        sectionKey: block.sectionKey,
        approvedFacts: input.approvedFacts,
        packageMode: input.packageMode,
        layer: "fallback",
      }),
    );
  }
  return { ok: errors.length === 0, errors };
}

/** Build a human-readable summary suitable for `failure_reason`. Lists
 *  up to 3 errors with their layer + section + evidence text. */
export function summariseComposedErrors(errors: ValidationError[]): string {
  const head = errors.slice(0, 3).map((e) => {
    const layer = e.layer ?? "narrative";
    const ev = e.evidenceText ? ` "${e.evidenceText}"` : "";
    return `composed:${layer} ${e.section}${ev}`;
  });
  const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";
  return `${errors.length} composed validation error${errors.length === 1 ? "" : "s"}: ${head.join("; ")}${more}`;
}
