/**
 * The card-network programme figures for one shop and one calendar month —
 * the single computation every Insights surface reads (page checkpoints, the
 * Liability-shift card, and from PR2 the persisted month row and the emails).
 *
 * Definitions (docs/plans/insights-single-source.plan.md §2.2):
 *   card dispute ratio = card-rail CHARGEBACKS initiated in M
 *                        ÷ card-rail settled orders created in M
 *   - inquiries are excluded (phase = 'chargeback' only);
 *   - settled = financial_status PAID | PARTIALLY_REFUNDED;
 *   - `null` below PROGRAMME_MIN_SETTLED settled orders, never 0.
 *   ECM (lower bound) = Mastercard chargebacks in M ÷ card settled in M-1.
 *
 * Read-only. Throws on ANY query error: a silently empty count is how a
 * month came to read "0 settled orders" while orders existed. Callers catch
 * and show an explicit "temporarily unavailable" state.
 *
 * Every ratio is rounded once here (`roundRatio`, 5 dp); no surface
 * recomputes one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CheckpointSeverity } from "@/lib/insights/checkpoints.types";
import { classifyRail, CARD_FRAMING_MIN_DISPUTE_SHARE } from "@/lib/insights/railSegmentation";
import {
  PROGRAMME_MIN_SETTLED,
  VAMP_COUNT_FLOOR,
  MC_ECM_COUNT_FLOOR,
  ecmSeverity,
  roundRatio,
  vampSeverity,
} from "@/lib/insights/programmeThresholds";
import { addMonths, finalOn, monthEnd, periodStateByDate } from "@/lib/insights/period/months";

/** Payment methods that settle on a card network. Kept equal to the card
 *  bucket of `classifyRail`. */
export const CARD_RAIL_METHODS = ["card", "apple_pay", "google_pay", "shop_pay", "shopify_pay"];

const SETTLED_STATUSES = ["PAID", "PARTIALLY_REFUNDED"];

/** Visa reason codes are 10.x–13.x; Mastercard's are 48xx. */
const VISA_REASON = /^1[0-3]\./;
const MC_REASON = /^48/;

/** What the routes return for the statement month. `error` is an explicit
 *  state the page renders as "temporarily unavailable" — never a blank card
 *  and never the whole-page failure banner. */
export type ProgrammeMonth =
  | ({ status: "ok"; periodState: "final" | "provisional"; finalOn: string } & ProgrammeBlock)
  | { status: "error"; periodMonth: string };

export interface ProgrammeBlock {
  periodMonth: string;
  cardSettledCount: number;
  cardSettledPrevCount: number;
  unknownSettledCount: number;
  cardChargebackCount: number;
  visaChargebackCount: number;
  mcChargebackCount: number;
  /** Disputes in M whose order we could not resolve to a payment method. */
  unresolvedRailDisputeCount: number;
  cardDisputeRatio: number | null;
  /** Same numerator after DisputeDesk CE 3.0 / FPT exclusions (secondary). */
  vampRatioCalculated: number | null;
  ecmRatio: number | null;
  ecmIsLowerBound: true;
  vampFloorMet: boolean;
  ecmFloorMet: boolean;
  vampSeverity: CheckpointSeverity | null;
  ecmSeverity: CheckpointSeverity | null;
  /** Card share of this month's classified disputes, 0–1; null when none. */
  cardDisputeShare: number | null;
  /** Card share of this month's classified disputes ≥ 0.5 — or, in a month
   *  with no classified dispute, a card book with measurable card volume. */
  cardFramingApplies: boolean;
  /** Orders with no payment method recorded, as a share of card + unknown. */
  unknownPaymentShare: number | null;
}

function fail(
  what: string,
  error: { message?: string; code?: string; details?: string } | null,
): void {
  if (error) {
    throw new Error(
      `computeProgrammeBlock: ${what}: ${error.message || error.code || error.details || "query failed"}`,
    );
  }
}

