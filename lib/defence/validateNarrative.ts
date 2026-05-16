/**
 * Narrative validation. Two-layer:
 *
 *   1. Forbidden-phrase regex (with narrow-mode additions).
 *   2. Claim guards from `claimGuards.ts` (fact-property predicates).
 *   3. `usedFactIds` referential integrity.
 *   4. `omittedSections` consistency.
 *
 * Fails closed. Failed validation blocks PDF render and submission.
 */

import { runClaimGuards } from "./claimGuards";
import type {
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

export function validateNarrative(input: ValidateNarrativeInput): ValidationResult {
  const errors: ValidationError[] = [];
  const approvedFactIds = new Set(input.approvedFacts.map((f) => f.id));
  const internalOnlyIds = new Set(input.internalOnlyFactIds ?? []);

  const sectionsForGuards: Record<NarrativeSectionKey, { text: string }> = {
    executiveSummary: { text: input.narrative.executiveSummary.text },
    transactionOverviewArgument: { text: input.narrative.transactionOverviewArgument.text },
    chronologyArgument: { text: input.narrative.chronologyArgument.text },
    paymentAuthenticationArgument: { text: input.narrative.paymentAuthenticationArgument.text },
    fulfillmentArgument: { text: input.narrative.fulfillmentArgument.text },
    communicationArgument: { text: input.narrative.communicationArgument.text },
    policyArgument: { text: input.narrative.policyArgument.text },
    manualEvidenceArgument: { text: input.narrative.manualEvidenceArgument.text },
    conclusion: { text: input.narrative.conclusion.text },
  };

  // 1. Forbidden phrases — per-section.
  for (const sectionKey of SECTION_KEYS) {
    const text = sectionsForGuards[sectionKey].text;
    if (!text) continue;
    for (const pattern of FORBIDDEN_PHRASES) {
      const match = text.match(pattern);
      if (match) {
        errors.push({
          section: sectionKey,
          rule: "forbidden_phrase",
          message: `Forbidden phrase "${match[0]}" in ${sectionKey}`,
          evidenceText: match[0],
        });
      }
    }
    if (input.packageMode === "narrow") {
      for (const pattern of NARROW_AGGRESSIVE_PHRASES) {
        const match = text.match(pattern);
        if (match) {
          errors.push({
            section: sectionKey,
            rule: "narrow_mode_aggressive_conclusion",
            message: `Aggressive phrasing "${match[0]}" not permitted in narrow-mode ${sectionKey}`,
            evidenceText: match[0],
          });
        }
      }
    }
  }

  // 2. Claim guards (fact-property predicates).
  const guardResult = runClaimGuards({
    narrativeSections: sectionsForGuards,
    approvedFacts: input.approvedFacts,
  });
  for (const failure of guardResult.failures) {
    errors.push({
      section: failure.section,
      rule: "unsupported_claim",
      message: `Unsupported claim in ${failure.section}: "${failure.matchedText}" — requires ${failure.requiredFact}`,
      evidenceText: failure.matchedText,
      requiredFact: failure.requiredFact,
      checkedFactIds: failure.checkedFactIds,
    });
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
        });
      }
      if (!approvedFactIds.has(id) && !internalOnlyIds.has(id)) {
        errors.push({
          section: sectionKey,
          rule: "unknown_fact_id",
          message: `${sectionKey} cites unknown fact id "${id}"`,
          evidenceText: id,
        });
      }
    }
  }

  // 4. omittedSections consistency: any section with empty text must appear
  // in omittedSections; any section in omittedSections must have empty text.
  const omittedKeys = new Set(input.narrative.omittedSections.map((o) => o.sectionKey));
  for (const sectionKey of SECTION_KEYS) {
    const text = sectionsForGuards[sectionKey].text.trim();
    if (text === "" && !omittedKeys.has(sectionKey)) {
      errors.push({
        section: sectionKey,
        rule: "omitted_section_inconsistent",
        message: `${sectionKey} has empty text but is not listed in omittedSections`,
      });
    }
    if (text !== "" && omittedKeys.has(sectionKey)) {
      errors.push({
        section: sectionKey,
        rule: "omitted_section_inconsistent",
        message: `${sectionKey} is listed in omittedSections but has non-empty text`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
