/**
 * Payment-rail segmentation for the Insights surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Insights computed one "chargeback rate" as (all disputes ÷ all orders) and
 * compared it to Visa VDMP (0.9%) and Mastercard ECM (1.5%). For a merchant
 * whose disputes are 92.3% PayPal that number is meaningless: PayPal claims
 * carry no card network, no Visa/Mastercard reason code, and are counted by
 * neither monitoring programme. Measured on prod (Mein Maison, May–Aug 2026):
 *
 *   shown as "chargeback rate"   2.53%
 *   true card-network rate       0.31%     ← 8x overstated
 *
 * We shipped that framing to a merchant in a written report before catching
 * it. This module exists so a rate can never again be computed across rails
 * that answer to different rulebooks.
 *
 * THREE BUCKETS, NEVER TWO
 * ------------------------
 * `unknown` is not folded into `card` or `alt`. An order whose payment method
 * we failed to resolve is a coverage gap, not a payment method — collapsing
 * the two is precisely the defect that produced the 8x misread (a NULL
 * `payment_method` read as though it were a rail). `lib/admin/shopRisk.ts`
 * reached the same conclusion independently; this mirrors its discipline.
 *
 * Classification comes from `isNonCardPaymentFamily` in
 * `lib/disputes/paymentContext.ts` — the one classifier, already used by
 * seven pipeline modules. Never re-derive a rail from `payment_gateway`:
 * `shopify_payments` is the gateway for card, PayPal, Klarna and wallets
 * alike, which is exactly how PayPal was mistaken for card in the first place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";

/** Minimum orders on a rail before a rate derived from it is worth showing.
 *  Below this a single dispute swings the percentage by whole points, and a
 *  card-programme verdict computed from a handful of orders is noise wearing
 *  a threshold's clothes. */
export const RAIL_MIN_ORDERS_FOR_RATE = 50;

/** Share of classified DISPUTES that must sit on the card rail before
 *  card-network framing (VDMP/ECM thresholds, liability-shift copy) is shown.
 *
 *  Keyed on disputes, not orders, and that distinction is load-bearing.
 *  VDMP and ECM describe a merchant's *dispute book*, so "does card framing
 *  describe this merchant" is a question about which rail their disputes
 *  arrive on. The two measures disagree sharply in practice — measured on
 *  prod, Mein Maison is 20.1% card by order volume but only 7.7% card by
 *  disputes. Keying on orders would have shown Visa/Mastercard verdicts to a
 *  merchant whose disputes are 92.3% PayPal, which is the exact failure this
 *  module exists to prevent.
 *
 *  Prod separation at this threshold is wide, not marginal:
 *    blume-box 99.2% · surasvenne 50.0% · Mein Maison 7.7% · cay 0% */
export const CARD_FRAMING_MIN_DISPUTE_SHARE = 0.5;

export interface RailSegment {
  orders: number;
  disputes: number;
  /** Disputes ÷ orders, as a percent. `null` when the denominator is below
   *  RAIL_MIN_ORDERS_FOR_RATE — deliberately not `0`, because "no card
   *  volume" and "no card disputes" are different statements and a green
   *  0.00% for the former is a lie the merchant cannot see through. */
  ratePct: number | null;
}

export interface RailSegmentation {
  card: RailSegment;
  /** PayPal, Klarna, BNPL, local methods — anything with no card network. */
  alt: RailSegment;
  /** Orders/disputes whose payment method never resolved. A coverage gap.
   *  Never merged into card or alt, and never used as a rate denominator. */
  unknown: RailSegment;
  /** Card share of *classified* orders (unknown excluded from the base).
   *  `null` when nothing is classified. Describes the checkout mix. */
  cardShare: number | null;
  /** Card share of *classified* disputes. This — not `cardShare` — is what
   *  decides whether card-programme framing describes the merchant, because
   *  VDMP/ECM measure a dispute book. `null` when no dispute is classified. */
  cardDisputeShare: number | null;
  /** Whether card-network framing (VDMP/ECM thresholds, liability-shift
   *  copy) should render at all. False when the dispute book is mostly
   *  non-card, or when card volume is too thin to measure. */
  cardFramingApplies: boolean;
  /** Share of orders we could not classify. Above ~0.2 every rail figure
   *  here is soft and the UI should say so rather than imply precision. */
  unknownShare: number;
}

/** The per-order shape this module needs. Deliberately minimal so callers
 *  can pass rows they already have in memory rather than re-query. */
export interface RailOrderRow {
  payment_method: string | null;
}

/** The per-dispute shape: the resolved payment method of the disputed order,
 *  or null when the dispute could not be joined to an order at all. */
export interface RailDisputeRow {
  payment_method: string | null;
}

type Bucket = "card" | "alt" | "unknown";

/** Classify one stored `payment_method` value into a rail bucket.
 *
 *  Exported because the digest and the page must agree on the boundary; a
 *  second inlined copy is how they drifted apart in the first place.
 *
 *  NULL/empty → `unknown`, never `card`. The union bug persisted PayPal
 *  orders with a NULL method, so treating NULL as card would reproduce the
 *  original defect exactly. */
