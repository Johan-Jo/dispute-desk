/**
 * `currentAppInstallation.activeSubscriptions` query — the canonical
 * source for "what does Shopify think this shop is paying for right
 * now?".
 *
 * Used by the billing reconciliation cron
 * (`lib/billing/reconcileBillingCycle.ts`) and will be used by the
 * `app_subscriptions/update` webhook handler in Phase 3 — both
 * paths must verify against Shopify rather than trusting the local
 * `plan_entitlements` row or the webhook payload (which is replayable
 * and can be forged at the URL layer).
 *
 * Schema notes (Admin GraphQL 2026-01):
 *   - `currentAppInstallation` is the install matching the access
 *     token used in the request. No `$id` variable is needed; the
 *     server resolves "current" from the token. Convenient for the
 *     cron because we already hold the offline session per shop.
 *   - `AppSubscription.currentPeriodEnd` is the cycle end the
 *     reconciler trusts as the source of truth for billing-cycle
 *     timing — we mirror it into `plan_entitlements.billing_cycle_ends_at`.
 *   - `AppSubscription.test` is true for development charges; the
 *     reconciler honours it the same as production so non-prod shops
 *     get the same lifecycle.
 *   - `AppSubscriptionStatus` enum values: ACTIVE | CANCELLED |
 *     DECLINED | EXPIRED | FROZEN | PENDING.
 */

export const ACTIVE_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query CurrentInstallationActiveSubscriptions {
    currentAppInstallation {
      id
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        trialDays
        test
        createdAt
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

/** Shopify's canonical statuses for an app subscription. Listed in the
 *  Admin GraphQL 2026-01 enum `AppSubscriptionStatus`. */
export type ShopifySubscriptionStatus =
  | "ACTIVE"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN"
  | "PENDING";

export interface ActiveSubscriptionNode {
  id: string;
  name: string;
  status: ShopifySubscriptionStatus;
  /** ISO timestamp for the end of the current billing cycle. Null
   *  only on pre-activation states that we do not normally observe
   *  here (since the query is `activeSubscriptions`, we expect
   *  `PENDING` or above). */
  currentPeriodEnd: string | null;
  trialDays: number;
  test: boolean;
  createdAt: string;
  lineItems: Array<{
    plan: {
      pricingDetails: {
        __typename: string;
        price?: { amount: string; currencyCode: string };
        interval?: string;
      };
    };
  }>;
}

export interface ActiveSubscriptionsResponse {
  currentAppInstallation: {
    id: string;
    activeSubscriptions: ActiveSubscriptionNode[];
  } | null;
}
