/**
 * What the bank's claim actually disputes — read once, used to steer the
 * letter (plan docs/plans/bank-claim-capture.plan.md, "answer the claim").
 *
 * The Sura Svenne test (2026-09-27) showed that passing the claim to the
 * writer as context is not enough: on a `general` dispute the generic
 * template and the approved facts still won, and the letter argued card
 * authorisation — which the claim said was not in dispute — and asserted
 * "no return has been initiated", which the claim contradicted. So the claim
 * now changes INPUTS, not just instructions:
 *
 *   - `reason`   → the reason template the letter is written from, and the
 *                  evidence checklist the merchant is asked to complete,
 *                  when Shopify's own reason is `GENERAL` / unmapped;
 *   - `authorizationDisputed === false`
 *                → card-authorisation facts are removed from the facts the
 *                  writer may cite (the bank says that point is settled);
 *   - `returnOrRefundRequested === true`
 *                → the "no return initiated" fact is removed (the claim
 *                  contradicts it; asserting it would be false).
 *
 * Deterministic filtering, not a prompt request: a fact the writer is not
 * given cannot be cited, and the citation validator rejects anything else.
 */

import { callClaudeMessages } from "@/lib/defence/anthropicClient";
import type { EvidenceFactCategory } from "@/lib/defence/types";
import { parseJson } from "@/lib/defence/modelJson";

export const BANK_CLAIM_REASONS = [
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "CREDIT_NOT_PROCESSED",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "FRAUDULENT",
  "GENERAL",
] as const;
export type BankClaimReason = (typeof BANK_CLAIM_REASONS)[number];

export interface BankClaimAnalysis {
  /** The dispute category the claim describes (Shopify reason enum). */
  reason: BankClaimReason;
  /** False when the claim says authorisation / who made the purchase is
   *  NOT disputed (or the cardholder admits making it). Null = unclear. */
  authorizationDisputed: boolean | null;
  /** True when the claim says the cardholder asked for a return, refund or
   *  replacement before disputing. Null = the claim does not say. */
  returnOrRefundRequested: boolean | null;
  model: string;
  analyzedAt: string;
}

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM =
  "You classify a card-issuing bank's chargeback claim so a merchant's response can answer the right question. " +
  "Answer ONLY with a JSON object: " +
  '{"reason": one of ' +
  BANK_CLAIM_REASONS.map((r) => `"${r}"`).join(", ") +
  ', "authorizationDisputed": true|false|null, "returnOrRefundRequested": true|false|null}. ' +
  "reason: PRODUCT_NOT_RECEIVED = goods/service never arrived; PRODUCT_UNACCEPTABLE = arrived but not as described, damaged or defective; " +
  "CREDIT_NOT_PROCESSED = a promised refund/credit was not given; SUBSCRIPTION_CANCELLED = charged after cancelling a recurring service; " +
  "DUPLICATE = charged twice; FRAUDULENT = cardholder did not make or authorise the purchase; GENERAL = none of these or unclear. " +
  "authorizationDisputed: false if the claim states or implies the cardholder made the purchase or that authorisation is not in dispute; " +
  "true if the claim says the purchase was unauthorised; null if it does not say. " +
  "returnOrRefundRequested: true if the claim says the cardholder asked the merchant for a return, refund, replacement or cancellation before disputing; " +
  "false if it says they did not; null if it does not say.";

function parse(raw: string): Omit<BankClaimAnalysis, "model" | "analyzedAt"> | null {
  try {
    const j = parseJson<Record<string, unknown>>(raw);
    const reason = BANK_CLAIM_REASONS.includes(j.reason as BankClaimReason)
      ? (j.reason as BankClaimReason)
      : "GENERAL";
    const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
    return {
      reason,
      authorizationDisputed: tri(j.authorizationDisputed),
      returnOrRefundRequested: tri(j.returnOrRefundRequested),
    };
  } catch {
    return null;
  }
}

export async function analyzeBankClaim(text: string): Promise<BankClaimAnalysis | null> {
  const res = await callClaudeMessages({
    model: MODEL,
    system: [{ type: "text", text: SYSTEM }],
    messages: [{ role: "user", content: `Bank's claim:\n\n${text.slice(0, 8000)}` }],
    maxTokens: 200,
    temperature: 0,
  });
  if (res.error || !res.raw) return null;
  const parsed = parse(res.raw);
  return parsed ? { ...parsed, model: MODEL, analyzedAt: new Date().toISOString() } : null;
}

/** Categories that argue WHO made the purchase — irrelevant once the bank
 *  says authorisation is not in dispute. */
const AUTHORIZATION_CATEGORIES: ReadonlySet<string> = new Set<EvidenceFactCategory>([
  "payment_authentication",
  "billing_match",
]);

export interface ScopedFacts<T> {
  facts: T[];
  removed: Array<{ id: string; category: string; why: "authorization_not_disputed" | "return_requested" }>;
}

/**
 * Drop the facts the claim makes irrelevant or contradicts. Pure; applied to
 * the exact list the writer, the validator and the PDF all receive.
 */
export function scopeFactsToBankClaim<T extends { id: string; category: string }>(
  facts: T[],
  analysis: Pick<BankClaimAnalysis, "authorizationDisputed" | "returnOrRefundRequested"> | null,
): ScopedFacts<T> {
  if (!analysis) return { facts, removed: [] };
  const removed: ScopedFacts<T>["removed"] = [];
  const kept = facts.filter((f) => {
    if (analysis.authorizationDisputed === false && AUTHORIZATION_CATEGORIES.has(f.category)) {
      removed.push({ id: f.id, category: f.category, why: "authorization_not_disputed" });
      return false;
    }
    if (analysis.returnOrRefundRequested === true && f.category === "no_return_initiated") {
      removed.push({ id: f.id, category: f.category, why: "return_requested" });
      return false;
    }
    return true;
  });
  return { facts: kept, removed };
}

/**
 * The reason the letter template and the evidence checklist follow: the
 * claim's reason when Shopify's own is GENERAL (or missing) and the claim
 * names a specific one; Shopify's reason otherwise. Shopify's `reason`
 * column is never overwritten — the sync owns it.
 */
export function effectiveReasonForClaim(
  shopifyReason: string | null | undefined,
  analysis: Pick<BankClaimAnalysis, "reason"> | null | undefined,
): string | null {
  const own = (shopifyReason ?? "").toUpperCase();
  if ((own === "" || own === "GENERAL") && analysis && analysis.reason !== "GENERAL") {
    return analysis.reason;
  }
  return shopifyReason ?? null;
}
