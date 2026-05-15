/**
 * Billing reconciliation cron — Phase 2 of the billing-lifecycle PRD.
 *
 * Runs hourly. For every shop whose entitlement cycle is about to
 * end (within the next hour) OR has already ended without renewal,
 * pull `currentAppInstallation.activeSubscriptions` from Shopify and
 * bring the local `plan_entitlements` row + `pack_credits_ledger`
 * into sync.
 *
 * The PRD names this "reconciliation" intentionally — it does more
 * than renew credits:
 *   - verify Shopify subscription truth (re-query, never trust DB);
 *   - catch missed `app_subscriptions/update` webhooks (Phase 3);
 *   - grant the monthly_included credit for the current cycle once;
 *   - transition expired / cancelled shops to the matching state;
 *   - emit audit events for every state change.
 *
 * Idempotency:
 *   - The `pack_credits_ledger` unique index on (shop_id, reference)
 *     means a duplicate grant from a webhook + cron race is a no-op.
 *   - Every audit event carries the cycle end timestamp so a re-run
 *     within the same cycle does not re-emit "renewed" events.
 *
 * Read-only access invariant (PRD §5.4): this module ONLY writes
 * plan_entitlements + pack_credits_ledger + audit_events. It does
 * NOT touch any path that gates historical reads — disputes, packs,
 * audit timeline remain fully readable in every state.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import { grantCredits } from "@/lib/billing/consumePack";
import {
  ACTIVE_SUBSCRIPTIONS_QUERY,
  type ActiveSubscriptionsResponse,
  type ActiveSubscriptionNode,
  type ShopifySubscriptionStatus,
} from "@/lib/shopify/queries/activeSubscriptions";
import {
  mapShopifyStatusToState,
  type SubscriptionState,
} from "./subscriptionState";

/** Window the reconciler scans — cycles ending within this many ms
 *  ahead. One hour matches the cron schedule (`0 * * * *`) plus
 *  enough slack that a late tick still catches the renewal before
 *  the cycle has been over for an hour. */
const RENEWAL_LOOKAHEAD_MS = 60 * 60 * 1000;

/** Staleness threshold for `last_reconciled_at` — shops untouched
 *  for this long get re-checked even if their cycle isn't ending,
 *  to catch silent uninstalls or token revocations. */
const STALE_RECONCILIATION_MS = 24 * 60 * 60 * 1000;

export type ReconcileShopOutcome =
  | { ok: true; action: "no_change"; state: SubscriptionState }
  | {
      ok: true;
      action: "credits_granted";
      state: SubscriptionState;
      packs: number;
      cycleEndIso: string;
    }
  | { ok: true; action: "credits_duplicate"; state: SubscriptionState }
  | {
      ok: true;
      action: "state_transition";
      from: SubscriptionState;
      to: SubscriptionState;
    }
  | { ok: true; action: "skipped_uninstalled" }
  | { ok: true; action: "skipped_no_session" }
  | { ok: false; error: string };

export interface ReconcileShopInput {
  shopId: string;
  /** Allows tests + the cron route to pin "now" without faking Date. */
  now?: Date;
}

interface EntitlementRow {
  shop_id: string;
  plan_key: string;
  trial_ends_at: string | null;
  billing_cycle_started_at: string | null;
  billing_cycle_ends_at: string | null;
  subscription_state: SubscriptionState | null;
  shopify_subscription_gid: string | null;
}

/**
 * Reconcile one shop. Pure-ish: no email, no banner — those are
 * Phase 4. The reconciler writes data + audit; consumers (email
 * worker, in-app banners) read the audit ledger on their own.
 */