async function settledCount(
  sb: SupabaseClient,
  shopId: string,
  from: string,
  to: string,
  methods: "card" | "unknown",
): Promise<number> {
  let q = sb
    .from("shopify_orders")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("created_at_shopify", `${from}T00:00:00Z`)
    .lt("created_at_shopify", `${to}T00:00:00Z`)
    .in("financial_status", SETTLED_STATUSES);
  q = methods === "card" ? q.in("payment_method", CARD_RAIL_METHODS) : q.is("payment_method", null);
  const { count, error } = await q;
  fail(`settled ${methods} ${from}`, error);
  return count ?? 0;
}

interface DisputeRow {
  id: string;
  phase: string | null;
  network_reason_code: string | null;
  final_outcome: string | null;
  order_gid: string | null;
}

export async function computeProgrammeBlock(
  sb: SupabaseClient,
  shopId: string,
  periodMonth: string,
): Promise<ProgrammeBlock> {
  const end = monthEnd(periodMonth);
  const prev = addMonths(periodMonth, -1);

  // Sequential, not Promise.all: on a large shop (blume-box, 366k orders)
  // three concurrent exact counts contend and one fails with an empty error.
  const cardSettled = await settledCount(sb, shopId, periodMonth, end, "card");
  const cardSettledPrev = await settledCount(sb, shopId, prev, periodMonth, "card");
  const unknownSettled = await settledCount(sb, shopId, periodMonth, end, "unknown");

  // Every dispute initiated in M (both phases: the rail share that decides
  // card framing is about the whole dispute book), paginated past the
  // PostgREST 1000-row cap.
  const disputes: DisputeRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("disputes")
      .select("id, phase, network_reason_code, final_outcome, order_gid")
      .eq("shop_id", shopId)
      .gte("initiated_at", `${periodMonth}T00:00:00Z`)
      .lt("initiated_at", `${end}T00:00:00Z`)
      .order("id")
      .range(offset, offset + 999);
    fail("disputes", error);
    const rows = (data ?? []) as DisputeRow[];
    disputes.push(...rows);
    if (rows.length < 1000) break;
  }

  const gids = [...new Set(disputes.map((d) => d.order_gid).filter((g): g is string => !!g))];
  const methodByGid = new Map<string, string | null>();
  for (let i = 0; i < gids.length; i += 200) {
    const { data, error } = await sb
      .from("shopify_orders")
      .select("shopify_order_id, payment_method")
      .eq("shop_id", shopId)
      .in("shopify_order_id", gids.slice(i, i + 200));
    fail("dispute orders", error);
    for (const r of (data ?? []) as Array<{ shopify_order_id: string; payment_method: string | null }>) {
      methodByGid.set(r.shopify_order_id, r.payment_method);
    }
  }

  let cardDisputes = 0;
  let classifiedDisputes = 0;
  let unresolved = 0;
  const cardChargebacks: DisputeRow[] = [];
  for (const d of disputes) {
    const rail = classifyRail(d.order_gid ? (methodByGid.get(d.order_gid) ?? null) : null);
    if (rail === "unknown") {
      unresolved += 1;
      continue;
    }
    classifiedDisputes += 1;
    if (rail !== "card") continue;
    cardDisputes += 1;
    if (d.phase === "chargeback") cardChargebacks.push(d);
  }

  const visaCount = cardChargebacks.filter((d) => VISA_REASON.test(d.network_reason_code ?? "")).length;
  const mcCount = cardChargebacks.filter((d) => MC_REASON.test(d.network_reason_code ?? "")).length;

  // DisputeDesk exclusions for the secondary ratio: won chargebacks whose
  // pack was a CE 3.0 or first-party-trust package.
  let excluded = 0;
  const wonIds = cardChargebacks.filter((d) => d.final_outcome === "won").map((d) => d.id);
  for (let i = 0; i < wonIds.length; i += 200) {
    const { data, error } = await sb
      .from("evidence_packs")
      .select("dispute_id, package_type")
      .in("dispute_id", wonIds.slice(i, i + 200));
    fail("evidence packs", error);
    const attributed = new Set(
      ((data ?? []) as Array<{ dispute_id: string | null; package_type: string | null }>)
        .filter((p) => p.package_type === "ce_30" || p.package_type === "fpt")
        .map((p) => p.dispute_id),
    );
    excluded += attributed.size;
  }

  const ratio = (n: number, d: number): number | null =>
    d >= PROGRAMME_MIN_SETTLED ? roundRatio(n / d) : null;
  const cardDisputeRatio = ratio(cardChargebacks.length, cardSettled);
  const vampRatioCalculated = ratio(Math.max(0, cardChargebacks.length - excluded), cardSettled);
  const ecmRatio = ratio(mcCount, cardSettledPrev);

  const cardFramingApplies =
    classifiedDisputes > 0
      ? cardDisputes / classifiedDisputes >= CARD_FRAMING_MIN_DISPUTE_SHARE &&
        cardSettled >= PROGRAMME_MIN_SETTLED
      : cardSettled >= PROGRAMME_MIN_SETTLED;

  return {
    periodMonth,
    cardSettledCount: cardSettled,
    cardSettledPrevCount: cardSettledPrev,
    unknownSettledCount: unknownSettled,
    cardChargebackCount: cardChargebacks.length,
    visaChargebackCount: visaCount,
    mcChargebackCount: mcCount,
    unresolvedRailDisputeCount: unresolved,
    cardDisputeRatio,
    vampRatioCalculated,
    ecmRatio,
    ecmIsLowerBound: true,
    vampFloorMet: visaCount >= VAMP_COUNT_FLOOR,
    ecmFloorMet: mcCount >= MC_ECM_COUNT_FLOOR,
    vampSeverity: cardDisputeRatio === null ? null : vampSeverity(cardDisputeRatio, visaCount),
    ecmSeverity: ecmRatio === null ? null : ecmSeverity(ecmRatio, mcCount, true),
    cardDisputeShare: classifiedDisputes > 0 ? roundRatio(cardDisputes / classifiedDisputes) : null,
    cardFramingApplies,
    unknownPaymentShare:
      cardSettled + unknownSettled > 0
        ? roundRatio(unknownSettled / (cardSettled + unknownSettled))
        : null,
  };
}

