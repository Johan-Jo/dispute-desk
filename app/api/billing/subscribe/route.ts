import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { getPlan } from "@/lib/billing/plans";
import { checkTrialEligibility } from "@/lib/billing/trialEligibility";
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
 * Resolve a Shopify-asserted myshopify domain from the `shop` (domain) and/or
 * `host` (base64 of `admin.shopify.com/store/<handle>`) the embedded client
 * sends. Used to recover the live shop when the cookie-derived shop_id is stale.
 * Returns null unless the result is a well-formed myshopify domain.
 */
function resolveShopDomainFromInputs(
  shop: string | null | undefined,
  host: string | null | undefined,
): string | null {
  const isMyShopify = (d: string) =>
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d);

  const s = (shop ?? "").trim().toLowerCase();
  if (s && isMyShopify(s)) return s;

  if (host) {
    try {
      const decoded = Buffer.from(
        host.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
      const handle = decoded.split("/store/")[1]?.split(/[/?#]/)[0];
      if (handle) {
        const d = `${handle}.myshopify.com`.toLowerCase();
        if (isMyShopify(d)) return d;
      }
    } catch {
      /* malformed host */
    }
  }
  return null;
}

/**
 * POST /api/billing/subscribe
 * Body: { shop_id, plan_id }
 *
 * Creates a Shopify recurring subscription and returns the approval URL.
 */
export async function POST(req: NextRequest) {
  const raw = await req.json();
  const body = {
    ...raw,
    shop_id: raw?.shop_id ?? req.headers.get("x-shop-id") ?? undefined,
  };
  const validated = await validateBody(body, billingSubscribeSchema);
  if ("error" in validated) return validated.error;
  const { shop_id, plan_id, host, shop, return_to } = validated.data;

  const plan = getPlan(plan_id);

  const sb = getServiceClient();

  // Resolve the shop the offline session belongs to. `shop_id` comes from the
  // `x-shop-id` header / body, which can be derived from a stale
  // `shopify_shop_id` cookie (CHIPS cookie survives uninstall/reinstall and can
  // point at a deleted/old shop row). If the cookie-derived id has no offline
  // session, fall back to the Shopify-asserted `shop`/`host` the client sent and
  // resolve the live shop by domain — otherwise upgrade wrongly reports
  // "Reconnect this store". (Same class of bug as the /api/setup/* override.)
  let effectiveShopId = shop_id;
  let session: { access_token_encrypted: string; shop_domain: string | null } | null = null;

  async function loadOffline(id: string) {
    const { data } = await sb
      .from("shop_sessions")
      .select("access_token_encrypted, shop_domain")
      .eq("shop_id", id)
      .eq("session_type", "offline")
      .single();
    return data ?? null;
  }

  if (effectiveShopId) session = await loadOffline(effectiveShopId);

  if (!session) {
    const candidate = resolveShopDomainFromInputs(shop, host);
    if (candidate) {
      const { data: shopRow } = await sb
        .from("shops")
        .select("id")
        .eq("shop_domain", candidate)
        .maybeSingle();
      if (shopRow?.id) {
        effectiveShopId = shopRow.id;
        session = await loadOffline(shopRow.id);
      }
    }
  }

  if (!session || !effectiveShopId) {
    return NextResponse.json(
      { error: "Reconnect this store to upgrade. Use “Clear shop & reconnect” in the sidebar, then open the app from Shopify Admin." },
      { status: 404 }
    );
  }
  const resolvedShopId: string = effectiveShopId;

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
  const isTest =
    process.env.SHOPIFY_BILLING_TEST === "true" ||
    process.env.NODE_ENV !== "production";

  // Trial is a first-time-customer promotion only. Upgrades,
  // downgrades, reactivations, and resubscriptions after cancel
  // all happen INSTANTLY at the new price — no fresh 14 days on
  // top. The helper looks at plan_entitlements.trial_started_at
  // and any prior trial-source credit grant.
  const trialEligibility = await checkTrialEligibility(resolvedShopId);
  const trialDays = trialEligibility.eligible ? plan.trialDays : 0;

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const callbackUrl = new URL(`${appUrl}/api/billing/callback`);
  callbackUrl.searchParams.set("shop_id", resolvedShopId);
  callbackUrl.searchParams.set("plan_id", plan_id);
  // Carry the eligibility decision through the redirect so the
  // callback's credit-grant logic uses the same answer the
  // subscription was created with. The callback ALSO re-checks
  // independently as a belt-and-suspenders gate.
  callbackUrl.searchParams.set(
    "trial_granted",
    trialEligibility.eligible ? "1" : "0",
  );
  if (host) callbackUrl.searchParams.set("host", host);
  if (shop) callbackUrl.searchParams.set("shop", shop);
  // Where the callback should land the merchant post-approval (validated
  // against an allow-list there). Onboarding sends "/app".
  if (return_to) callbackUrl.searchParams.set("return_to", return_to);
  const returnUrl = callbackUrl.toString();

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
      trialDays,
      test: isTest,
    },
    correlationId: `billing-${resolvedShopId}`,
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
    shop_id: resolvedShopId,
    actor_type: "merchant",
    event_type: "billing_subscription_created",
    event_payload: {
      plan_id,
      subscription_id: mutation.appSubscription?.id,
      test: isTest,
      trial_granted: trialEligibility.eligible,
      trial_days: trialDays,
      trial_eligibility_reason: trialEligibility.reason,
    },
  });

  return NextResponse.json({
    confirmationUrl: mutation.confirmationUrl,
    subscriptionId: mutation.appSubscription?.id,
  });
}
