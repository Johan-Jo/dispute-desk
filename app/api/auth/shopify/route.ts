import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateNonce, encodeOAuthState } from "@/lib/shopify/auth";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/** Only the paid tiers are worth deep-linking to the upgrade screen. */
function normalizePlanParam(value: string | null): PlanId | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v in PLANS && v !== "free") return v as PlanId;
  return undefined;
}

/**
 * GET /api/auth/shopify?shop=xxx.myshopify.com[&source=portal&return_to=/auth/open-in-shopify&plan=growth]
 *
 * Initiates Shopify OAuth. Encodes phase/source/return_to/plan in a signed
 * state token so the callback can recover them without cookies (which are
 * unreliable across cross-site redirects). `plan` is the tier the merchant
 * chose on the marketing pricing page — the callback uses it to deep-link them
 * to the in-app upgrade screen instead of silently landing on Free.
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 }
    );
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!apiKey || !appUrl) {
    console.error(
      "[auth/shopify] Missing env: SHOPIFY_API_KEY=%s SHOPIFY_APP_URL=%s",
      apiKey ? "set" : "missing",
      appUrl ? "set" : "missing"
    );
    return NextResponse.json(
      {
        error: "Server misconfiguration",
        detail:
          "SHOPIFY_API_KEY or SHOPIFY_APP_URL is not set. Set them in .env.local (local) or in your hosting provider's environment (e.g. Vercel).",
      },
      { status: 500 }
    );
  }

  const phase = req.nextUrl.searchParams.get("phase") ?? "offline";
  const isOnline = phase === "online";
  const source = req.nextUrl.searchParams.get("source") ?? "embedded";
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "";
  const plan = normalizePlanParam(req.nextUrl.searchParams.get("plan"));

  const nonce = generateNonce();
  const stateToken = encodeOAuthState({ nonce, phase, source, returnTo, plan });

  const authUrl = buildAuthUrl(shop, stateToken, isOnline);

  return NextResponse.redirect(authUrl);
}