export async function reconcileBillingCycleForShop(
  input: ReconcileShopInput,
): Promise<ReconcileShopOutcome> {
  const sb = getServiceClient();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  // Skip uninstalled shops outright — no automation, no Shopify
  // call, no audit noise. PRD § 4.2 makes installation state
  // independent of billing state; honour that asymmetry here.
  const { data: shop } = await sb
    .from("shops")
    .select("uninstalled_at")
    .eq("id", input.shopId)
    .single();
  if (shop?.uninstalled_at) {
    return { ok: true, action: "skipped_uninstalled" };
  }

  // No offline session = no token to call Shopify with. Mark a
  // reconciliation tick happened (so staleness queries don't trip)
  // and bail.
  const { data: session } = await sb
    .from("shop_sessions")
    .select("id")
    .eq("shop_id", input.shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .limit(1)
    .maybeSingle();
  if (!session) {
    await sb
      .from("plan_entitlements")
      .update({ last_reconciled_at: nowIso })
      .eq("shop_id", input.shopId);
    return { ok: true, action: "skipped_no_session" };
  }

  // Load entitlement.
  const { data: entitlement, error: entErr } = await sb
    .from("plan_entitlements")
    .select(
      "shop_id, plan_key, trial_ends_at, billing_cycle_started_at, billing_cycle_ends_at, subscription_state, shopify_subscription_gid",
    )
    .eq("shop_id", input.shopId)
    .maybeSingle();
  if (entErr) return { ok: false, error: entErr.message };
  if (!entitlement) {
    // Reconciliation has no opinion on shops without an entitlement
    // row — the subscribe-callback flow owns initial provisioning.
    return { ok: true, action: "no_change", state: "active" };
  }

  const entRow = entitlement as EntitlementRow;
  const previousState: SubscriptionState =
    (entRow.subscription_state as SubscriptionState | null) ?? "active";

  // Ask Shopify what is actually live.
  let activeSubs: ActiveSubscriptionNode[] = [];
  try {
    const res = await makeAuthedRequest<ActiveSubscriptionsResponse>({
      shopId: input.shopId,
      query: ACTIVE_SUBSCRIPTIONS_QUERY,
    });
    if (res.errors?.length) {
      return {
        ok: false,
        error: `shopify_errors:${res.errors.map((e) => e.message).join(";")}`,
      };
    }
    activeSubs =
      res.data?.currentAppInstallation?.activeSubscriptions ?? [];
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Pick the "primary" subscription — the highest-priority status,
  // newest first. In practice merchants have exactly one active app
  // subscription; this picker just avoids being surprised by edge
  // cases (e.g. a CANCELLED row lingering alongside a new ACTIVE).
  const primary = pickPrimarySubscription(activeSubs);

  if (!primary) {
    // No active subscription. Transition to expired unless we were
    // already there or in a non-billable state. Reconciliation does
    // NOT downgrade `cancelled` to `expired` — that would erase
    // merchant intent.
    if (previousState === "cancelled") {
      await touchReconciled(sb, input.shopId, nowIso);
      return { ok: true, action: "no_change", state: previousState };
    }
    if (previousState === "expired") {
      await touchReconciled(sb, input.shopId, nowIso);
      return { ok: true, action: "no_change", state: previousState };
    }
    await sb
      .from("plan_entitlements")
      .update({
        subscription_state: "expired",
        subscription_expired_at: nowIso,
        last_reconciled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("shop_id", input.shopId);
    await sb.from("audit_events").insert({
      shop_id: input.shopId,
      actor_type: "system",
      event_type: "subscription_state_changed",
      event_payload: {
        from: previousState,
        to: "expired",
        source: "reconcile_billing_cycle",
        reason: "no_active_shopify_subscription",
      },
    });
    return {
      ok: true,
      action: "state_transition",
      from: previousState,
      to: "expired",
    };
  }

  // We have an active sub. Compute target state with the defensive
  // PENDING mapping.
  const targetState = mapShopifyStatusToState({
    status: primary.status,
    trialEndsAt: entRow.trial_ends_at,
    now,
  });

  const updates: Record<string, unknown> = {
    last_reconciled_at: nowIso,
    updated_at: nowIso,
    shopify_subscription_gid: primary.id,
  };

  // Pull cycle bounds from Shopify whenever it gives them. Local
  // values are the cache; Shopify is the source of truth.
  if (primary.currentPeriodEnd) {
    updates.billing_cycle_ends_at = primary.currentPeriodEnd;
  }

  if (targetState !== previousState) {
    updates.subscription_state = targetState;
    if (targetState === "expired") {
      updates.subscription_expired_at = nowIso;
    } else if (targetState === "cancelled") {
      updates.cancelled_at = nowIso;
    } else if (targetState === "grace") {
      updates.grace_entered_at = nowIso;
    }
  }

  await sb
    .from("plan_entitlements")
    .update(updates)
    .eq("shop_id", input.shopId);

  if (targetState !== previousState) {
    await sb.from("audit_events").insert({
      shop_id: input.shopId,
      actor_type: "system",
      event_type: "subscription_state_changed",
      event_payload: {
        from: previousState,
        to: targetState,
        source: "reconcile_billing_cycle",
        shopify_status: primary.status,
        shopify_subscription_gid: primary.id,
      },
    });
  }

  // Grant monthly_included credits for the current cycle if we
  // haven't already. The unique (shop_id, reference) index makes
  // this safely re-runnable.
  let grantOutcome:
    | { action: "credits_granted"; packs: number; cycleEndIso: string }
    | { action: "credits_duplicate" }
    | { action: "no_change" } = { action: "no_change" };

  if (
    primary.currentPeriodEnd &&
    (targetState === "active" || targetState === "trialing")
  ) {
    const planId = (entRow.plan_key as PlanId) ?? "free";
    const plan = getPlan(planId);
    if (plan.packsPerMonth > 0) {
      const reference = monthlyGrantReference(
        input.shopId,
        primary.currentPeriodEnd,
      );
      const result = await tryGrantMonthlyCredits(sb, {
        shopId: input.shopId,
        packs: plan.packsPerMonth,
        expiresAt: primary.currentPeriodEnd,
        reference,
      });
      if (result === "granted") {
        grantOutcome = {
          action: "credits_granted",
          packs: plan.packsPerMonth,
          cycleEndIso: primary.currentPeriodEnd,
        };
        await sb.from("audit_events").insert({
          shop_id: input.shopId,
          actor_type: "system",
          event_type: "monthly_credits_granted",
          event_payload: {
            plan: planId,
            packs: plan.packsPerMonth,
            cycle_end: primary.currentPeriodEnd,
            source: "reconcile_billing_cycle",
            reference,
          },
        });
      } else if (result === "duplicate") {
        grantOutcome = { action: "credits_duplicate" };
      }
    }
  }

  if (targetState !== previousState) {
    return {
      ok: true,
      action: "state_transition",
      from: previousState,
      to: targetState,
    };
  }
  if (grantOutcome.action === "credits_granted") {
    return {
      ok: true,
      action: "credits_granted",
      state: targetState,
      packs: grantOutcome.packs,
      cycleEndIso: grantOutcome.cycleEndIso,
    };
  }
  if (grantOutcome.action === "credits_duplicate") {
    return { ok: true, action: "credits_duplicate", state: targetState };
  }
  return { ok: true, action: "no_change", state: targetState };
}

/**
 * Find shops the cron needs to reconcile this tick. The query is a
 * conservative superset; the reconciler itself is idempotent so
 * over-selection is harmless.
 */
export async function selectShopsToReconcile(now?: Date): Promise<string[]> {
  const sb = getServiceClient();
  const nowDate = now ?? new Date();
  const cutoffEnding = new Date(
    nowDate.getTime() + RENEWAL_LOOKAHEAD_MS,
  ).toISOString();
  const staleCutoff = new Date(
    nowDate.getTime() - STALE_RECONCILIATION_MS,
  ).toISOString();

  // Shops whose cycle is ending soon OR whose last reconciliation
  // is older than the staleness cutoff (catches uninstalled tokens,
  // revoked sessions, dropped webhooks, etc.).
  const { data: rows } = await sb
    .from("plan_entitlements")
    .select("shop_id, billing_cycle_ends_at, last_reconciled_at")
    .or(
      `billing_cycle_ends_at.lte.${cutoffEnding},last_reconciled_at.is.null,last_reconciled_at.lte.${staleCutoff}`,
    );

  return (rows ?? []).map((r) => r.shop_id as string);
}

function pickPrimarySubscription(
  subs: ActiveSubscriptionNode[],
): ActiveSubscriptionNode | null {
  if (!subs.length) return null;
  const priority: Record<ShopifySubscriptionStatus, number> = {
    ACTIVE: 0,
    PENDING: 1,
    FROZEN: 2,
    CANCELLED: 3,
    EXPIRED: 4,
    DECLINED: 5,
  };
  return [...subs]
    .sort((a, b) => {
      const pa = priority[a.status] ?? 99;
      const pb = priority[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      // Newer first if same status.
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    })[0];
}

export function monthlyGrantReference(
  shopId: string,
  cycleEndIso: string,
): string {
  return `monthly_${shopId}_${cycleEndIso}`;
}

async function tryGrantMonthlyCredits(
  sb: ReturnType<typeof getServiceClient>,
  args: {
    shopId: string;
    packs: number;
    expiresAt: string;
    reference: string;
  },
): Promise<"granted" | "duplicate"> {
  // Check first so we can distinguish "this cron tick granted the
  // packs" from "the webhook beat us to it". Both are correct
  // outcomes; the audit event payload differs.
  const { data: existing } = await sb
    .from("pack_credits_ledger")
    .select("id")
    .eq("shop_id", args.shopId)
    .eq("reference", args.reference)
    .limit(1)
    .maybeSingle();
  if (existing) return "duplicate";

  try {
    await grantCredits({
      shopId: args.shopId,
      source: "monthly_included",
      packs: args.packs,
      expiresAt: args.expiresAt,
      reference: args.reference,
    });
    return "granted";
  } catch (err) {
    // Unique-violation = the webhook landed between our SELECT and
    // INSERT. Same outcome as duplicate from the merchant's POV.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return "duplicate";
    }
    throw err;
  }
}

async function touchReconciled(
  sb: ReturnType<typeof getServiceClient>,
  shopId: string,
  nowIso: string,
): Promise<void> {
  await sb
    .from("plan_entitlements")
    .update({ last_reconciled_at: nowIso })
    .eq("shop_id", shopId);
}
