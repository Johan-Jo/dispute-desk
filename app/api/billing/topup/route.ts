import { NextRequest, NextResponse } from "next/server";
import { isBillingTestMode } from "@/lib/billing/testMode";
import { getTopUp } from "@/lib/billing/plans";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { NoBackgroundSessionError } from "@/lib/shopify/sessions/getShopBackgroundSession";
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
  const { shop_id, sku, host, shop } = validated.data;

  const topUp = getTopUp(sku);
  if (!topUp) {
    return NextResponse.json({ error: "Invalid top-up SKU" }, { status: 400 });
  }

  // Test charges on dev/local (dev stores reject real charges);
  // single source of truth in lib/billing/testMode.ts.
  const isTest = isBillingTestMode();
  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const callbackUrl = new URL(`${appUrl}/api/billing/topup-callback`);
  callbackUrl.searchParams.set("shop_id", shop_id);
  callbackUrl.searchParams.set("sku", sku);
  // Carry host/shop through Shopify's approval redirect so the
  // callback can hand a fully-embedded URL back to the merchant.
  // Without this the redirect lands on the bare web URL, breaking
  // out of the Admin iframe and stripping the s-app-nav chrome.
  if (host) callbackUrl.searchParams.set("host", host);
  if (shop) callbackUrl.searchParams.set("shop", shop);
  const returnUrl = callbackUrl.toString();

  // Canonical authed request (expiring offline tokens): loads the
  // session, decrypts, refreshes near-expiry tokens, and force-retries
  // once on auth-invalid. The previous hand-rolled load+decrypt here
  // bypassed all of that — an expired offline token surfaced as
  // "[API] Invalid API key or access token" (dev, 2026-07-26).
  let result: Awaited<ReturnType<typeof makeAuthedRequest<{
    appPurchaseOneTimeCreate: {
      appPurchaseOneTime: { id: string; status: string } | null;
      confirmationUrl: string | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>>>;
  try {
    result = await makeAuthedRequest({
      shopId: shop_id,
      query: APP_PURCHASE_ONE_TIME_CREATE,
      variables: {
        name: `DisputeDesk ${topUp.label}`,
        price: { amount: topUp.priceUsd, currencyCode: "USD" },
        returnUrl,
        test: isTest,
      },
      correlationId: `topup-${shop_id}-${sku}`,
    });
  } catch (e) {
    if (e instanceof NoBackgroundSessionError) {
      return NextResponse.json({ error: "No session found" }, { status: 404 });
    }
    throw e;
  }

  // Surface top-level GraphQL errors (requestShopifyGraphQL returns
  // them in-band and never throws). Without this, an "Access denied" /
  // managed-pricing / scope failure became a silent 200 with no
  // confirmationUrl — the merchant saw only the generic "didn't go
  // through" banner and the logs showed nothing (dev, 2026-07-26).
  const gqlErrors = (result as { errors?: Array<{ message: string }> }).errors ?? [];
  if (gqlErrors.length > 0) {
    const messages = gqlErrors.map((e) => e.message);
    console.error("[billing/topup] Shopify GraphQL errors", {
      shopId: shop_id,
      messages,
    });
    return NextResponse.json({ error: messages.join(", ") }, { status: 422 });
  }

  const mutation = result.data?.appPurchaseOneTimeCreate;
  const userErrors = mutation?.userErrors ?? [];

  if (userErrors.length > 0) {
    return NextResponse.json(
      { error: userErrors.map((e) => e.message).join(", ") },
      { status: 422 }
    );
  }

  if (!mutation?.confirmationUrl) {
    console.error("[billing/topup] no confirmationUrl returned", {
      shopId: shop_id,
      mutation,
    });
    return NextResponse.json(
      { error: "Shopify did not return a charge confirmation URL." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    confirmationUrl: mutation.confirmationUrl,
    purchaseId: mutation.appPurchaseOneTime?.id,
  });
}
