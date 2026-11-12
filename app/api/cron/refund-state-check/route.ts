import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchOrderRefundState } from "@/lib/shopify/queries/orderRefundState";
import { resolveRefundState } from "@/lib/disputes/refundState";
import { upsertRefundState } from "@/lib/disputes/refundStateStore";
import { runRefundStateCheck, type RefundCheckCandidate } from "@/lib/disputes/refundStateCheck";
import { loadRefundCheckCandidates, refundAdviceEventKey } from "@/lib/disputes/loadRefundCheckCandidates";
import { sendRefundAdviceAlert } from "@/lib/email/sendRefundAdviceAlert";
import { computeRefundOutcomeStats, quotableRefundStats } from "@/lib/disputes/refundOutcomeStats";
import { loadFinalReadCandidates, loadRefundOutcomeRows } from "@/lib/disputes/refundOutcomeData";
import { runFinalReads } from "@/lib/disputes/refundFinalReads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting new orders with headroom left under maxDuration. */
const BUDGET_MS = 240_000;
const PER_SHOP_SEND_CAP = 5;
/** A read newer than this is reused (the cron runs every 3 h; this absorbs a manual re-trigger). */
const MIN_RECHECK_MS = 90 * 60 * 1000;
/** Closed / escalated inquiries read once each, for the per-store results; the rest wait for the next run. */
const FINAL_READS_PER_RUN = 40;
const FINAL_READS_MIN_REMAINING_MS = 30_000;

/**
 * GET /api/cron/refund-state-check   (every 3 h; `?dryRun=1` reads Shopify and decides, writes and sends nothing)
 *
 * Reads, LIVE from Shopify, the refund state of every open inquiry, stores it for the
 * dispute page, and emails the merchant when a refund would resolve the inquiry and none has been issued.
 * Why live: a pending refund reads 0.0 everywhere the evidence pack looks, for about a day
 * (docs/plans/pending-refund-advice.plan.md). Sending is always on; the per-shop opt-out and the decision rules gate it.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const sb = getServiceClient();

  let candidates: RefundCheckCandidate[];
  try {
    candidates = await loadRefundCheckCandidates(sb);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  if (candidates.length === 0) return NextResponse.json({ candidates: 0, dryRun });

  const startedAt = Date.now();
  const readLive = async (shopId: string, orderGid: string) =>
    resolveRefundState(await fetchOrderRefundState({ shopId, orderGid, correlationId: "refund-state-check" }), new Date());

  // Each shop's own results, computed once per run and only when an email is about to go out. A failure here
  // drops the results line, never the email.
  const statsByShop = new Map<string, Promise<ReturnType<typeof quotableRefundStats> | null>>();
  const storeResultsFor = (shopId: string) => {
    let p = statsByShop.get(shopId);
    if (!p) {
      p = loadRefundOutcomeRows(sb, shopId)
        .then((rows) => quotableRefundStats(computeRefundOutcomeStats(rows)))
        .catch(() => null);
      statsByShop.set(shopId, p);
    }
    return p;
  };

  const summary = await runRefundStateCheck(
    candidates,
    {
      now: () => Date.now(),
      readState: (c) => readLive(c.shopId, c.orderGid),
      saveState: async (c, s) => {
        await upsertRefundState(sb, c.disputeId, c.shopId, c.orderGid, s);
      },
      send: async (c, variant) =>
        sendRefundAdviceAlert({
          storeResults: await storeResultsFor(c.shopId),
          to: (c.teamEmail ?? "").split(",").map((a) => a.trim()).filter(Boolean),
          locale: c.locale,
          variant,
          shopDomain: c.shopDomain,
          disputeId: c.disputeId,
          orderName: c.orderName,
          amount: c.amount,
          currencyCode: c.currencyCode,
          dueAt: c.dueAt,
        }),
      recordSent: async (c, variant, s) => {
        const { error: insErr } = await sb.from("audit_events").insert({
          shop_id: c.shopId,
          dispute_id: c.disputeId,
          actor_type: "system",
          event_type: "refund_advice_sent",
          dispute_event_key: refundAdviceEventKey(c.disputeId, c.responseCycle),
          event_payload: { variant, state: s.kind, returnStatus: s.returnStatus, paymentMethod: c.paymentMethod },
        });
        // 23505: another run already recorded it. The email is out either way.
        if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
      },
    },
    { dryRun, budgetMs: BUDGET_MS, perShopCap: PER_SHOP_SEND_CAP, minRecheckMs: dryRun ? 0 : MIN_RECHECK_MS },
  );

  // One-time final read of closed / escalated inquiries (feeds the per-store results). Skipped in a dry run.
  let finalReads: Awaited<ReturnType<typeof runFinalReads>> | null = null;
  const remaining = BUDGET_MS - (Date.now() - startedAt);
  if (!dryRun && remaining > FINAL_READS_MIN_REMAINING_MS) {
    try {
      const todo = await loadFinalReadCandidates(sb, FINAL_READS_PER_RUN);
      finalReads = await runFinalReads(
        todo,
        {
          now: () => Date.now(),
          readState: (c) => readLive(c.shopId, c.orderGid),
          saveFinal: async (c, s) => {
            await upsertRefundState(sb, c.disputeId, c.shopId, c.orderGid, s, new Date().toISOString(), { finalRead: true });
          },
        },
        { budgetMs: remaining },
      );
    } catch (err) {
      finalReads = { candidates: 0, read: 0, skippedByBudget: 0, errors: [{ disputeId: "-", error: err instanceof Error ? err.message : String(err) }] };
    }
  }

  return NextResponse.json({ dryRun, ...summary, finalReads });
}
