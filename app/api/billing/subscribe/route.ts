import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { getPlan } from "@/lib/billing/plans";
import { validateBody, billingSubscribeSchema } from "@/lib/middleware/validate";
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
  const body = await req.json();
  const validated = await validateBody(body, billingSubscribeSchema);
  if ("error" in validated) return validated.error;
  const { shop_id, plan_id } = validated.data;

  const plan = getPlan(plan_id);

  const sb = getServiceClient();

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, shop_domain")
    .eq("shop_id", shop_id)
    .eq("session_type", "offline")
    .single();

  if (!session) {
    return NextResponse.json(
      { error: "Reconnect this store to upgrade. Use “Clear shop & reconnect” in the sidebar, then open the app from Shopify Admin." },
      { status: 404 }
    );
  }

  const shopDomain = session.shop_domain?.trim() || null;
  if (!shopDomain) {
    return NextResponse.json(
      {
        error:
          'Store session is invalid (missing shop domain). Use "Clear shop & reconnect" in the sidebar, then open the app from Shopify Admin.',
      },
      { status: 400 }
    );
  }

  const accessToken = decryptToken(session.access_token_encrypted);
  const isTest = process.env.NODE_ENV !== "production";

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const returnUrl = `${appUrl}/api/billing/callback?shop_id=${shop_id}&plan_id=${plan_id}`;

  const result = await requestShopifyGraphQL<AppSubscriptionCreateResult>({
    session: { shopDomain, accessToken },
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