export function classifyRail(method: string | null | undefined): Bucket {
  const m = method?.trim().toLowerCase();
  if (!m) return "unknown";
  if (isNonCardPaymentFamily(m)) return "alt";
  // `card` and the card wallets (apple_pay / google_pay / shop_pay) all
  // settle on a card network and DO count toward VDMP/ECM, so they belong
  // together on the card side.
  if (
    m === "card" ||
    m === "apple_pay" ||
    m === "google_pay" ||
    m === "shop_pay" ||
    m === "shopify_pay"
  ) {
    return "card";
  }
  // Gift cards, store credit, shop_cash, tiktok_shop and anything else new:
  // not a card network, so not measurable against card programmes. `alt` is
  // the honest home — they are real payment methods, just not card ones.
  return "alt";
}

function rate(disputes: number, orders: number): number | null {
  if (orders < RAIL_MIN_ORDERS_FOR_RATE) return null;
  return (disputes / orders) * 100;
}

/**
 * Split a window's orders and disputes by payment rail.
 *
 * Pure — callers pass rows they already hold. The insights route already
 * selects `payment_method` for its whole 90d window, so this costs no extra
 * query there.
 */
export function segmentByRail(
  orders: RailOrderRow[],
  disputes: RailDisputeRow[],
): RailSegmentation {
  const o: Record<Bucket, number> = { card: 0, alt: 0, unknown: 0 };
  const d: Record<Bucket, number> = { card: 0, alt: 0, unknown: 0 };

  for (const row of orders) o[classifyRail(row.payment_method)] += 1;
  for (const row of disputes) d[classifyRail(row.payment_method)] += 1;

  const classified = o.card + o.alt;
  const total = classified + o.unknown;
  const cardShare = classified > 0 ? o.card / classified : null;
  const classifiedDisputes = d.card + d.alt;
  const cardDisputeShare =
    classifiedDisputes > 0 ? d.card / classifiedDisputes : null;
  const unknownShare = total > 0 ? o.unknown / total : 0;

  return {
    card: { orders: o.card, disputes: d.card, ratePct: rate(d.card, o.card) },
    alt: { orders: o.alt, disputes: d.alt, ratePct: rate(d.alt, o.alt) },
    // No rate for `unknown`: it is a coverage gap, and dividing by it would
    // dress a measurement failure up as a metric.
    unknown: { orders: o.unknown, disputes: d.unknown, ratePct: null },
    cardShare,
    cardDisputeShare,
    // Both conditions matter. The dispute share decides whether card
    // programmes describe this merchant at all; the order floor ensures the
    // rate we would print alongside the threshold is not noise. A shop with
    // one card dispute out of one is 100% card-rail and still unmeasurable.
    cardFramingApplies:
      cardDisputeShare !== null &&
      cardDisputeShare >= CARD_FRAMING_MIN_DISPUTE_SHARE &&
      o.card >= RAIL_MIN_ORDERS_FOR_RATE,
    unknownShare,
  };
}

/**
 * Fetch + segment a window straight from the database.
 *
 * The insights route already holds its order rows in memory and calls
 * `segmentByRail` directly. The digest crons do not, and re-implementing the
 * join there is how the page and the email drifted apart in the first place
 * (they still compute their headline rate two different ways). This is the
 * one place that turns a shop + window into a rail split.
 *
 * `sb` is the Supabase service client.
 */
export async function railSegmentationFor(
  sb: SupabaseClient,
  shopId: string,
  from: Date,
  toExclusive: Date,
): Promise<RailSegmentation> {
  // Orders, paginated. PostgREST caps an un-ranged select at 1000 rows, and
  // silently — a shop with 17k orders in the window would otherwise be
  // segmented from its first thousand and report a confident wrong mix.
  const orders: RailOrderRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await sb
      .from("shopify_orders")
      .select("payment_method")
      .eq("shop_id", shopId)
      .gte("created_at_shopify", from.toISOString())
      .lt("created_at_shopify", toExclusive.toISOString())
      .range(offset, offset + 999);
    const rows = (data ?? []) as RailOrderRow[];
    orders.push(...rows);
    if (rows.length < 1000) break;
  }

  const { data: disputeRows } = await sb
    .from("disputes")
    .select("order_gid")
    .eq("shop_id", shopId)
    .gte("initiated_at", from.toISOString())
    .lt("initiated_at", toExclusive.toISOString());

  const gids = ((disputeRows ?? []) as Array<{ order_gid: string | null }>)
    .map((d) => d.order_gid)
    .filter((g): g is string => !!g);

  // Chunked: a long `.in()` list blows URL limits and the row cap.
  const methodByGid = new Map<string, string | null>();
  for (let i = 0; i < gids.length; i += 200) {
    const { data } = await sb
      .from("shopify_orders")
      .select("shopify_order_id, payment_method")
      .eq("shop_id", shopId)
      .in("shopify_order_id", gids.slice(i, i + 200));
    for (const r of (data ?? []) as Array<{
      shopify_order_id: string;
      payment_method: string | null;
    }>) {
      methodByGid.set(r.shopify_order_id, r.payment_method);
    }
  }

  // A dispute we could not join resolves to `unknown`, never to card.
  return segmentByRail(
    orders,
    gids.map((g) => ({ payment_method: methodByGid.get(g) ?? null })),
  );
}
