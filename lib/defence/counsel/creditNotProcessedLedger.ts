/**
 * The claim ledger for credit-not-processed letters.
 *
 * The analyst's question is "is a refund or credit outstanding on this order?".
 * The only strong fact the store holds is the absence of a return in Shopify,
 * so the ledger exists to let a letter say it: before this ledger the type fell
 * to the general brief, which has no such claim (cay-collective #17615,
 * 2026-10-30).
 *
 * The sequence claims (order placed, shipped, delivered, dispute opened) are
 * the not-as-described ledger's own, from the same builder; only the claims
 * that belong to that type are dropped, and the three that belong to this one
 * are added. What this ledger never lets a letter say: that no refund was owed,
 * what the customer asked or failed to do, what the refund policy requires, or
 * that the customer accepted it.
 */

import { MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE } from "@/lib/disputes/returnRequestConfirmation";
import type { InternalNarrativeConstraints } from "../internalConstraints";
import { buildNotAsDescribedLedger } from "./notAsDescribedLedger";
import type { LedgerClaim, LedgerInput } from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface CreditNotProcessedExtras {
  /** Stored-message constraints (Gorgias); a return or refund asked for in a
   *  stored message withholds the no-return line. */
  constraints?: Pick<InternalNarrativeConstraints, "returnRequested" | "refundOrCompensationRequested"> | null;
}

/** Claims the not-as-described builder makes that are not this type's. */
const NOT_THIS_TYPE = new Set([
  "claim_is_not_as_described",
  "listing_published",
  "order_specified",
  "shipped_as_ordered",
  "return_route_open",
  "no_return_recorded",
  "merchant_confirmed_no_request",
]);

export function buildCreditNotProcessedLedger(input: LedgerInput, extras: CreditNotProcessedExtras = {}): LedgerClaim[] | null {
  const sections = input.packSections;
  const shared = (buildNotAsDescribedLedger(input, { constraints: extras.constraints ?? null }) ?? []).filter(
    (c) => !NOT_THIS_TYPE.has(c.id),
  );

  const claims: LedgerClaim[] = [
    {
      id: "claim_is_credit_not_processed",
      statement: "The claim is that a refund or credit owed to the customer was not processed.",
      specifics: {},
      weight: "core",
      sources: ["dispute.reason"],
      mustNot: ["Never say or imply that a refund was or was not owed, and never say a refund was issued or is pending."],
    },
    ...shared,
  ];

  // ── The recorded absence: the argument itself ──
  // Only when the collector emitted `no_return_initiated`, which it does only
  // when no refund exists on the order: with a refund on record, "no return"
  // would answer a different dispute (module guidance: never speculate about
  // returns).
  const absenceFact = input.facts.find((f) => f.category === "no_return_initiated");
  const returnStatus = sections.map((s) => str(obj(s?.data)?.returnStatus)).find(Boolean) ?? null;
  const returnAsked = !!extras.constraints?.returnRequested || !!extras.constraints?.refundOrCompensationRequested;
  if (absenceFact && returnStatus === "NO_RETURN" && !returnAsked) {
    claims.push({
      id: "no_return_recorded",
      statement: "No return has been recorded in Shopify for this order.",
      specifics: {},
      weight: "strong",
      sources: [absenceFact.id, "pack.order.returnStatus"],
      mustNot: [
        "State it in the claim's own words, in a sentence of its own with no date or timing word. It belongs in the summary and, at most once more, in the conclusion; never in a section.",
        "Never say the customer did not return, did not try to return, never asked to return or did not request a return: Shopify does not see requests made by email or chat.",
      ],
    });
    // The merchant confirmed on this dispute that no request came in:
    // verbatim, attributed to the merchant, right after the no-return sentence.
    if (sections.some((s) => obj(s?.data)?.merchantConfirmedNoRequest === true)) {
      claims.push({
        id: "merchant_confirmed_no_request",
        statement: MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE,
        specifics: {},
        weight: "strong",
        sources: ["dispute_return_request_confirmations.answer"],
        mustNot: [
          "State it once, verbatim, right after the no-return sentence. Never paraphrase it, never extend it to other channels or times.",
        ],
      });
    }
  }

  // ── The refund policy: published, and nothing more ──
  const policy = input.facts.find((f) => f.category === "policy_refund" && obj(f.value)?.publishedOnStore === true);
  if (policy) {
    claims.push({
      id: "refund_policy_published",
      statement: "The store's refund policy is published on the store.",
      specifics: {},
      weight: "supporting",
      sources: [policy.id],
      mustNot: [
        "Say only that the policy is published on the store. Never say what it requires, offers or excludes, and never that the customer agreed to or accepted it.",
      ],
    });
  }

  // A letter needs more than the claim itself.
  return claims.length > 1 ? claims : null;
}
