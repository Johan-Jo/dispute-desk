/**
 * Merchant asks registry (single-source plan section 5).
 *
 * WHY. Each card on the dispute page used to decide its own visibility, and the
 * record's action sentence knew only the review decision and the cardholder
 * acknowledgement. So a dispute whose parcel came back showed a REQUIRED card on
 * the Evidence tab while the Overview said "No action is required".
 *
 * WHAT. One ordered list of the things the merchant can be asked for on a
 * dispute, each with the gate that already existed for it - this module moves
 * no rule, it only names them in one place so the Overview, the hero action and
 * the cards read the same answer. It is computed server-side in
 * `enrichWorkspacePayload` and sent on the payload as `asks`.
 *
 * `offered` is exactly "the card/control would render" (server-knowable part).
 * Client-only conditions (building / regenerating / editing / collapsed, the
 * bank-claim card's local `saved`) stay in the component as render conditions.
 *
 * `pending` is "offered AND still waiting on the merchant": a bank claim that is
 * answered, a return question that is answered, or a review decision that is
 * already made is still offered (the card shows its collapsed, editable form)
 * but must not be the hero's call to action. The hero reads `offered && pending`.
 *
 * PURE - no DB, no I/O. No user-facing copy lives here; `askActionKey` returns an
 * existing i18n key (the ask's own title / action token).
 */

import {
  canOfferCardholderAcknowledgement,
  merchantSuppliedAcknowledgementFromItems,
  type EvidenceItemPayloadRow,
} from "@/lib/disputes/heldState";
import { canMerchantUpload } from "@/lib/disputes/presentation/concreteContribution";
import { MERCHANT_UI_HIDDEN_FIELDS } from "@/lib/automation/merchantUiHiddenFields";
import { isReviewMode, recordStatusOf, stageOf } from "@/lib/disputes/workspacePayload/recordStage";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";

export const ASK_IDS = [
  "review_decision",
  "bank_claim",
  "return_request",
  "missing_evidence",
  "gorgias_review",
  "cardholder_ack",
] as const;

export type AskId = (typeof ASK_IDS)[number];
export type AskPriority = "required" | "optional";

export interface Ask {
  id: AskId;
  priority: AskPriority;
  /** The card / control for this ask would render (server-knowable part of its gate). */
  offered: boolean;
  /** Offered AND still waiting on the merchant (not yet answered / decided). */
  pending: boolean;
  /**
   * The module that READS the merchant's answer to this ask and lets it change
   * a filing decision or a sentence of the response. A REQUIRED ask must name
   * one (a path under the repo root that exists): we do not ask the merchant
   * for something that cannot change the outcome. The returned-parcel question
   * was removed 2026-11-10 for exactly this: its answer reached no letter claim.
   * `tests/unit/merchantAsks.test.tsx` enforces it.
   */
  consumedBy: string | null;
}

/* ── Gates moved verbatim out of components ── */

/** `ReturnRequestCard`: the question is open for this dispute. */
export function returnRequestOffered(input: {
  applies: boolean | undefined;
  finalOutcome: string | null | undefined;
  submissionState: string | null | undefined;
}): boolean {
  if (!input.applies) return false;
  if (input.finalOutcome) return false;
  if (input.submissionState === "submitted_confirmed") return false;
  return true;
}

/** `BankClaimCard`: the dispute needs the bank's claim (`trigger` is set). */
export function bankClaimOffered(trigger: string | null | undefined): boolean {
  return (trigger ?? null) !== null;
}

/** `GorgiasCommsReviewSection`: an integration row exists and there is a run or a non-rejected ticket. */
export function gorgiasReviewOffered(
  comms: {
    latestRun: unknown;
    tickets: ReadonlyArray<{ matchStatus: string }>;
  } | null | undefined,
): boolean {
  if (!comms) return false;
  const visibleTickets = (comms.tickets ?? []).filter((tk) => tk.matchStatus !== "rejected_match");
  if (!comms.latestRun && visibleTickets.length === 0) return false;
  return true;
}

/**
 * `deriveMissingItems`: a checklist row is a merchant task when it is missing and
 * the merchant can upload it. (The two filters it applied inline; the hook now
 * calls this.)
 */
export function isMissingMerchantAction(c: { field: string; status: string; collectionType?: string }): boolean {
  return c.status === "missing" && canMerchantUpload(c);
}

/** `MissingOrWeakSection` renders when this list is non-empty (hidden fields excluded, as `useEvidenceSections` does). */
export function missingEvidenceOffered(
  checklist: ReadonlyArray<{ field: string; status: string; collectionType?: string }> | null | undefined,
): boolean {
  return (checklist ?? []).some((c) => isMissingMerchantAction(c) && !MERCHANT_UI_HIDDEN_FIELDS.has(c.field));
}

/* ── The registry ── */

export interface MerchantAskInputs {
  /** `record.canDecide`: the review decision control is on screen. */
  canDecide: boolean;
  /** The review decision is the page's call to action (review-mode package waiting, nothing chosen yet). */
  reviewPending: boolean;
  bankClaimTrigger: string | null | undefined;
  bankClaimAnswered: boolean;
  returnedToSender: boolean;
  evidenceItems: ReadonlyArray<EvidenceItemPayloadRow> | null | undefined;
  submissionState: string | null | undefined;
  finalOutcome: string | null | undefined;
  returnRequestApplies: boolean | undefined;
  returnRequestAnswered: boolean;
  checklist: ReadonlyArray<{ field: string; status: string; collectionType?: string }> | null | undefined;
  gorgiasComms: Parameters<typeof gorgiasReviewOffered>[0];
}

