/**
 * POST /api/webhooks/app-subscriptions-update
 *
 * Shopify push for changes to the merchant's recurring app charge.
 * Fast path for state transitions; the hourly billing reconciliation
 * cron is the safety net that catches dropped deliveries.
 *
 * Payload shape (Shopify 2026-01):
 *   {
 *     "app_subscription": {
 *       "admin_graphql_api_id": "gid://shopify/AppSubscription/123",
 *       "name": "Growth",
 *       "status": "ACTIVE" | "FROZEN" | "CANCELLED" | "EXPIRED" | "DECLINED" | "PENDING",
 *       "current_period_end": "2026-06-15T00:00:00Z",
 *       ...
 *     }
 *   }
 *
 * Handler contract:
 *   1. Verify HMAC. Reject anything else.
 *   2. Resolve shop_id from X-Shopify-Shop-Domain header (NOT from
 *      the payload — `admin_graphql_api_shop_id` is forgeable when
 *      HMAC verification has been bypassed, e.g. a misconfigured
 *      reverse proxy strips the signature header).
 *   3. Do NOT trust the payload's `status` for the state transition.
 *      Forward to `reconcileBillingCycleForShop`, which re-queries
 *      `currentAppInstallation.activeSubscriptions` from Shopify
 *      and runs the same state machine the hourly cron uses. The
 *      webhook is the fast trigger; the reconciler is the truth.
 *   4. Audit `app_subscription_update_received` (raw payload shape
 *      diagnostics + per-shop outcome) so a dropped reconciliation
 *      doesn't leave the merchant with no record of the change.
 *
 * Returns 200 even on no-op so Shopify doesn't retry. 500 only on
 * infrastructure failure (DB unavailable, etc.).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { reconcileBillingCycleForShop } from "@/lib/billing/reconcileBillingCycle";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    console.warn("[webhook] HMAC verification failed for app_subscriptions/update");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!shopDomain) {
    return NextResponse.json(
      { error: "Missing X-Shopify-Shop-Domain header" },
      { status: 400 },
    );
  }

  // Resolve shop_id via the trusted header. We do NOT trust
  // payload.app_subscription.admin_graphql_api_shop_id even after
  // HMAC passes — the header is the canonical join key Shopify
  // signs into every webhook.
  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops")
    .select("id, uninstalled_at")
    .eq("shop_domain", shopDomain)
    .single();
  if (!shop) {
    // Unknown shop. Treat as 200 so Shopify doesn't retry — the
    // most common cause is a webhook delivery landing after we lost
    // the install record (uninstall + reinstall window).
    console.warn(
      `[webhook] app_subscriptions/update for unknown shop: ${shopDomain}`,
    );
    return NextResponse.json({ ok: true, ignored: "unknown_shop" });
  }
  if (shop.uninstalled_at) {
    return NextResponse.json({ ok: true, ignored: "uninstalled_shop" });
  }

  // Parse defensively for the audit record. The reconciler does NOT
  // read this — Shopify is re-queried for truth. We capture the
  // payload shape only for diagnostics and for the "webhook landed"
  // audit row that proves the push reached us even when the
  // reconciler fails.
  let payloadStatus: string | null = null;
  let payloadSubscriptionGid: string | null = null;
  let payloadCurrentPeriodEnd: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as {
      app_subscription?: {
        admin_graphql_api_id?: string;
        status?: string;
        current_period_end?: string;
      };
    };
    payloadStatus = parsed.app_subscription?.status ?? null;
    payloadSubscriptionGid =
      parsed.app_subscription?.admin_graphql_api_id ?? null;
    payloadCurrentPeriodEnd =
      parsed.app_subscription?.current_period_end ?? null;
  } catch {
    // Malformed JSON is not a 400 — the HMAC already passed so
    // Shopify did sign whatever this body is. Audit and continue;
    // the reconciler doesn't depend on the parse.
  }

  // Always audit the webhook receipt — even if the reconciler
  // fails, the audit row proves the push landed.
  await sb.from("audit_events").insert({
    shop_id: shop.id,
    actor_type: "system",
    event_type: "app_subscription_update_received",
    event_payload: {
      shop_domain: shopDomain,
      payload_status: payloadStatus,
      payload_subscription_gid: payloadSubscriptionGid,
      payload_current_period_end: payloadCurrentPeriodEnd,
    },
  });

  // Forward to the reconciler. It re-queries Shopify (so a replayed
  // or stale payload can't drive a wrong transition) and applies the
  // exact same state machine the cron uses.
  let outcomeJson: Record<string, unknown>;
  try {
    const outcome = await reconcileBillingCycleForShop({ shopId: shop.id });
    outcomeJson = outcome as unknown as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[webhook] reconcileBillingCycleForShop failed for ${shopDomain}:`,
      message,
    );
    return NextResponse.json(
      { ok: false, error: "reconcile_failed", message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, outcome: outcomeJson });
}
