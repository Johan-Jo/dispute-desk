/**
 * Server-to-server Shopify charge verification.
 *
 * Both billing callbacks (`/api/billing/callback`,
 * `/api/billing/topup-callback`) need to verify a charge_id query
 * parameter is real before granting credits or upgrading a plan.
 * Without this gate, anyone could craft a URL like
 *
 *   /api/billing/topup-callback?shop_id=<real>&sku=topup_25&charge_id=anything
 *
 * and walk away with free credits.
 *
 * The verification calls Shopify GraphQL `node($id)` for the charge GID
 * and accepts ONLY status === "ACTIVE" (both subscription and one-time
 * billing). The reported price is compared against the expected plan or
 * top-up price within 1 cent — this defends against an attacker pairing
 * a real but cheaper charge_id with a `plan_id=scale` to upgrade for
 * Starter-tier money.
 *
 * Status semantics (Shopify docs, verified 2026-05-13):
 *   - AppSubscription: PENDING (pre-approval), ACTIVE (approved+billed),
 *     DECLINED, EXPIRED, CANCELLED, FROZEN. Only ACTIVE means money
 *     changed hands.
 *   - AppPurchaseOneTime: PENDING (pre-approval), ACCEPTED (approved
 *     but pre-capture), ACTIVE (captured), DECLINED, EXPIRED. Only
 *     ACTIVE means the charge succeeded.
 *
 * GID construction: Shopify's redirect to our callback passes the
 * numeric charge id (`?charge_id=12345678`), not the GID. We construct
 * the GID locally — `gid://shopify/AppSubscription/${id}` for the
 * recurring path, `gid://shopify/AppPurchaseOneTime/${id}` for one-time.
 */

import { requestShopifyGraphQL } from "../graphql";
import {
  getShopBackgroundSession,
  NoBackgroundSessionError,
} from "../sessions/getShopBackgroundSession";

export const APP_CHARGE_STATUS_QUERY = /* GraphQL */ `
  query AppChargeStatus($id: ID!) {
    node(id: $id) {
      __typename
      ... on AppSubscription {
        id
        name
        status
        test
        currentPeriodEnd
        trialDays
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
      ... on AppPurchaseOneTime {
        id
        name
        status
        test
        price {
          amount
          currencyCode
        }
      }
    }
  }
`;

export type VerifyAppChargeReason =
  | "node_not_found"
  | "wrong_type"
  | "not_active"
  | "price_mismatch"
  | "currency_mismatch"
  | "shopify_error"
  | "no_session";

export interface VerifyAppChargeOptions {
  shopId: string;
  /** Numeric id from the callback (`?charge_id=12345`) OR a full GID. */
  chargeId: string;
  chargeType: "subscription" | "one_time";
  /** Plan price (USD) for subscription, top-up price (USD) for one-time. */
  expectedAmountUsd: number;
}

export interface VerifyAppChargeResult {
  verified: boolean;
  status: string | null;
  reason?: VerifyAppChargeReason;
  rawAmountUsd?: number;
  shopifyChargeGid?: string;
  /** Surfaced for log lines so on-call can identify test-mode charges. */
  test?: boolean;
}

interface RecurringPricing {
  __typename: "AppRecurringPricing";
  price: { amount: string; currencyCode: string };
  interval: string;
}

interface AppSubscriptionNode {
  __typename: "AppSubscription";
  id: string;
  status: string;
  test: boolean;
  lineItems: Array<{
    plan: {
      pricingDetails: RecurringPricing | { __typename: string };
    };
  }>;
}

interface AppPurchaseOneTimeNode {
  __typename: "AppPurchaseOneTime";
  id: string;
  status: string;
  test: boolean;
  price: { amount: string; currencyCode: string };
}

type ChargeNode =
  | AppSubscriptionNode
  | AppPurchaseOneTimeNode
  | { __typename: string };

function buildGid(chargeId: string, chargeType: "subscription" | "one_time"): string {
  if (chargeId.startsWith("gid://")) return chargeId;
  return chargeType === "subscription"
    ? `gid://shopify/AppSubscription/${chargeId}`
    : `gid://shopify/AppPurchaseOneTime/${chargeId}`;
}

/**
 * Verify a Shopify billing charge against Shopify's GraphQL API.
 *
 * Returns `{verified: true}` ONLY when:
 *   1. The charge GID resolves to a node.
 *   2. The node's `__typename` matches `chargeType`.
 *   3. The node's `status === "ACTIVE"`.
 *   4. The reported price equals `expectedAmountUsd` within 1 cent and
 *      currency is USD.
 *
 * Never throws. Callers branch on `result.verified`.
 */
