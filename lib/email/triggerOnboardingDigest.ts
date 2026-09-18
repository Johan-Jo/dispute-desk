/**
 * Fires the onboarding analysis digest when a shop's historical import
 * completes.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sendOnboardingAnalysisDigest` was built and shipped in May 2026
 * (16b00ff1) alongside the monthly digest. The monthly one got a cron route
 * and a Vercel schedule; the onboarding one got neither, and no caller was
 * ever added anywhere else. Its own header documented the intended trigger
 * ("the historical-backfill job when it transitions to complete") and an
 * `onboarding_digest_sent_at` claim column — but the column had no migration
 * and the string appeared nowhere except that comment.
 *
 * So the first email DisputeDesk is supposed to send a merchant has never
 * been sent to anyone. This is the missing wire.
 *
 * IDEMPOTENCY IS NOT OPTIONAL HERE
 * --------------------------------
 * The completion branch in `backfillShopOrders` is not a one-shot event: the
 * walk resumes by cursor and its job is retried by the worker on failure, so
 * the branch can run more than once for one shop. The claim is taken with a
 * conditional UPDATE ... WHERE onboarding_digest_sent_at IS NULL *before*
 * the send, mirroring `sendInstallWelcome`. Two concurrent workers cannot
 * both win it.
 *
 * Fire-and-forget: never throws. A failed digest must never fail an import.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { sendOnboardingAnalysisDigest } from "@/lib/email/sendOnboardingAnalysisDigest";
import { railSegmentationFor } from "@/lib/insights/railSegmentation";

/** Orders fetched for the 30-day snapshot. Mirrors the columns the monthly
 *  cron's `windowMetrics` reads — kept local rather than imported, because
 *  that helper lives inside an API route file. */
interface SnapshotOrderRow {
  processed_at: string | null;
  fulfilled_at: string | null;
  risk_level_initial: string | null;
  fraud_protection_level: string | null;
  payment_gateway: string | null;
  payment_method: string | null;
  three_ds_authenticated: boolean | null;
  signed_by_name: string | null;
  delivered_at_tracking: string | null;
}

