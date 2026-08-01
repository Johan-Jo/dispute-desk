/**
 * Prior-order history — VERIFIED, not assumed.
 *
 * `customer_account_info` evidence claims the cardholder has "N prior
 * undisputed orders … an established dispute-free order history". Until
 * 2026-08-01 nothing ever checked the second half. The collector
 * (`orderSource.ts`) emitted only `totalOrders` from Shopify's
 * `Customer.numberOfOrders`, and every consumer defaulted the missing
 * flag with `disputeFreeHistory !== false` — so *undefined became true*
 * and the `returningWithDisputes*` copy path was dead code in prod.
 *
 * The blume-box case that surfaced it (dispute 162042cd, 2026-07-31):
 * account `jax hacy` created 2026-06-29, nine orders in the following
 * four days, of which **two were already chargebacks in our own
 * `disputes` table** eleven days before the pack was built. We generated
 * `{ priorOrderCount: 8, disputeFreeHistory: true }`, marked it
 * `strength: "strong"`, `bankEligible: true`,
 * `includeInBankNarrative: true`, and would have filed that to the
 * issuer.
 *
 * This module answers the question from our own data instead. Coverage
 * is handled asymmetrically, because the two answers need different
 * amounts of proof:
 *
 *   - "This account HAS prior disputes" is provable from a single row.
 *     One ingested dispute on a prior order settles it regardless of how
 *     complete our order coverage is.
 *   - "This account is dispute-FREE" is a universal claim. We only make
 *     it when our ingested order count for the customer reaches Shopify's
 *     `numberOfOrders` — otherwise the orders we never ingested could
 *     each be hiding a chargeback, and the honest answer is `unknown`.
 *     Note the coverage test counts ALL of the customer's orders on both
 *     sides, while the prior count is strictly-before-the-dispute; mixing
 *     those two scales reports a phantom gap for every customer who
 *     ordered again afterwards.
 *
 * `unknown` is a first-class outcome: callers omit the flag entirely and
 * the consumer helpers (`disputeFreeHistoryState`) render copy that
 * states the order count WITHOUT the dispute-free assertion.
 */

import type { getServiceClient } from "@/lib/supabase/server";

export interface PriorOrderHistory {
  /** Orders by this customer on this shop placed BEFORE the disputed
   *  one, as counted from our ingested `shopify_orders`. */
  priorOrders: number;
  /** Of those, how many carry a dispute row we have ingested. */
  disputedPriorOrders: number;
  /** `priorOrders - disputedPriorOrders`. */
  priorUndisputedOrders: number;
  /**
   * Tri-state, deliberately nullable:
   *   true    — verified: full coverage AND zero disputed priors
   *   false   — verified: at least one prior order was disputed
   *   null    — unknown: partial coverage and nothing disputed found
   * Callers MUST omit the payload key when this is null. A missing key
   * reads as "unknown"; `false` reads as "has disputes". Never coerce.
   */
  disputeFreeHistory: boolean | null;
  /** Shopify's prior-order count (`numberOfOrders - 1`) when known —
   *  what we compared our coverage against. Diagnostics only. */
  shopifyPriorOrders: number | null;
}

/** Hard ceiling on the order scan. A customer past this is not a case
 *  where "prior order count" is the deciding evidence, and an unbounded
 *  select would hit PostgREST's 1000-row cap and silently truncate — a
 *  truncated scan could miss the very dispute we are looking for, so we
 *  return `unknown` instead of guessing. */
const MAX_PRIOR_ORDER_SCAN = 500;

