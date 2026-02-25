import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import {
  APP_SUBSCRIPTION_CREATE_MUTATION,
  type AppSubscriptionCreateResult,
} from "@/lib/shopify/mutations/appSubscriptionCreate";

export const runtime = "nodejs";

function decryptToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch {
    return encrypted;
  }
}

/**
 * POST /api/billing/subscribe
 * Body: { shop_id, plan_id }
 *
 * Creates a Shopify recurring subscription and returns the approval URL.
 */
export async function POST(req: NextRequest) {
  const { shop_id, plan_id } = await req.json();

  if (!shop_id || !plan_id) {
    return NextResponse.json({ error: "shop_id and plan_id required" }, { status: 400 });
  }

  const plan = getPlan(plan_id);
  if (plan.price === 0) {
    return NextResponse.json({ error: "Cannot subscribe to free plan via billing" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, shop_domain")
    .eq("shop_id", shop_id)
    .eq("session_type", "offline")
    .single();

  if (!session) {
    return NextResponse.json({ error: "No session found" }, { status: 404 });
  }

  const accessToken = decryptToken(session.access_token_encrypted);
  const isTest = process.env.NODE_ENV !== "production";

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const returnUrl = `${appUrl}/api/billing/callback?shop_id=${shop_id}&plan_id=${plan_id}`;

  const result = await requestShopifyGraphQL<AppSubscriptionCreateResult>({
    session: { shopDomain: session.shop_domain, accessToken },
    query: APP_SUBSCRIPTION_CREATE_MUTATION,
    variables: {
      name: `DisputeDesk ${plan.name}`,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: plan.price, currencyCode: "USD" },
            },
          },
        },
      ],
      returnUrl,
      trialDays: plan.trialDays,
      test: isTest,
    },
    correlationId: `billing-${shop_id}`,
  });

  const mutation = result.data?.appSubscriptionCreate;
  const userErrors = mutation?.userErrors ?? [];

  if (userErrors.length > 0) {
    return NextResponse.json(
      { error: userErrors.map((e) => e.message).join(", ") },
      { status: 422 }
    );
  }

  if (!mutation?.confirmationUrl) {
    return NextResponse.json({ error: "No confirmation URL returned" }, { status: 500 });
  }

  await sb.from("audit_events").insert({
    shop_id,
    actor_type: "merchant",
    event_type: "billing_subscription_created",
    event_payload: {
      plan_id,
      subscription_id: mutation.appSubscription?.id,
      test: isTest,
    },
  });

  return NextResponse.json({
    confirmationUrl: mutation.confirmationUrl,
    subscriptionId: mutation.appSubscription?.id,
  });
}
