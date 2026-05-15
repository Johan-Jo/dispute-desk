/**
 * Subscription state machine (Phase 2 of billing-lifecycle PRD).
 *
 * Canonical values for `plan_entitlements.subscription_state` and the
 * one-way mapping from Shopify's `AppSubscriptionStatus` enum.
 *
 * The PRD (§ 4.2) explicitly leaves `pending` OFF the local enum.
 * Shopify's PENDING is collapsed into `trialing` (when trial window
 * is still open) or `expired` (otherwise) — never carried through.
 * Adding a `pending` state here means threading it through quota
 * checks, banners, billing-page copy, lifecycle emails, and tests;
 * that is its own PR, not this one.
 *
 * Keeping the canonical list in code (not a DB CHECK constraint) is
 * deliberate: a new state is one TypeScript edit instead of a
 * migration + backfill loop. The reconciler is the only writer, so
 * the discipline is enforceable at the seam.
 */

import type { ShopifySubscriptionStatus } from "@/lib/shopify/queries/activeSubscriptions";

export const SUBSCRIPTION_STATES = [
  "trialing",
  "active",
  "grace",
  "expired",
  "cancelled",
] as const;

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export interface MapStatusInput {
  status: ShopifySubscriptionStatus;
  /** ISO timestamp from `plan_entitlements.trial_ends_at` or whatever
   *  the most recent record of trial end is. May be null if the shop
   *  never had a trial. */
  trialEndsAt?: string | null;
  /** Allows tests to pin "now" without faking the Date constructor. */
  now?: Date;
}

/**
 * Map a Shopify subscription status to our local state. Defensive
 * about PENDING per PRD §5.1:
 *
 *   - PENDING + trial_ends_at in the future  → trialing
 *   - PENDING + trial_ends_at <= now (or null) → expired
 *
 * Both branches are documented as the only two acceptable outcomes
 * for PENDING. Tests assert both — the regression that this rule
 * exists to prevent is a non-trial pending charge falsely unlocking
 * auto-build.
 */
export function mapShopifyStatusToState(
  input: MapStatusInput,
): SubscriptionState {
  const now = (input.now ?? new Date()).getTime();
  const trialEndsMs = input.trialEndsAt
    ? new Date(input.trialEndsAt).getTime()
    : null;
  const trialWindowOpen =
    trialEndsMs !== null && Number.isFinite(trialEndsMs) && trialEndsMs > now;

  switch (input.status) {
    case "ACTIVE":
      return trialWindowOpen ? "trialing" : "active";
    case "FROZEN":
      return "grace";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
    case "DECLINED":
      return "expired";
    case "PENDING":
      return trialWindowOpen ? "trialing" : "expired";
  }
}

/** States in which automation may run. The reconciler does NOT use
 *  this — quota / feature gates do. Reading the helper from both
 *  the pipeline and the reconciler keeps the asymmetry honest. */
export const AUTOMATION_ALLOWED_STATES: ReadonlySet<SubscriptionState> =
  new Set<SubscriptionState>(["trialing", "active", "grace"]);

export function automationAllowed(state: SubscriptionState): boolean {
  return AUTOMATION_ALLOWED_STATES.has(state);
}

/** Read-only access is allowed in every state. The reconciler asserts
 *  this via test rather than runtime check because the historical
 *  read paths (disputes list, evidence pack view, audit timeline) do
 *  not currently call any billing gate — and they must not.
 *  Documented in the PRD § 5.4 invariant. */
export function readOnlyAccessAllowed(_state: SubscriptionState): true {
  return true;
}
