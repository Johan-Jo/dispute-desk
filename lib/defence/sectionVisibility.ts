/**
 * Section visibility — single source of truth for "which narrative
 * sections render for which reason-code module?"
 *
 * Both the PDF renderer (`lib/defence/pdf/DefencePackageDocument.tsx`)
 * and the embedded HTML view (`DefencePackageHtmlView.tsx`) consult
 * this helper so a section that's deny-listed for a module is hidden
 * everywhere by construction.
 *
 * The deny list is belt-and-suspenders. The reason-code module's
 * `promptBody` tells the LLM not to write the section, and the
 * narrative validator rejects forbidden phrases. This layer ensures
 * that even if a stale `narrative_json` row still carries the
 * section text from before the rule was added, the merchant and the
 * bank never see it.
 *
 * Why a separate module: keeping the deny list out of the
 * reason-code module file makes the rule visible to both renderers
 * without a circular import (the reason-code module is imported by
 * narrativeWriter; the renderers are not, and shouldn't be).
 */

import { familyKeyForModule } from "./reasonCodes/familyRegistry";
import type {
  DefenceNarrativeOutput,
  NarrativeSectionKey,
  ReasonCodeFamilyKey,
  ReasonCodeModuleKey,
} from "./types";

/**
 * Sections deny-listed per reason-code module key. Sections in the
 * list are NEVER rendered for that module, regardless of whether the
 * LLM emitted text. The `omittedSections` entry the LLM produced
 * (when it followed the prompt rule) is the canonical signal; this
 * deny list catches the stale-row case.
 */
const SECTION_DENY_BY_MODULE: Record<string, NarrativeSectionKey[]> = {
  // For unauthorized-fraud (Visa 10.4 / MC 4837) the dispute hinges
  // on cardholder authentication, not the merchant's published
  // terms. Refund/shipping/cancellation policies do not refute the
  // claim; surfacing them in the bank-facing argument is dead
  // weight that distracts from the AVS/CVV/3DS story.
  visa_10_4_fraud: ["policyArgument"],
};

/**
 * Sections deny-listed for every module of a family.
 *
 * Item not received (2026-09-24, review of #352543): the transaction
 * overview and the paragraph above the timeline only restated the delivery
 * the summary and the shipping section already state — the same assertion
 * appeared six times in one letter. The case details carry the transaction
 * and the timeline speaks for itself. Multi-parcel letters dropped both
 * already (lib/defence/shipmentRecordSections.ts).
 */
const SECTION_DENY_BY_FAMILY: Partial<Record<ReasonCodeFamilyKey, NarrativeSectionKey[]>> = {
  item_not_received: ["transactionOverviewArgument", "chronologyArgument"],
};

export function sectionsDeniedForFamily(familyKey: ReasonCodeFamilyKey | null | undefined): NarrativeSectionKey[] {
  return familyKey ? SECTION_DENY_BY_FAMILY[familyKey] ?? [] : [];
}

export function isSectionDeniedForModule(
  sectionKey: NarrativeSectionKey,
  moduleKey: string | null | undefined,
): boolean {
  if (!moduleKey) return false;
  if ((SECTION_DENY_BY_MODULE[moduleKey] ?? []).includes(sectionKey)) return true;
  let familyKey: ReasonCodeFamilyKey | null = null;
  try {
    familyKey = familyKeyForModule(moduleKey as ReasonCodeModuleKey);
  } catch {
    familyKey = null;
  }
  return sectionsDeniedForFamily(familyKey).includes(sectionKey);
}

const NARRATIVE_SECTION_KEYS: NarrativeSectionKey[] = [
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

/**
 * Empty every section deny-listed for this module BEFORE the narrative is
 * validated: a sentence the document will never print must not be able to
 * fail it. The emptied sections are recorded in `omittedSections`.
 */
export function omitDeniedSections(
  narrative: DefenceNarrativeOutput,
  moduleKey: string | null | undefined,
): DefenceNarrativeOutput {
  const denied = NARRATIVE_SECTION_KEYS.filter((k) => isSectionDeniedForModule(k, moduleKey));
  if (denied.length === 0) return narrative;
  const out: DefenceNarrativeOutput = { ...narrative };
  const prior = narrative.omittedSections ?? [];
  const already = new Set(prior.map((o) => o.sectionKey));
  const omittedSections = [...prior];
  for (const k of denied) {
    out[k] = { text: "", usedFactIds: [] };
    if (!already.has(k)) {
      omittedSections.push({ sectionKey: k, reason: "Not rendered for this reason code." });
    }
  }
  out.omittedSections = omittedSections;
  return out;
}
