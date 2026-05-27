import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { NoBackgroundSessionError } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { validateBody } from "@/lib/middleware/validate";
import {
  ACTIVE_SUBSCRIPTIONS_QUERY,
  type ActiveSubscriptionsResponse,
} from "@/lib/shopify/queries/activeSubscriptions";
import {
  APP_SUBSCRIPTION_CANCEL_MUTATION,
  type AppSubscriptionCancelResult,
} from "@/lib/shopify/mutations/appSubscriptionCancel";

export const runtime = "nodejs";

/**
 * POST /api/billing/cancel
 * Body: { shop_id }
 *
 * Cancels every Shopify app subscription currently attached to the
 * install and drops the shop back to the Free plan. Required by
 * Shopify App Store review (2026-05): merchants must be able to
 * revert from a paid plan to Free without contacting support or
 * reinstalling the app.
 *
 * The cancel mutation is unauthenticated relative to the merchant
 * (no confirmation URL is returned — Shopify cancels immediately).
 * We mirror the side-effects of `/api/billing/callback` for the
 * free-plan case inline so the UI reflects the change without
 * waiting for the hourly reconciler.
 */

const cancelSchema = z.object({
  shop_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const body = {
    ...raw,
    shop_id: raw?.shop_id ?? req.headers.get("x-shop-id") ?? undefined,
  };
  const validated = await validateBody(body, cancelSchema);
  if ("error" in validated) return validated.error;
  const { shop_id } = validated.data;

  const sb = getServiceClient();

  // 1. Pull the live subscription list from Shopify. We don't trust
  //    plan_entitlements alone because the reconciler may be behind
  //    and the cancel needs to act on the *actual* charge GIDs.
  let activeResult;
  try {
    activeResult = await makeAuthedRequest<ActiveSubscriptionsResponse>({
      shopId: shop_id,
      query: ACTIVE_SUBSCRIPTIONS_QUERY,
      correlationId: `billing-cancel-list-${shop_id}`,
    });
  } catch (err) {
    if (err instanceof NoBackgroundSessionError) {
      return NextResponse.json(
        {
          error:
            'Reconnect this store to change plans. Use "Clear shop & reconnect" in the sidebar, then open the app from Shopify Admin.',
        },
        { status: 404 },
      );
    }
    throw err;
  }

  const subs = activeResult.data?.currentAppInstallation?.activeSubscriptions ?? [];

  // 2. Cancel each active subscription. There SHOULD only be one at
  //    a time (Shopify enforces this for app billing), but guard
  //    against multi-subscription accounts. `prorate: false` matches
  //    Shopify default; merchant keeps access through current cycle.
  const cancelErrors: string[] = [];
  for (const sub of subs) {
    const cancelResult = await makeAuthedRequest<AppSubscriptionCancelResult>({
      shopId: shop_id,
      query: APP_SUBSCRIPTION_CANCEL_MUTATION,
      variables: { id: sub.id, prorate: false },
      correlationId: `billing-cancel-${shop_id}-${sub.id}`,
    });
    const userErrors = cancelResult.data?.appSubscriptionCancel?.userErrors ?? [];
    if (userErrors.length > 0) {
      cancelErrors.push(userErrors.map((e) => e.message).join("; "));
    }
  }

  if (cancelErrors.length > 0) {
    await sb.from("audit_events").insert({
      shop_id,
      actor_type: "merchant",
      event_type: "billing_cancel_failed",
      event_payload: { errors: cancelErrors, subscription_count: subs.length },
    });
    return NextResponse.json(
      { error: cancelErrors.join(", ") },
      { status: 422 },
    );
  }

  // 3. Inline state transition to Free. Mirrors the writes in
  //    /api/billing/callback for the free-plan branch so the merchant
  //    sees the downgrade reflected immediately. The hourly
  //    reconciler will pick up the Shopify-side CANCELLED status and
  //    confirm the same end state on its next run (idempotent).
  const now = new Date().toISOString();
  await sb
    .from("shops")
    .update({ plan: "free", updated_at: now })
    .eq("id", shop_id);

  await sb.from("plan_entitlements").upsert(
    {
      shop_id,
      plan_key: "free",
      subscription_state: "cancelled",
      trial_ends_at: null,
      billing_cycle_started_at: null,
      billing_cycle_ends_at: null,
      low_credits_banner_dismissed_cycle: null,
      grace_banner_dismissed_cycle: null,
      updated_at: now,
    },
    { onConflict: "shop_id" },
  );

  // 4. Grant a one-time "fresh start" allowance so a merchant who
  //    used >= 3 packs as a paid customer isn't immediately stuck at
  //    the Free lifetime cap on their first day back. The Free plan
  //    is `packsLifetime: 3` (FREE_LIFETIME_PACKS) measured against
  //    all-time `pack_usage_events`, and the `pack_balance` view
  //    nets credits against ALL historical usage — so to surface
  //    exactly 3 packs of remaining balance, we have to grant
  //    `(usage_count + FREE_LIFETIME_PACKS)`.
  //
  //    Deduped by `reference = "downgrade_to_free_${shop_id}"` so a
  //    second cancel (or a replay) does not re-grant. The merchant
  //    gets exactly one fresh-start grant per shop, ever.
  const FRESH_START_PACKS = 3;
  const downgradeRef = `downgrade_to_free_${shop_id}`;
  const { data: existingGrant } = await sb
    .from("pack_credits_ledger")
    .select("id")
    .eq("shop_id", shop_id)
    .eq("reference", downgradeRef)
    .maybeSingle();

  if (!existingGrant) {
    const { count: usageCount } = await sb
      .from("pack_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shop_id);
    const usage = usageCount ?? 0;
    await sb.from("pack_credits_ledger").insert({
      shop_id,
      source: "admin_adjustment",
      packs: usage + FRESH_START_PACKS,
      expires_at: null,
      reference: downgradeRef,
    });
  }

  await sb.from("audit_events").insert({
    shop_id,
    actor_type: "merchant",
    event_type: "billing_cancelled",
    event_payload: {
      cancelled_subscription_ids: subs.map((s) => s.id),
      subscription_count: subs.length,
      fresh_start_granted: !existingGrant,
    },
  });

  return NextResponse.json({ ok: true });
}
