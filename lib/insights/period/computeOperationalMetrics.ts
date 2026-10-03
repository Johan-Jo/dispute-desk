/**
 * The operational side of one shop-month: how orders were protected, the win
 * rate, and where disputes came from by payment method. Computed once, stored
 * on the month row next to the programme block, and read by the page and the
 * emails (docs/plans/insights-single-source.plan.md PR3a, §0.4 and §0.9).
 *
 * Read-only, paginated past the 1000-row cap, throws on any query error.
 * Shares (fractions 0–1) are rounded once to 5 dp; `null` means "not
 * measured", never 0.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { roundRatio } from "@/lib/insights/programmeThresholds";
import { classifyRail } from "@/lib/insights/railSegmentation";
import { winRateCounts } from "@/lib/disputes/winRate";
import { canonicalReasonCode } from "@/lib/rules/disputeReasons";
import { protectValue } from "@/lib/insights/protectCoverage";
import { monthEnd } from "./months";
import { reasonCodeNetwork } from "./computeProgrammeBlock";

const SETTLED = ["PAID", "PARTIALLY_REFUNDED"];
/** Below this many orders a method's rates are not shown. */
export const METHOD_MIN_ORDERS = 50;
/** Below this many observable deliveries the signed-for share is not shown. */
export const SIGNED_MIN_DELIVERIES = 30;

export interface PaymentMethodRow {
  /** Stored payment_method, or "unknown" when none was recorded. */
  method: string;
  /** Card brand for card-network methods (Visa, Mastercard, …); else null. */
  brand: string | null;
  isCardNetwork: boolean;
  orders: number;
  chargebacks: number;
  inquiries: number;
  chargebackRate: number | null;
  disputeRate: number | null;
}

export interface ReasonRow {
  /** Shopify's dispute reason (FRAUDULENT, PRODUCT_NOT_RECEIVED, …), or
   *  "UNKNOWN" when the dispute carries none. */
  reason: string;
  /** Chargebacks and inquiries opened in the month with this reason. */
  disputes: number;
}

export interface OperationalMetrics {
  /** Card-network orders on Shopify Payments that passed 3-D Secure. */
  threeDsShare: number | null;
  threeDsOrders: number;
  threeDsEligible: number;
  /** Carrier-confirmed deliveries with a signature, counted only where a
   *  carrier lookup actually ran for the shipment. */
  signedForShare: number | null;
  signedForOrders: number;
  signedForEligible: number;
  /** Value of orders Protect covers ÷ value of every order with a Protect
   *  status (lib/insights/protectCoverage.ts). Null when no order has one. */
  protectShareByValue: number | null;
  protectedValue: number;
  protectEligibleValue: number;
  /** HIGH-risk orders that were still fulfilled, from the fraud rollup. */
  highRiskFulfilledShare: number | null;
  medianFulfillmentHours: number | null;
  /** Won ÷ (won + lost + accepted) for disputes closed in the month. */
  winRate: number | null;
  wonCount: number;
  decidedCount: number;
  byPaymentMethod: PaymentMethodRow[];
  /** Disputes opened in the month by reason, most first. Absent on records
   *  written before metrics v4; absent means "not measured", never "none". */
  byReason?: ReasonRow[];
}

function fail(what: string, error: { message?: string; code?: string } | null): void {
  if (error) throw new Error(`computeOperationalMetrics: ${what}: ${error.message || error.code || "query failed"}`);
}

interface OrderRow {
  shopify_order_id: string;
  payment_gateway: string | null;
  payment_method: string | null;
  three_ds_authenticated: boolean | null;
  processed_at: string | null;
  fulfilled_at: string | null;
  delivery_status: string | null;
  delivered_at_tracking: string | null;
  signed_by_name: string | null;
  financial_status: string | null;
  fraud_protection_level: string | null;
  order_total: number | string | null;
}

