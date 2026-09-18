/**
 * Drop argument sections whose every supporting fact is withheld from the
 * Evidence Basis.
 *
 * ── The defect ──
 *
 * A section declares the facts it argues from in `usedFactIds`. The Evidence
 * Basis lists only facts `isBankIncludedFact` admits. When those two disagree
 * completely, the issuer reads an argument and finds nothing under it.
 *
 * Measured on the 50 decided prod disputes carrying a filed package: 51 such
 * sections across 27 cases, concentrated in `paymentAuthenticationArgument`
 * (24) and `transactionOverviewArgument` (20). The second is now largely
 * closed — `same_country` IP became citable in 2026-08-31's tier fix, so those
 * sections gain real support rather than needing removal. The first is not, and
 * cannot be: on a failed AVS the address half is deliberately never rendered
 * (non-disclosure), so a payment-authentication argument resting only on it can
 * never acquire support. The only honest options are to say nothing or to say
 * something unbacked.
 *
 * ── Why suppression rather than the blocking flag ──
 *
 * `SUPPORT_CITABILITY_BLOCKING` in validateNarrative.ts is the other lever, and
 * its doc comment explains why it stays false: a validation error means
 * `status: "failed"`, no PDF, and the merchant files NOTHING. Filing nothing is
 * strictly worse than filing a letter with one paragraph missing.
 *
 * This module is the third option that comment asks for — "the sections are
 * omitted at generation rather than failed at validation". It runs BEFORE
 * validateNarrative, so by the time the validator looks, the section is a
 * legitimate `omittedSection` and neither rule 4 (omission consistency) nor
 * rule 5 (citability) has anything to report.
 *
 * It is deterministic: no re-prompt, no second model call. Regenerating to fix
 * this would spend budget asking a model to avoid facts we can simply decline
 * to print.
 *
 * ── Two things it deliberately will not do ──
 *
 * 1. It never touches `executiveSummary` or `conclusion`. Those summarise the
 *    letter rather than carrying an independent argument, and a defence letter
 *    with no opening and no closing reads as truncated — a worse artefact than
 *    one whose summary leans on a fact listed further down. They keep the
 *    existing warning.
 *
 * 2. It never empties the letter. If suppression would remove every remaining
 *    argument section, it suppresses nothing and lets the warnings stand. A
 *    letter of pure boilerplate is the "filed nothing" outcome wearing a PDF,
 *    and the same reasoning that keeps the blocking flag off applies here.
 */

import { isBankIncludedFact } from "./bankInclusion";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
  OmittedSection,
} from "./types";

/**
 * Sections carrying an independent argument. Suppressing one of these removes a
 * claim; suppressing a summary would remove the letter's shape.
 */
const ARGUMENT_SECTIONS: readonly NarrativeSectionKey[] = [
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
];

/** Recorded on the omission so a reader knows this was a rule, not a gap. */
export const SUPPRESSION_REASON =
  "Every fact this section argued from is withheld from the Evidence Basis, so the argument would reach the issuer with no listed evidence behind it.";

export interface SuppressionResult {
  narrative: DefenceNarrativeOutput;
  /** Sections removed, in section order. Empty when nothing was suppressed. */
  suppressed: NarrativeSectionKey[];
  /**
   * True when suppression was declined because it would have emptied the
   * letter. The sections stay, and validateNarrative still warns about them.
   */
  declinedToEmptyLetter: boolean;
}

export function suppressUnsupportedSections(input: {
  narrative: DefenceNarrativeOutput;
  approvedFacts: readonly EvidenceFact[];
  internalOnlyFactIds?: readonly string[];
}): SuppressionResult {
  const internalOnly = new Set(input.internalOnlyFactIds ?? []);

  // THE bank-inclusion predicate, not a local re-spelling of it. C-1 exists
  // because two spellings of this rule drifted (lib/defence/bankInclusion.ts).
  const citable = new Set(
    input.approvedFacts
      .filter((f) => !internalOnly.has(f.id))
      .filter(isBankIncludedFact)
      .map((f) => f.id),
  );

  const unsupported: NarrativeSectionKey[] = [];
  for (const key of ARGUMENT_SECTIONS) {
    const section = input.narrative[key];
    if (!section || !section.text.trim()) continue;
    // A section citing nothing is a different defect (rule 3 territory) and is
    // not this module's to judge.
    if (section.usedFactIds.length === 0) continue;
    if (section.usedFactIds.some((id) => citable.has(id))) continue;
    unsupported.push(key);
  }

  if (unsupported.length === 0) {
    return { narrative: input.narrative, suppressed: [], declinedToEmptyLetter: false };
  }

  // Would anything argumentative survive?
  const survivors = ARGUMENT_SECTIONS.filter((key) => {
    if (unsupported.includes(key)) return false;
    return Boolean(input.narrative[key]?.text.trim());
  });
  if (survivors.length === 0) {
    return {
      narrative: input.narrative,
      suppressed: [],
      declinedToEmptyLetter: true,
    };
  }

  const alreadyOmitted = new Set(
    input.narrative.omittedSections.map((o) => o.sectionKey),
  );

  const next: DefenceNarrativeOutput = { ...input.narrative };
  for (const key of unsupported) {
    // Empty text + an omittedSections entry is the shape rule 4 requires; any
    // other combination is itself a validation error.
    next[key] = { text: "", usedFactIds: [] };
  }
  next.omittedSections = [
    ...input.narrative.omittedSections,
    ...unsupported
      .filter((key) => !alreadyOmitted.has(key))
      .map<OmittedSection>((sectionKey) => ({
        sectionKey,
        reason: SUPPRESSION_REASON,
      })),
  ];

  return { narrative: next, suppressed: unsupported, declinedToEmptyLetter: false };
}
