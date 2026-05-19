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

import type { NarrativeSectionKey } from "./types";

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

export function isSectionDeniedForModule(
  sectionKey: NarrativeSectionKey,
  moduleKey: string | null | undefined,
): boolean {
  if (!moduleKey) return false;
  return (SECTION_DENY_BY_MODULE[moduleKey] ?? []).includes(sectionKey);
}