/**
 * The statement-month block in the routes' shape. A query failure is logged
 * and returned as `{status:"error"}` so the caller's other data still renders.
 */
export async function programmeMonthFor(
  sb: SupabaseClient,
  shopId: string,
  periodMonth: string,
  now: Date,
): Promise<ProgrammeMonth> {
  try {
    const block = await computeProgrammeBlock(sb, shopId, periodMonth);
    return {
      status: "ok",
      periodState: periodStateByDate(periodMonth, now),
      finalOn: finalOn(periodMonth),
      ...block,
    };
  } catch (err) {
    console.error(
      "[insights] programme block failed:",
      err instanceof Error ? err.message : err,
    );
    return { status: "error", periodMonth };
  }
}

/** The checkpoint rules' view of a programme month; undefined on error. */
export function programmeCheckpointInput(
  p: ProgrammeMonth | null | undefined,
): import("@/lib/insights/checkpoints.types").ProgrammeCheckpointInput | undefined {
  if (!p || p.status !== "ok") return undefined;
  return {
    periodMonth: p.periodMonth,
    cardDisputeRatio: p.cardDisputeRatio,
    visaChargebackCount: p.visaChargebackCount,
    mcChargebackCount: p.mcChargebackCount,
    ecmRatio: p.ecmRatio,
    ecmIsLowerBound: p.ecmIsLowerBound,
    cardFramingApplies: p.cardFramingApplies,
    cardDisputeShare: p.cardDisputeShare,
  };
}
