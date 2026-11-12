import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchOrderRefundState } from "@/lib/shopify/queries/orderRefundState";
import { resolveRefundState } from "@/lib/disputes/refundState";
import { upsertRefundState } from "@/lib/disputes/refundStateStore";
import { runRefundStateCheck, type RefundCheckCandidate } from "@/lib/disputes/refundStateCheck";
import { loadRefundCheckCandidates, refundAdviceEventKey } from "@/lib/disputes/loadRefundCheckCandidates";
import { sendRefundAdviceAlert } from "@/lib/email/sendRefundAdviceAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting new orders with headroom left under maxDuration. */
const BUDGET_MS = 240_000;
const PER_SHOP_SEND_CAP = 5;
/** A read newer than this is reused (the cron runs every 3 h; this absorbs a manual re-trigger). */
const MIN_RECHECK_MS = 90 * 60 * 1000;

/**
 * GET /api/cron/refund-state-check   (every 3 h; `?dryRun=1` reads Shopify and decides, writes and sends nothing)
 *
 * Reads, LIVE from Shopify, the refund state of every open credit-not-processed inquiry, stores it for the
 * dispute page, and emails the merchant when a refund would resolve the inquiry and none has been issued.
 * Why live: a pending refund reads 0.0 everywhere the evidence pack looks, for about a day
 * (docs/plans/pending-refund-advice.plan.md). Sending is behind REFUND_ADVICE_EMAILS_ENABLED.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const emailsEnabled = process.env.REFUND_ADVICE_EMAILS_ENABLED === "true";
  const sb = getServiceClient();

  let candidates: RefundCheckCandidate[];
  try {
    candidates = await loadRefundCheckCandidates(sb);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  if (candidates.length === 0) return NextResponse.json({ candidates: 0, dryRun, emailsEnabled });

  const summary = await runRefundStateCheck(
    candidates,
    {
      now: () => Date.now(),
      readState: async (c) => {
        const raw = await fetchOrderRefundState({ shopId: c.shopId, orderGid: c.orderGid, correlationId: "refund-state-check" });
        return resolveRefundState(raw, new Date());
      },
      saveState: async (c, s) => {
        await upsertRefundState(sb, c.disputeId, c.shopId, c.orderGid, s);
      },
      send: async (c, variant) =>
        sendRefundAdviceAlert({
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
    { emailsEnabled, dryRun, budgetMs: BUDGET_MS, perShopCap: PER_SHOP_SEND_CAP, minRecheckMs: dryRun ? 0 : MIN_RECHECK_MS },
  );

  return NextResponse.json({ dryRun, emailsEnabled, ...summary });
}