function pctOf(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Send the onboarding digest for a shop whose import just completed.
 *
 * Returns a reason string for observability. Never throws.
 */
export async function triggerOnboardingDigest(
  shopId: string,
): Promise<{ sent: boolean; reason: string }> {
  try {
    const sb = getServiceClient();

    const { data: shop } = await sb
      .from("shops")
      .select(
        "id, shop_domain, historical_import_orders_total, onboarding_digest_sent_at",
      )
      .eq("id", shopId)
      .maybeSingle();
    if (!shop) return { sent: false, reason: "shop_not_found" };
    if (shop.onboarding_digest_sent_at) {
      return { sent: false, reason: "already_sent" };
    }

    // Recipient + opt-out live in the same place the monthly digest reads.
    // A merchant who turned monthly digests off has told us they do not want
    // analysis email; honouring that here too rather than treating this as a
    // transactional message they cannot decline.
    const { data: setup } = await sb
      .from("shop_setup")
      .select("steps")
      .eq("shop_id", shopId)
      .maybeSingle();
    const steps = (setup?.steps ?? {}) as Record<
      string,
      { payload?: Record<string, unknown> }
    >;
    const teamPayload = steps.team?.payload ?? {};
    const notifications = teamPayload.notifications as
      | { monthlyDigest?: boolean }
      | undefined;
    if (notifications?.monthlyDigest === false) {
      return { sent: false, reason: "opted_out" };
    }
    const to = teamPayload.teamEmail as string | undefined;
    if (!to) return { sent: false, reason: "no_recipient" };

    const now = new Date();
    const w30 = new Date(now);
    w30.setUTCDate(now.getUTCDate() - 30);
    const w90 = new Date(now);
    w90.setUTCDate(now.getUTCDate() - 90);

    // ── 30d snapshot ────────────────────────────────────────────────
    const orders: SnapshotOrderRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data } = await sb
        .from("shopify_orders")
        .select(
          "processed_at, fulfilled_at, risk_level_initial, fraud_protection_level, payment_gateway, payment_method, three_ds_authenticated, signed_by_name, delivered_at_tracking",
        )
        .eq("shop_id", shopId)
        .gte("created_at_shopify", w30.toISOString())
        .lt("created_at_shopify", now.toISOString())
        .range(offset, offset + 999);
      const rows = (data ?? []) as SnapshotOrderRow[];
      orders.push(...rows);
      if (rows.length < 1000) break;
    }

    const total = orders.length;
    if (total === 0) return { sent: false, reason: "no_recent_orders" };

    const high = orders.filter((o) => o.risk_level_initial === "HIGH");
    const fulfilledHigh = high.filter((o) => o.fulfilled_at).length;
    const protectedCount = orders.filter((o) =>
      ["PROTECTED", "ACTIVE"].includes(o.fraud_protection_level ?? ""),
    ).length;

    // 3DS numerator and denominator must share a predicate. Counting wallet
    // 3DS against a card-only denominator overstated this rate ~23% in the
    // monthly digest before it was fixed.
    const cardOrders = orders.filter(
      (o) =>
        o.payment_gateway === "shopify_payments" && o.payment_method === "card",
    );
    const threeDsOk = cardOrders.filter(
      (o) => o.three_ds_authenticated === true,
    ).length;

    const delivered = orders.filter((o) => o.delivered_at_tracking);
    const signed = delivered.filter((o) => o.signed_by_name).length;

    const fulfillHours = orders
      .filter((o) => o.fulfilled_at && o.processed_at)
      .map(
        (o) =>
          (new Date(o.fulfilled_at as string).getTime() -
            new Date(o.processed_at as string).getTime()) /
          3_600_000,
      )
      .filter((h) => Number.isFinite(h) && h >= 0);

    // ── 90d chargeback rate (chargebacks only, never inquiries) ─────
    const { count: cb90 } = await sb
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("phase", "chargeback")
      .gte("initiated_at", w90.toISOString())
      .lt("initiated_at", now.toISOString());
    const { count: ord90 } = await sb
      .from("shopify_orders")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gte("created_at_shopify", w90.toISOString())
      .lt("created_at_shopify", now.toISOString());

    const rail = await railSegmentationFor(sb, shopId, w90, now);

    // ── Claim, then send ────────────────────────────────────────────
    // Claim BEFORE sending. Losing the race means another worker is already
    // sending; sending first and claiming after would double-email on a
    // retry, which is the failure this column exists to prevent.
    const { data: claimed, error: claimErr } = await sb
      .from("shops")
      .update({ onboarding_digest_sent_at: new Date().toISOString() })
      .eq("id", shopId)
      .is("onboarding_digest_sent_at", null)
      .select("id");
    if (claimErr) {
      console.warn("[onboarding-digest] claim failed:", claimErr.message);
      return { sent: false, reason: "claim_failed" };
    }
    if (!claimed || claimed.length === 0) {
      return { sent: false, reason: "already_sent" };
    }

    const { delivered: ok } = await sendOnboardingAnalysisDigest({
      shopDomain: shop.shop_domain as string,
      merchantName: null,
      to,
      ordersAnalyzedTotal:
        (shop.historical_import_orders_total as number | null) ?? 0,
      chargebackRate90dPct:
        ord90 && ord90 > 0 ? ((cb90 ?? 0) / ord90) * 100 : null,
      chargebackCount90d: cb90 ?? 0,
      rail: {
        cardRatePct: rail.card.ratePct,
        cardDisputes: rail.card.disputes,
        cardDisputeShare: rail.cardDisputeShare,
        cardFramingApplies: rail.cardFramingApplies,
      },
      last30d: {
        ordersTotal: total,
        highRiskPct: pctOf(high.length, total),
        fulfilledHighRiskPct: pctOf(fulfilledHigh, high.length),
        fraudDisputeRatePct: null,
        shopifyProtectCoveragePct: pctOf(protectedCount, total),
        threeDsAuthRatePct: pctOf(threeDsOk, cardOrders.length),
        signedForRatePct: pctOf(signed, delivered.length),
        medianFulfillmentHours: median(fulfillHours),
      },
    });

    // The claim is deliberately NOT released when the send fails. A merchant
    // silently missing one digest is a smaller harm than a retry loop that
    // emails them repeatedly, and the failure is logged by the sender.
    return ok
      ? { sent: true, reason: "sent" }
      : { sent: false, reason: "send_failed" };
  } catch (err) {
    console.warn(
      "[onboarding-digest] unexpected failure:",
      err instanceof Error ? err.message : err,
    );
    return { sent: false, reason: "error" };
  }
}
