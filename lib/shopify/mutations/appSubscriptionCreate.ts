/**
 * appSubscriptionCreate mutation — Shopify recurring billing.
 *
 * Creates a subscription charge that the merchant must approve.
 * Returns a confirmationUrl that the merchant is redirected to.
 */

export const APP_SUBSCRIPTION_CREATE_MUTATION = `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export interface AppSubscriptionCreateResult {
  appSubscriptionCreate: {
    appSubscription: { id: string; status: string } | null;
    confirmationUrl: string | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}