export async function verifyAppCharge(
  opts: VerifyAppChargeOptions,
): Promise<VerifyAppChargeResult> {
  const { shopId, chargeId, chargeType, expectedAmountUsd } = opts;
  const gid = buildGid(chargeId, chargeType);

  let session;
  try {
    session = await getShopBackgroundSession(shopId);
  } catch (err) {
    if (err instanceof NoBackgroundSessionError) {
      console.warn(
        `[billing-verify] no offline session for shop ${shopId} — cannot verify charge ${chargeId}`,
      );
      return { verified: false, status: null, reason: "no_session" };
    }
    throw err;
  }

  let response;
  try {
    response = await requestShopifyGraphQL<{ node: ChargeNode | null }>({
      session: { shopDomain: session.shopDomain, accessToken: session.accessToken },
      query: APP_CHARGE_STATUS_QUERY,
      variables: { id: gid },
      correlationId: `verify-charge-${chargeId}`,
    });
  } catch (err) {
    console.error(`[billing-verify] request failed for shop ${shopId}:`, err);
    return { verified: false, status: null, reason: "shopify_error" };
  }

  if (response.errors?.length) {
    console.warn(
      `[billing-verify] graphql errors for shop ${shopId}:`,
      response.errors.map((e) => e.message).join("; "),
    );
    return { verified: false, status: null, reason: "shopify_error" };
  }

  const node = response.data?.node ?? null;
  if (!node) {
    return {
      verified: false,
      status: null,
      reason: "node_not_found",
      shopifyChargeGid: gid,
    };
  }

  const expectedTypename =
    chargeType === "subscription" ? "AppSubscription" : "AppPurchaseOneTime";
  if (node.__typename !== expectedTypename) {
    return {
      verified: false,
      status: null,
      reason: "wrong_type",
      shopifyChargeGid: gid,
    };
  }

  if (chargeType === "subscription") {
    const sub = node as AppSubscriptionNode;
    if (sub.status !== "ACTIVE") {
      return {
        verified: false,
        status: sub.status,
        reason: "not_active",
        shopifyChargeGid: gid,
        test: sub.test,
      };
    }
    const pricing = sub.lineItems[0]?.plan.pricingDetails as
      | RecurringPricing
      | undefined;
    if (!pricing || pricing.__typename !== "AppRecurringPricing") {
      return {
        verified: false,
        status: sub.status,
        reason: "wrong_type",
        shopifyChargeGid: gid,
        test: sub.test,
      };
    }
    if (pricing.price.currencyCode !== "USD") {
      return {
        verified: false,
        status: sub.status,
        reason: "currency_mismatch",
        shopifyChargeGid: gid,
        test: sub.test,
      };
    }
    const rawAmountUsd = Number(pricing.price.amount);
    if (!Number.isFinite(rawAmountUsd)
      || Math.abs(rawAmountUsd - expectedAmountUsd) >= 0.01) {
      return {
        verified: false,
        status: sub.status,
        reason: "price_mismatch",
        rawAmountUsd,
        shopifyChargeGid: gid,
        test: sub.test,
      };
    }
    if (sub.test) {
      console.log(
        `[billing-verify] test_charge=true type=subscription shop=${shopId} gid=${gid}`,
      );
    }
    return {
      verified: true,
      status: sub.status,
      rawAmountUsd,
      shopifyChargeGid: gid,
      test: sub.test,
    };
  }

  const onetime = node as AppPurchaseOneTimeNode;
  if (onetime.status !== "ACTIVE") {
    return {
      verified: false,
      status: onetime.status,
      reason: "not_active",
      shopifyChargeGid: gid,
      test: onetime.test,
    };
  }
  if (onetime.price.currencyCode !== "USD") {
    return {
      verified: false,
      status: onetime.status,
      reason: "currency_mismatch",
      shopifyChargeGid: gid,
      test: onetime.test,
    };
  }
  const rawAmountUsd = Number(onetime.price.amount);
  if (!Number.isFinite(rawAmountUsd)
    || Math.abs(rawAmountUsd - expectedAmountUsd) >= 0.01) {
    return {
      verified: false,
      status: onetime.status,
      reason: "price_mismatch",
      rawAmountUsd,
      shopifyChargeGid: gid,
      test: onetime.test,
    };
  }
  if (onetime.test) {
    console.log(
      `[billing-verify] test_charge=true type=one_time shop=${shopId} gid=${gid}`,
    );
  }
  return {
    verified: true,
    status: onetime.status,
    rawAmountUsd,
    shopifyChargeGid: gid,
    test: onetime.test,
  };
}
