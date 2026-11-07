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
import { resolveOrderSituation } from "./orderSituation";

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
  /** Shopify already records a refund or a return on the order. */
  shopifyRecordsReturnOrRefund?: boolean;
}): boolean {
  if (args.shopifyRecordsReturnOrRefund) return false;
  return args.returnsOutsideShopify && FAMILIES_THAT_ASK.has(args.reasonFamily ?? "");
}

/**
 * Does Shopify's own record already show a refund or a return on the order?
 * Then the no-return fact is never emitted (orderSource), the answer could
 * change nothing, and the question is not asked: the record already says
 * the customer was refunded or returned the item. Any return status other
 * than NO_RETURN counts (RETURN_REQUESTED, IN_PROGRESS, RETURNED, …).
 */
export function shopifyRecordsReturnOrRefund(args: {
  returnStatus: string | null | undefined;
  totalRefunded: number | string | null | undefined;
}): boolean {
  // One derivation of the order's situation (orderSituation.ts). A status
  // this code does not recognise still counts as "not NO_RETURN", as before.
  const situation = resolveOrderSituation({ returnStatus: args.returnStatus, refundedAmount: args.totalRefunded });
  if (situation.refund === "some") return true;
  return args.returnStatus != null && situation.returns !== "none";
}

/**
 * The same verdict read from a persisted pack's sections: the order
 * section's `totals.refunded` and `returnStatus` (the latter stamped from
 * 2026-10-02; older packs answer from the refund alone until rebuilt).
 */
export function packShowsReturnOrRefund(sections: unknown): boolean {
  if (!Array.isArray(sections)) return false;
  const order = sections.find(
    (s) => (s as { labelToken?: { key?: string } } | null)?.labelToken?.key === "packs.section.order",
  ) as { data?: { totals?: { refunded?: unknown }; returnStatus?: unknown } } | undefined;
  if (!order?.data) return false;
  return shopifyRecordsReturnOrRefund({
    returnStatus: typeof order.data.returnStatus === "string" ? order.data.returnStatus : null,
    totalRefunded: (order.data.totals?.refunded as string | number | null | undefined) ?? null,
  });
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
 * The collector's returns context: the shop takes return requests outside
 * Shopify, plus the merchant's answer for the dispute's current cycle. This is
 * the shape `BuildContext.returnScope` already has (`lib/packs/types.ts`).
 */
export type ReturnScopeInput = {
  returnsOutsideShopify: boolean;
  answer: ReturnRequestAnswer | null;
  /**
   * READ-TIME ONLY. A customer message matched to this order, in the support
   * inbox, asks to return it (Gorgias), and no newer merchant answer of "no
   * request received" outweighs it (`loadReturnScopeForPack` decides that).
   * Never set by a build, so nothing stored, scored, hashed or filed changes.
   */
  customerAskedInSupport?: boolean;
};

/** What the no-return fact carries (the output of `noReturnFactScope`). */
export type NoReturnScopePayload = ReturnType<typeof noReturnFactScope>;

/**
 * The returns context for a build, from the shop's settings and the merchant's
 * answer. `undefined` = setting off (a stale answer is ignored when the
 * setting is off, exactly as the inline code in `buildPack` did).
 *
 * Pure on purpose. The caller keeps the I/O and the failure policy: if reading
 * the settings throws, `buildPack` treats the context as undefined (= off),
 * because a pure function cannot contain a try/catch around an async load.
 * `loadReturnRequestConfirmation` itself returns null on a DB error, so a
 * failed answer read reaches here as "setting on, answer null".
 */
export function returnScopeFor(
  settings: { returns_outside_shopify?: boolean | null } | null | undefined,
  confirmation: Pick<ReturnRequestConfirmation, "answer"> | null | undefined,
): ReturnScopeInput | undefined {
  if (!settings?.returns_outside_shopify) return undefined;
  return { returnsOutsideShopify: true, answer: confirmation?.answer ?? null };
}

/**
 * Should the "no return initiated" fact exist for this order? THE one answer,
 * shared by the collector (`orderSource`, which emits on `emit: true`) and, in
 * a later PR, by the read-time applicability of the checklist row.
 *
 * Three-state on purpose (docs/plans/single-source-architecture-audit.plan.md
 * §2.2): an order whose return status was never recorded (a pack built before
 * 2026-10-02) is `unknown`, not "no return". The collector treats `unknown` as
 * do-not-emit, as it always has; a reader of stored packs must be able to tell
 * it apart from a known return.
 *
 * Precedence, pinned by `__tests__/noReturnFactVerdict.test.ts` against the
 * pre-extraction collector:
 *   1. any non-null status other than NO_RETURN (including a string this code
 *      does not recognise) -> `return_on_record`;
 *   2. a refund total above zero -> `refund_on_record`;
 *   3. no status -> `unknown` (`status_absent`);
 *   4. NO_RETURN: `merchant_says_request_received` when the merchant said the
 *      customer DID ask, else `emit: true` with the fact's scope payload.
 * NO_RETURN with an unparseable refund total emits (the refund reads as
 * unknown, not "some"); this must not fail closed, or emission would change.
 */
export type NoReturnVerdict =
  | { emit: true; scope: NoReturnScopePayload }
  | {
      emit: false;
      reason: "return_on_record" | "refund_on_record" | "merchant_says_request_received" | "customer_asked_in_support";
    }
  | { unknown: true; why: "status_absent" };

export function noReturnFactVerdict(input: {
  returnStatus: string | null | undefined;
  totalRefunded: number | string | null | undefined;
  returnScope?: ReturnScopeInput | null;
}): NoReturnVerdict {
  const situation = resolveOrderSituation({
    returnStatus: input.returnStatus,
    refundedAmount: input.totalRefunded,
  });
  const hasStatus = input.returnStatus != null;
  if (hasStatus && situation.returns !== "none") return { emit: false, reason: "return_on_record" };
  if (situation.refund === "some") return { emit: false, reason: "refund_on_record" };
  // A customer's return request in the support inbox (read-time signal, never
  // set by a build). Weaker than a record in Shopify (above), but it removes
  // the claim "no return" whatever Shopify's status says, including an unknown
  // one. The merchant's explicit "request_received" keeps its own reason.
  const customerAsked = input.returnScope?.customerAskedInSupport === true;
  if (customerAsked && input.returnScope?.answer !== "request_received") {
    return { emit: false, reason: "customer_asked_in_support" };
  }
  if (!hasStatus) return { unknown: true, why: "status_absent" };

  const scope = noReturnFactScope({
    returnsOutsideShopify: input.returnScope?.returnsOutsideShopify === true,
    answer: input.returnScope?.answer ?? null,
  });
  if (!scope.emit) return { emit: false, reason: "merchant_says_request_received" };
  return { emit: true, scope };
}

/**
 * True when the ONLY reason the collector reads "a return is on record" is a
 * status string this code does not recognise (and no refund is on record). The
 * collector stays silent for it, as before; a READER must not present it as a
 * confirmed return (read-time applicability, plan PR 1).
 */
export function isUnrecognisedReturnStatusOnly(input: {
  returnStatus: string | null | undefined;
  totalRefunded: number | string | null | undefined;
}): boolean {
  if (input.returnStatus == null) return false;
  const s = resolveOrderSituation({ returnStatus: input.returnStatus, refundedAmount: input.totalRefunded });
  return s.returns === "unknown" && s.refund !== "some";
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
