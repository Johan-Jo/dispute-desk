/**
 * Baseline for rawReadScan.test.ts (single-source architecture audit, PR 3).
 *
 * Every existing raw read of the return/refund record in a merchant-facing root
 * is listed here with WHY it is legitimate, or flagged "open" when it is a known
 * independent second reader. Keys are line-agnostic: file + pattern + count.
 *
 * To update: a new hit should be routed through the single source
 * (lib/packs/effectiveChecklist.ts, lib/packs/noReturnApplicability.ts,
 * lib/disputes/refundStatement.ts) rather than added here. Add an entry only for
 * a legitimate reader, with a real reason. Delete entries whose hit disappears
 * (the test fails on stale entries). A changed count is a changed entry: re-justify.
 */
import type { ScanPattern } from "./rawReadScan";

export type BaselineCategory =
  | "single-source" // the resolver/assembler itself
  | "write-path" // reads the stored row to patch it, never to interpret for display
  | "fact-side" // fact/strength/analysis layer, left alone by the plan
  | "taxonomy" // field-key registry / label map, not a verdict
  | "open"; // known independent second reader of merchant copy

export interface BaselineEntry {
  file: string;
  pattern: ScanPattern;
  count: number;
  category: BaselineCategory;
  reason: string;
}

const patchReason =
  "Write path: reads the stored pack row only to patch checklist_v2 in place after a merchant action; the result is not interpreted for display.";

export const BASELINE: BaselineEntry[] = [
  // --- single-source modules themselves ---
  { file: "lib/disputes/refundStatement.ts", pattern: "totals.refunded", count: 4, category: "single-source", reason: "The single refund-statement reader of order.totals.refunded for merchant copy (plan 3.3); it is the source, not a bypass." },
  { file: "lib/disputes/orderSituation.ts", pattern: "returnStatus", count: 4, category: "single-source", reason: "The single resolver of Order.returnStatus into a return situation; other surfaces should consume resolveOrderSituation." },
  { file: "lib/disputes/orderSituation.ts", pattern: "totals.refunded", count: 1, category: "single-source", reason: "orderSituationFromPackSections extracts the stored refunded total once to feed resolveOrderSituation (same resolver as above)." },
  { file: "lib/disputes/returnRequestConfirmation.ts", pattern: "returnStatus", count: 8, category: "single-source", reason: "Return-on-record verdicts (shopifyRecordsReturnOrRefund, noReturnFactVerdict); they delegate to resolveOrderSituation rather than re-interpreting the status." },
  { file: "lib/disputes/returnRequestConfirmation.ts", pattern: "totals.refunded", count: 1, category: "single-source", reason: "Extracts the stored refunded total from pack sections and hands it to resolveOrderSituation; no independent interpretation." },
  { file: "lib/disputes/presentation/concreteContribution.ts", pattern: "literal:no_return_initiated", count: 1, category: "single-source", reason: "Member of NEVER_MERCHANT_UPLOADABLE, the single answer to whether a merchant can supply this field." },

  // --- checklist_v2 reads ---
  { file: "app/api/packs/[packId]/cardholder-acknowledgement/route.ts", pattern: "select:checklist_v2", count: 1, category: "write-path", reason: patchReason },
  { file: "app/api/packs/[packId]/parcel-outcome/route.ts", pattern: "select:checklist_v2", count: 1, category: "write-path", reason: patchReason },
  { file: "app/api/packs/[packId]/upload/route.ts", pattern: "select:checklist_v2", count: 1, category: "write-path", reason: patchReason },
  { file: "app/api/packs/[packId]/waive/route.ts", pattern: "select:checklist_v2", count: 2, category: "write-path", reason: patchReason },
  { file: "app/api/packs/[packId]/inclusion-override/route.ts", pattern: "select:checklist_v2", count: 1, category: "write-path", reason: "Reads the stored checklist and passes it to assembleEffectiveChecklist (storedChecklist) around the override; goes through the single assembler." },
  { file: "lib/disputes/presentation/serverFacts.ts", pattern: "select:checklist_v2", count: 1, category: "fact-side", reason: "Feeds recommended/opportunity resolution in the dispute-list presentation resolver, which states no return/refund verdict (plan 4); fact-side reader left alone." },

  // --- fact-side / taxonomy ---
  { file: "lib/argument/canonicalEvidence.ts", pattern: "literal:no_return_initiated", count: 1, category: "taxonomy", reason: "Field-key registry entry mapping no_return_initiated to the refund signal for strength; the fact-side model, not a merchant-copy verdict." },
  { file: "lib/disputes/bankClaimAnalysis.ts", pattern: "literal:no_return_initiated", count: 1, category: "fact-side", reason: "Removes the no-return fact from the bank-facing analysis when the bank claims a return was requested; bank-side logic outside merchant copy." },
  { file: "lib/disputes/decidedView.ts", pattern: "literal:no_return_initiated", count: 2, category: "fact-side", reason: "Decided-view checklist row for no-return; honours the assembler's inapplicable list instead of re-deriving it, only mapping field presence to a row." },
  { file: "lib/disputes/decidedView.ts", pattern: "literal:noReturn", count: 1, category: "taxonomy", reason: "Row key passed to had(); a label key for the decided-view checklist, not a verdict." },

  // --- known independent second readers ---
  { file: "lib/argument/refundPresentation.ts", pattern: "returnStatus", count: 1, category: "open", reason: "OPEN: presentation reads the no_return_initiated payload's returnStatus === NO_RETURN itself instead of the single resolver; tracked for PR 5 (gated by the fact being emitted)." },
  { file: "app/api/disputes/[id]/workspace/route.ts", pattern: "totals.refunded", count: 1, category: "open", reason: "OPEN: workspace payload exposes refundedAmount read raw from totals.refunded beside refundStatement, a second reader plan 3.3 says should not exist; tracked for PR 5." },
  { file: "components/packs/detail/EvidenceContentViewer.tsx", pattern: "totals.refunded", count: 3, category: "open", reason: "OPEN: evidence viewer renders the order section's Refunded row straight from payload.totals.refunded, not routed through refundStatement; tracked for PR 5." },
];
