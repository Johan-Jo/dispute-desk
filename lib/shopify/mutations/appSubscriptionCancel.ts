/**
 * appSubscriptionCancel mutation — Shopify recurring billing.
 *
 * Cancels an active app subscription by GID. Used by the
 * downgrade-to-free path so a merchant can drop off a paid plan
 * without contacting support or reinstalling the app (Shopify App
 * Store review requirement, 2026-05).
 *
 * Shopify behaviour: after a successful cancel the subscription
 * status becomes `CANCELLED`. The merchant retains access until the
 * end of the current billing cycle (Shopify does not pro-rate). Our
 * reconciler picks up the new status on its next run, but the cancel
 * route also writes `plan_entitlements.subscription_state = "cancelled"`
 * + `shops.plan = "free"` inline so the billing page reflects the
 * change immediately.
 */

export const APP_SUBSCRIPTION_CANCEL_MUTATION = /* GraphQL */ `
  mutation AppSubscriptionCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface AppSubscriptionCancelResult {
  appSubscriptionCancel: {
    appSubscription: { id: string; status: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}
