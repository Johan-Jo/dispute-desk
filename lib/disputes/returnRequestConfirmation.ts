/**
 * Returns outside Shopify (plan Fix C4/C4b,
 * docs/plans/mein-maison-status-and-no-return.plan.md).
 *
 * Shopify records only the returns made through Shopify. A merchant who takes
 * return and refund requests by email (Mein Maison) turns on
 * `shop_settings.returns_outside_shopify`; from then on "no return recorded
 * in Shopify" no longer raises a case's strength on its own. It counts again
 * only when the merchant confirms, on that dispute, that the customer did not
 * ask. A merchant who says the customer DID ask removes the fact from the
 * score and the letter — and that answer is never bank-facing.
 *
 * An unanswered question never blocks a filing (merchant's-counsel stance);
 * it only withholds the scoring weight.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const RETURN_REQUEST_ANSWERS = ["no_request_received", "request_received", "not_sure"] as const;
export type ReturnRequestAnswer = (typeof RETURN_REQUEST_ANSWERS)[number];

export function isReturnRequestAnswer(v: unknown): v is ReturnRequestAnswer {
  return typeof v === "string" && (RETURN_REQUEST_ANSWERS as readonly string[]).includes(v);
}

/**
 * The one attributed absence sentence the letter may carry (C4b). It states
 * what the merchant confirmed — the merchant is the one party who can see
 * their own inbox — and it is the ONLY exemption to the absence bans in
 * `lib/defence/claimGuards.ts`, and only when the no-return fact carries
 * `merchantConfirmedNoRequest`.
 */
export const MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE =
  "The merchant has confirmed that the customer did not contact the store to request a return or refund before opening the dispute.";

/** Reason families where "did the customer ask for a return?" matters. */
const FAMILIES_THAT_ASK = new Set(["product", "refund", "delivery"]);

export function returnQuestionApplies(args: {
  returnsOutsideShopify: boolean;
  reasonFamily: string | null | undefined;
}): boolean {
  return args.returnsOutsideShopify && FAMILIES_THAT_ASK.has(args.reasonFamily ?? "");
}

export interface ReturnRequestConfirmation {
  answer: ReturnRequestAnswer;
  note: string | null;
  cycle: number;
  answeredAt: string;
}

/** The merchant's answer for the dispute's CURRENT response cycle. */
export async function loadReturnRequestConfirmation(
  sb: SupabaseClient,
  disputeId: string,
  cycle: number | null | undefined,
): Promise<ReturnRequestConfirmation | null> {
  const { data } = await sb
    .from("dispute_return_request_confirmations")
    .select("answer, note, response_cycle, answered_at")
    .eq("dispute_id", disputeId)
    .eq("response_cycle", cycle ?? 1)
    .maybeSingle();
  if (!data || !isReturnRequestAnswer(data.answer)) return null;
  return {
    answer: data.answer,
    note: (data.note as string | null) ?? null,
    cycle: Number(data.response_cycle ?? 1),
    answeredAt: String(data.answered_at ?? ""),
  };
}

/**
 * What the no-return fact carries into the pack, so every scorer and the
 * letter read the same verdict from the persisted payload:
 *   - `emit: false` when the merchant said the customer DID ask;
 *   - `returnsOutsideShopify` + `merchantConfirmedNoRequest` otherwise.
 */
export function noReturnFactScope(args: {
  returnsOutsideShopify: boolean;
  answer: ReturnRequestAnswer | null;
}): { emit: boolean; returnsOutsideShopify: boolean; merchantConfirmedNoRequest: boolean } {
  if (args.answer === "request_received") {
    return { emit: false, returnsOutsideShopify: args.returnsOutsideShopify, merchantConfirmedNoRequest: false };
  }
  return {
    emit: true,
    returnsOutsideShopify: args.returnsOutsideShopify,
    merchantConfirmedNoRequest: args.answer === "no_request_received",
  };
}

/**
 * C3: the scoring rule. With the setting on, the Shopify record alone does
 * not count; only the merchant's confirmation restores it. Setting off:
 * unchanged.
 */
export function noReturnCountsForStrength(payload: Record<string, unknown>): boolean {
  if (payload.returnsOutsideShopify !== true) return true;
  return payload.merchantConfirmedNoRequest === true;
}
