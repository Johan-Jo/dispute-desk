/**
 * Evidence line-item derivation — single source of truth for per-row
 * dispute-detail UI state.
 *
 * Stub introduced by commit 1 (front-loaded tests). The full derivation
 * lands in commit 2 alongside the fraud decisive-signal filter. Until
 * then, the function throws on call so the `it.fails(...)` tests can
 * exercise the import path without flipping green prematurely.
 *
 * Plan: C:\Users\johan\.claude\plans\do-a-plan-for-scalable-parrot.md
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { EvidenceFact } from "@/lib/defence/types";
import type { CaseStrengthContribution } from "./caseStrength";
import type { ReasonFamily } from "./reasonFamily";

export type StrengthContribution =
  | "strong"
  | "moderate"
  | "supporting"
  | "internal_only"
  | "none";

export type SubmissionMethod =
  | "bank_argument"
  | "context_only"
  | "internal_only"
  | "not_included"
  | "not_supported"
  | "excluded"
  | "failed_upload"
  | "waived";

export type EvidenceSource =
  | "shopify"
  | "merchant_upload"
  | "carrier"
  | "helpdesk"
  | "derived"
  | "manual";

export interface EvidenceLineItem {
  id: string;
  field: string;
  label: string;
  source: EvidenceSource;
  hasEvidence: boolean;
  strengthContribution: StrengthContribution;
  bankEligible: boolean;
  merchantVisible: boolean;
  /** True iff `submissionMethod ∈ {bank_argument, context_only}`. */
  includedInDefencePackage: boolean;
  /** True iff `submissionMethod === "bank_argument" && bankEligible && !isNegativeOrAmbiguous`. */
  includedInBankArgument: boolean;
  /** True iff `includedInBankArgument && strengthContribution ∈ {strong, moderate} && includeInBankNarrative`. */
  usedAsPositiveBankEvidence: boolean;
  submittedToShopify: boolean;
  submissionMethod: SubmissionMethod;
  isNegativeOrAmbiguous: boolean;
  reason: string;
}

export interface DeriveEvidenceLineItemsInput {
  checklist: ChecklistItemV2[];
  facts: EvidenceFact[];
  payloadByField: Map<string, unknown>;
  contributions: { strong: CaseStrengthContribution[]; moderate: CaseStrengthContribution[] };
  packSavedToShopify: boolean;
  excludedFields: Set<string>;
  attachmentUploadFailures: Map<string, string>;
  inclusionOverrides: Map<string, "force_include" | "force_exclude">;
  reasonFamily: ReasonFamily;
}

/**
 * STUB — full implementation in commit 2.
 *
 * Returns an empty array so `it.fails` tests reach their assertions
 * (they currently fail by design until the real derivation lands).
 */
export function deriveEvidenceLineItems(
  _args: DeriveEvidenceLineItemsInput,
): EvidenceLineItem[] {
  return [];
}