async function pageAll<T>(fetchPage: (from: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from);
    fail(what, error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function inChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await run(ids.slice(i, i + 200));
    fail(what, error);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

const share = (n: number, d: number, min = 1): number | null => (d >= min ? roundRatio(n / d) : null);

export async function computeOperationalMetrics(
  sb: SupabaseClient,
  shopId: string,
  month: string,
): Promise<OperationalMetrics> {
  const from = `${month}T00:00:00Z`;
  const to = `${monthEnd(month)}T00:00:00Z`;

  const orders = await pageAll<OrderRow>(
    (o) =>
      sb
        .from("shopify_orders")
        .select("shopify_order_id, payment_gateway, payment_method, three_ds_authenticated, processed_at, fulfilled_at, delivery_status, delivered_at_tracking, signed_by_name, financial_status, fraud_protection_level, order_total")
        .eq("shop_id", shopId)
        .gte("created_at_shopify", from)
        .lt("created_at_shopify", to)
        .order("shopify_order_id")
        .range(o, o + 999),
    "orders",
  );

  // ── Disputes opened in the month, resolved to their order's method ──
  const disputes = await pageAll<{ phase: string | null; order_gid: string | null; reason: string | null; network_reason_code: string | null }>(
    (o) =>
      sb
        .from("disputes")
        .select("phase, order_gid, reason, network_reason_code")
        .eq("shop_id", shopId)
        .gte("initiated_at", from)
        .lt("initiated_at", to)
        .order("id")
        .range(o, o + 999),
    "disputes",
  );
  const methodByOrder = new Map(orders.map((o) => [o.shopify_order_id, o.payment_method]));
  const missing = [...new Set(disputes.map((d) => d.order_gid).filter((g): g is string => !!g && !methodByOrder.has(g)))];
  for (const r of await inChunks<{ shopify_order_id: string; payment_method: string | null }>(
    missing,
    (chunk) => sb.from("shopify_orders").select("shopify_order_id, payment_method").eq("shop_id", shopId).in("shopify_order_id", chunk),
    "dispute orders",
  )) {
    methodByOrder.set(r.shopify_order_id, r.payment_method);
  }

  // Card brand for every card-network order we will group.
  const cardOrderIds = [
    ...new Set(
      [...orders.map((o) => o.shopify_order_id), ...disputes.map((d) => d.order_gid ?? "")].filter(
        (id) => id && classifyRail(methodByOrder.get(id) ?? null) === "card",
      ),
    ),
  ];
  const brandByOrder = new Map<string, string | null>();
  for (const r of await inChunks<{ shopify_order_id: string; card_brand: string | null }>(
    cardOrderIds,
    (chunk) => sb.from("shopify_order_risk_signals").select("shopify_order_id, card_brand").eq("shop_id", shopId).in("shopify_order_id", chunk),
    "card brands",
  )) {
    brandByOrder.set(r.shopify_order_id, r.card_brand);
  }

  // An order whose card brand was never captured (blume-box #352535: several
  // cards tried at checkout, no brand on the signals row) still has a known
  // network when its dispute's reason code names one. Without this the
  // dispute sat on a brandless "Card" row of its own.
  for (const d of disputes) {
    if (!d.order_gid || brandByOrder.get(d.order_gid)) continue;
    if (classifyRail(methodByOrder.get(d.order_gid) ?? null) !== "card") continue;
    const network = reasonCodeNetwork(d.network_reason_code);
    if (network) brandByOrder.set(d.order_gid, network);
  }

  const keyOf = (orderId: string | null): { method: string; brand: string | null; isCardNetwork: boolean } => {
    const method = (orderId ? methodByOrder.get(orderId) : null) ?? null;
    const isCardNetwork = classifyRail(method) === "card";
    return {
      method: method ?? "unknown",
      brand: isCardNetwork ? ((orderId ? brandByOrder.get(orderId) : null) ?? null) : null,
      isCardNetwork,
    };
  };
  const groups = new Map<string, PaymentMethodRow>();
  const row = (k: { method: string; brand: string | null; isCardNetwork: boolean }) => {
    const id = `${k.method}|${k.brand ?? ""}`;
    let g = groups.get(id);
    if (!g) {
      g = { ...k, orders: 0, chargebacks: 0, inquiries: 0, chargebackRate: null, disputeRate: null };
      groups.set(id, g);
    }
    return g;
  };
  for (const o of orders) {
    if (!SETTLED.includes(o.financial_status ?? "")) continue;
    row(keyOf(o.shopify_order_id)).orders += 1;
  }
  for (const d of disputes) {
    const g = row(keyOf(d.order_gid));
    if (d.phase === "chargeback") g.chargebacks += 1;
    else g.inquiries += 1;
  }
  const byPaymentMethod = [...groups.values()]
    .map((g) => ({
      ...g,
      chargebackRate: share(g.chargebacks, g.orders, METHOD_MIN_ORDERS),
      disputeRate: share(g.chargebacks + g.inquiries, g.orders, METHOD_MIN_ORDERS),
    }))
    .sort((a, b) => b.chargebacks + b.inquiries - (a.chargebacks + a.inquiries) || b.orders - a.orders);

  // ── Disputes by reason: the same disputes, grouped by Shopify's reason ──
  const reasonCounts = new Map<string, number>();
  for (const d of disputes) {
    // Legacy spellings fold into the canonical code; a value Shopify adds
    // later is kept as sent rather than dropped.
    const reason = canonicalReasonCode(d.reason) ?? ((d.reason ?? "").trim().toUpperCase() || "UNKNOWN");
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const byReason: ReasonRow[] = [...reasonCounts.entries()]
    .map(([reason, n]) => ({ reason, disputes: n }))
    .sort((a, b) => b.disputes - a.disputes || a.reason.localeCompare(b.reason));

  // ── 3-D Secure: card-network orders on Shopify Payments, both sides ──
  // Wallets and Shop Pay settle on the card networks and do carry 3-D Secure
  // results (blume-box's positives are mostly Shop Pay), so they belong in
  // the denominator and the numerator alike.
  const tdsEligible = orders.filter(
    (o) => o.payment_gateway === "shopify_payments" && classifyRail(o.payment_method) === "card",
  );
  const tdsPositive = tdsEligible.filter((o) => o.three_ds_authenticated === true).length;

  // ── Signed for: only deliveries whose shipment a carrier lookup saw ──
  const delivered = orders.filter(
    (o) => o.fulfilled_at && (o.delivery_status === "Delivered" || !!o.delivered_at_tracking),
  );
  const looked = new Set(
    (
      await inChunks<{ shopify_order_id: string }>(
        delivered.map((o) => o.shopify_order_id),
        (chunk) =>
          sb
            .from("shopify_fulfillment_trackings")
            .select("shopify_order_id")
            .eq("shop_id", shopId)
            .not("last_carrier_lookup_at", "is", null)
            .in("shopify_order_id", chunk),
        "carrier lookups",
      )
    ).map((r) => r.shopify_order_id),
  );
  const observable = delivered.filter((o) => looked.has(o.shopify_order_id));
  const signed = observable.filter((o) => (o.signed_by_name ?? "").trim().length > 0).length;

  // ── Median fulfilment time ──
  const hours = orders
    .filter((o) => o.processed_at && o.fulfilled_at)
    .map((o) => (new Date(o.fulfilled_at!).getTime() - new Date(o.processed_at!).getTime()) / 3_600_000)
    .filter((h) => h >= 0 && h < 24 * 60)
    .sort((a, b) => a - b);
  const median = hours.length ? Math.round(hours[Math.floor(hours.length / 2)]! * 10) / 10 : null;

  // ── Shopify Protect, by value, from the month's orders ──
  let protectedValue = 0;
  let eligibleValue = 0;
  for (const o of orders) {
    const v = protectValue(o.fraud_protection_level, o.order_total);
    protectedValue += v.covered;
    eligibleValue += v.eligible;
  }

  // ── High-risk orders still fulfilled, from the daily fraud rollup ──
  const { data: protectRows, error: protectErr } = await sb
    .from("shop_fraud_daily_metrics")
    .select("orders_high, orders_fulfilled_high_risk")
    .eq("shop_id", shopId)
    .gte("date", month)
    .lt("date", monthEnd(month));
  fail("fraud rollup", protectErr);
  let high = 0;
  let highFulfilled = 0;
  for (const r of (protectRows ?? []) as Array<Record<string, unknown>>) {
    high += Number(r.orders_high ?? 0);
    highFulfilled += Number(r.orders_fulfilled_high_risk ?? 0);
  }

  // ── Win rate: disputes decided (closed) in the month ──
  const closed = await pageAll<{ final_outcome: string | null }>(
    (o) =>
      sb
        .from("disputes")
        .select("final_outcome")
        .eq("shop_id", shopId)
        .gte("closed_at", from)
        .lt("closed_at", to)
        .order("id")
        .range(o, o + 999),
    "closed disputes",
  );
  const wr = winRateCounts(closed);

  return {
    threeDsShare: share(tdsPositive, tdsEligible.length),
    threeDsOrders: tdsPositive,
    threeDsEligible: tdsEligible.length,
    signedForShare: share(signed, observable.length, SIGNED_MIN_DELIVERIES),
    signedForOrders: signed,
    signedForEligible: observable.length,
    protectShareByValue: eligibleValue > 0 ? roundRatio(protectedValue / eligibleValue) : null,
    protectedValue: Math.round(protectedValue * 100) / 100,
    protectEligibleValue: Math.round(eligibleValue * 100) / 100,
    highRiskFulfilledShare: share(highFulfilled, high),
    medianFulfillmentHours: median,
    winRate: wr.decided > 0 ? roundRatio(wr.won / wr.decided) : null,
    wonCount: wr.won,
    decidedCount: wr.decided,
    byPaymentMethod,
    byReason,
  };
}