export async function loadPriorOrderHistory(args: {
  sb: ReturnType<typeof getServiceClient>;
  shopId: string;
  /** Full GID of the disputed order — excluded from its own history. */
  orderGid: string | null;
  /** Full customer GID from `order.customer.id`. */
  customerGid: string | null;
  /** `processedAt` of the disputed order. Orders placed after it are
   *  not "prior" — Shopify's `numberOfOrders` counts them anyway. */
  disputedProcessedAt: string | null;
  /** Shopify's `Customer.numberOfOrders` (INCLUDES the disputed order). */
  shopifyTotalOrders: number | null;
}): Promise<PriorOrderHistory | null> {
  const {
    sb,
    shopId,
    orderGid,
    customerGid,
    disputedProcessedAt,
    shopifyTotalOrders,
  } = args;

  // Guest checkout or a failed order fetch — no account to have a
  // history. Caller omits the flags; consumers read "unknown".
  if (!customerGid || !orderGid) return null;

  const { data: orderRows, error: ordersError } = await sb
    .from("shopify_orders")
    .select("shopify_order_id, processed_at")
    .eq("shop_id", shopId)
    .eq("customer_shopify_id", customerGid)
    .limit(MAX_PRIOR_ORDER_SCAN + 1);

  if (ordersError) {
    console.warn(
      `[buildPack] prior-order history read failed for customer ${customerGid}:`,
      ordersError.message,
    );
    return null;
  }
  if (!orderRows || orderRows.length > MAX_PRIOR_ORDER_SCAN) return null;

  // "Prior" means placed before the disputed order — not merely "some
  // other order on the account". Shopify's numberOfOrders makes no such
  // distinction, which is how a later order got counted as history.
  const priors = orderRows.filter((r) => {
    if (r.shopify_order_id === orderGid) return false;
    if (!disputedProcessedAt) return true;
    const at = typeof r.processed_at === "string" ? r.processed_at : null;
    return at != null && at < disputedProcessedAt;
  });
  const priorGids = priors
    .map((r) => r.shopify_order_id)
    .filter((g): g is string => typeof g === "string" && g.length > 0);

  let disputedPriorOrders = 0;
  if (priorGids.length > 0) {
    const { data: disputeRows, error: disputesError } = await sb
      .from("disputes")
      .select("order_gid")
      .eq("shop_id", shopId)
      .in("order_gid", priorGids);

    if (disputesError) {
      console.warn(
        `[buildPack] prior-dispute read failed for customer ${customerGid}:`,
        disputesError.message,
      );
      return null;
    }

    const disputedGids = new Set(
      (disputeRows ?? [])
        .map((r) => r.order_gid)
        .filter((g): g is string => typeof g === "string"),
    );
    disputedPriorOrders = priorGids.filter((g) => disputedGids.has(g)).length;
  }
  // Zero priors is a RESULT, not a reason to bail. Emitting a verified
  // `priorUndisputedOrders: 0` is what stops `effectivePriorOrders`
  // falling back to `totalOrders - 1`, which counts LATER orders as
  // history: on prod, 6 disputes were crediting a customer with "1 prior
  // order" whose only other order came after the disputed one.

  const shopifyPriorOrders = priorCountFromShopify(shopifyTotalOrders);
  // Coverage compares LIKE WITH LIKE: every order we ingested for this
  // customer against Shopify's `numberOfOrders`. Both sides count the
  // disputed order and any LATER ones.
  //
  // The first cut of this compared `priors.length` (strictly-before)
  // against `numberOfOrders - 1` (all other orders), which reports a gap
  // for any customer who ordered again after the disputed order. On prod
  // that was most of them: 11 of 14 "partial coverage" verdicts were
  // customers whose only other order came LATER, with our ingest
  // complete. `>=` not `===`: our count can legitimately exceed
  // Shopify's after a customer merge/delete, and that is still full.
  const fullCoverage =
    shopifyTotalOrders == null || orderRows.length >= shopifyTotalOrders;

  return {
    priorOrders: priors.length,
    disputedPriorOrders,
    priorUndisputedOrders: Math.max(0, priors.length - disputedPriorOrders),
    disputeFreeHistory:
      disputedPriorOrders > 0 ? false : fullCoverage ? true : null,
    shopifyPriorOrders,
  };
}

/** Shopify's `numberOfOrders` counts the disputed order too. */
function priorCountFromShopify(total: number | null): number | null {
  if (total == null || !Number.isFinite(total)) return null;
  return Math.max(0, total - 1);
}