/** The ordered registry. Order is the order the hero and the Overview rank asks in. */
export function resolveMerchantAsks(i: MerchantAskInputs): Ask[] {
  const returnOffered = returnRequestOffered({
    applies: i.returnRequestApplies,
    finalOutcome: i.finalOutcome,
    submissionState: i.submissionState,
  });
  const bankOffered = bankClaimOffered(i.bankClaimTrigger);
  const missing = missingEvidenceOffered(i.checklist);
  const ack = canOfferCardholderAcknowledgement({
    merchantSuppliedAcknowledgement: merchantSuppliedAcknowledgementFromItems(i.evidenceItems),
    submissionState: i.submissionState,
    finalOutcome: i.finalOutcome,
  });
  const gorgias = gorgiasReviewOffered(i.gorgiasComms);
  return [
    {
      id: "review_decision",
      priority: "required",
      offered: i.canDecide,
      pending: i.canDecide && i.reviewPending,
      consumedBy: "lib/automation/merchantApprovalGate.ts",
    },
    {
      id: "bank_claim",
      priority: "required",
      offered: bankOffered,
      pending: bankOffered && !i.bankClaimAnswered,
      consumedBy: "lib/defence/counsel/briefs/index.ts",
    },
    {
      id: "return_request",
      priority: "required",
      offered: returnOffered,
      pending: returnOffered && !i.returnRequestAnswered,
      consumedBy: "lib/defence/counsel/creditNotProcessedLedger.ts",
    },
    { id: "missing_evidence", priority: "optional", offered: missing, pending: missing, consumedBy: null },
    // Informational: the review section lists conversations; it never names a task for the hero.
    { id: "gorgias_review", priority: "optional", offered: gorgias, pending: false, consumedBy: null },
    { id: "cardholder_ack", priority: "optional", offered: ack, pending: ack, consumedBy: null },
  ];
}

/** Read the registry's inputs off a (pre-enrichment) workspace payload and resolve it. */
export function merchantAsksFromPayload(data: WorkspaceData): Ask[] {
  const status = recordStatusOf(data);
  const stage = stageOf(data, status);
  const decided = status !== "open";
  const canDecide =
    !decided &&
    (data.presentation?.editable ?? false) &&
    (stage === "prepared_review" || stage === "held" || stage === "needs_attention");
  const decision = data.dispute.reviewState ?? null;
  return resolveMerchantAsks({
    canDecide,
    // Waiting on the merchant: a review-mode package (it stays "needs attention" while evidence is outstanding) with no choice made.
    reviewPending: (stage === "prepared_review" || stage === "needs_attention") && isReviewMode(data) && !(decision === "approved" || decision === "conceded" || decision === "in_review"),
    bankClaimTrigger: data.bankClaim?.trigger,
    bankClaimAnswered: (data.bankClaim?.answer ?? null) !== null,
    // The same read the cards make: the server assessment's returned-to-sender gate.
    returnedToSender: data.workspaceAssessment?.caseStrength?.returnedToSender?.triggered === true,
    evidenceItems: data.pack?.evidenceItems,
    submissionState: data.dispute.submissionState ?? null,
    finalOutcome: data.dispute.finalOutcome ?? null,
    returnRequestApplies: data.returnRequest?.applies,
    returnRequestAnswered: (data.returnRequest?.answer ?? null) !== null,
    checklist: data.pack?.checklistV2,
    gorgiasComms: data.gorgiasComms ?? null,
  });
}

/** True when `asks` offers `id`. An absent registry (a response from before it existed) offers nothing. */
export function isAskOffered(asks: ReadonlyArray<Ask> | null | undefined, id: AskId): boolean {
  return (asks ?? []).some((a) => a.id === id && a.offered);
}

/**
 * The ask the hero / Overview action names: the first offered, pending REQUIRED
 * ask; else the first offered, pending OPTIONAL ask that has an action sentence;
 * else null. Required beats optional whatever the order.
 */
export function primaryAsk(asks: ReadonlyArray<Ask>): Ask | null {
  const live = asks.filter((a) => a.offered && a.pending);
  return (
    live.find((a) => a.priority === "required") ??
    live.find((a) => a.priority === "optional" && askActionKey(a.id) !== null) ??
    null
  );
}

/**
 * The existing i18n key that names an ask as a call to action - the ask's own
 * card title, or the record's existing action sentence. No new merchant copy:
 * the copy rewrite is a separate step (single-source plan section 1 / dispute-status-copy).
 */
export function askActionKey(id: AskId): string | null {
  switch (id) {
    case "review_decision":
      return "disputes.record.action.review";
    case "bank_claim":
      return "disputes.bankClaim.title";
    case "return_request":
      return "disputes.evidenceTab.returnRequest.title";
    case "missing_evidence":
      return "disputes.record.action.evidence";
    case "cardholder_ack":
      return "disputes.record.action.ack";
    case "gorgias_review":
      return null;
  }
}
