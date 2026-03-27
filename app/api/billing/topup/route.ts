import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getTopUp } from "@/lib/billing/plans";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { validateBody, billingTopUpSchema } from "@/lib/middleware/validate";

export const runtime = "nodejs";

const APP_PURCHASE_ONE_TIME_CREATE = `
  mutation AppPurchaseOneTimeCreate(
    $name: String!
    $price: MoneyInput!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appPurchaseOneTimeCreate(
      name: $name
      price: $price
      returnUrl: $returnUrl
      test: $test
    ) {
      appPurchaseOneTime {
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

function decryptToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch {
    return encrypted;
  }
}

/**
 * POST /api/billing/topup
 * Body: { shop_id, sku }
 *
 * Creates a one-time Shopify charge for a pack top-up bundle.
 */
export async function POST(req: NextRequest) {
  const raw = await req.json();
  const body = {
    ...raw,
    shop_id: raw?.shop_id ?? req.headers.get("x-shop-id") ?? undefined,
  };
  const validated = await validateBody(body, billingTopUpSchema);
  if ("error" in validated) return validated.error;
  const { shop_id, sku } = validated.data;

  const topUp = getTopUp(sku);
  if (!topUp) {
    return NextResponse.json({ error: "Invalid top-up SKU" }, { status: 400 });
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
  const returnUrl = `${appUrl}/api/billing/topup-callback?shop_id=${shop_id}&sku=${sku}`;

  const result = await requestShopifyGraphQL<{
    appPurchaseOneTimeCreate: {
      appPurchaseOneTime: { id: string; status: string } | null;
      confirmationUrl: string | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>({
    session: { shopDomain: session.shop_domain, accessToken },
    query: APP_PURCHASE_ONE_TIME_CREATE,
    variables: {
      name: `DisputeDesk ${topUp.label}`,
      price: { amount: topUp.priceUsd, currencyCode: "USD" },
      returnUrl,
      test: isTest,
    },
    correlationId: `topup-${shop_id}-${sku}`,
  });

  const mutation = result.data?.appPurchaseOneTimeCreate;
  const userErrors = mutation?.userErrors ?? [];

  if (userErrors.length > 0) {
    return NextResponse.json(
      { error: userErrors.map((e) => e.message).join(", ") },
      { status: 422 }
    );
  }

  return NextResponse.json({
    confirmationUrl: mutation?.confirmationUrl,
    purchaseId: mutation?.appPurchaseOneTime?.id,
  });
}
