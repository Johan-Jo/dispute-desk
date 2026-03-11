import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyHmac, exchangeCodeForToken, decodeOAuthState } from "@/lib/shopify/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";

const APP_URL = process.env.SHOPIFY_APP_URL!;

/**
 * GET /api/auth/shopify/callback
 *
 * Handles both offline and online OAuth callbacks.
 * Phase/source/return_to are recovered from the signed state token (not cookies).
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, code, state } = params;

  if (!shop || !code || !state) {
    return NextResponse.json(
      { error: "Missing required OAuth parameters" },
      { status: 400 }
    );
  }

  if (!verifyHmac(params)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 403 }
    );
  }

  const oauthState = decodeOAuthState(state);
  if (!oauthState) {
    return NextResponse.json(
      { error: "Invalid or tampered state token" },
      { status: 403 }
    );
  }

  const { phase, source, returnTo } = oauthState;

  try {
    let tokenResult;
    try {
      tokenResult = await exchangeCodeForToken(shop, code);
    } catch (exchangeErr) {
      const msg = exchangeErr instanceof Error ? exchangeErr.message : "";
      if (msg.includes("already used") || msg.includes("invalid_request")) {
        console.warn("[auth/shopify/callback] Auth code expired or reused, restarting OAuth");
        const retryUrl =
          `${APP_URL}/api/auth/shopify?shop=${encodeURIComponent(shop)}` +
          `&source=${source}&return_to=${encodeURIComponent(returnTo || "")}`;
        return NextResponse.redirect(retryUrl);
      }
      throw exchangeErr;
    }

    const db = getServiceClient();
    const { data: existingShop } = await db
      .from("shops")
      .select("id")
      .eq("shop_domain", shop)
      .single();

    let shopInternalId: string;

    if (existingShop) {
      shopInternalId = existingShop.id;
      await db
        .from("shops")
        .update({
          uninstalled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shopInternalId);
    } else {
      const { data: newShop, error } = await db
        .from("shops")
        .insert({ shop_domain: shop })
        .select("id")
        .single();
      if (error || !newShop) {
        return NextResponse.json(
          { error: `Failed to create shop: ${error?.message}` },
          { status: 500 }
        );
      }
      shopInternalId = newShop.id;
    }

    const cookieStore = await cookies();

    if (phase === "offline") {
      await storeSession({
        shopInternalId,
        shopDomain: shop,
        sessionType: "offline",
        userId: null,
        accessToken: tokenResult.accessToken,
        scopes: tokenResult.scope,
        expiresAt: null,
      });

      registerDisputeWebhooks({
        shopDomain: shop,
        accessToken: tokenResult.accessToken,
      })
        .then((result) => {
          if (!result.ok && result.errors.length) {
            console.warn("[webhooks] Dispute webhook registration:", result.errors);
          }
        })
        .catch((err) => {
          console.warn("[webhooks] Dispute webhook registration failed:", err?.message ?? err);
        });

      if (source === "portal") {
        await linkPortalUserToShop(req, db, shopInternalId);
        await ensureShopSetup(db, shopInternalId);
        const destination = returnTo === "/portal/select-store"
          ? "/portal/dashboard"
          : (returnTo || "/portal/dashboard");
        const res = NextResponse.redirect(new URL(destination, req.url));
        const cookieOpts = {
          httpOnly: true,
          secure: true,
          sameSite: "lax" as const,
          maxAge: 60 * 60 * 24 * 90,
          path: "/",
        };
        res.cookies.set("active_shop_id", shopInternalId, cookieOpts);
        res.cookies.set("dd_active_shop", shopInternalId, cookieOpts);
        return res;
      }

      const onlineAuthUrl = `${APP_URL}/api/auth/shopify?shop=${shop}&phase=online`;
      return NextResponse.redirect(onlineAuthUrl);
    }

    const userId = tokenResult.associatedUser?.id?.toString() ?? null;
    const expiresAt = tokenResult.expiresIn
      ? new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString()
      : null;

    await storeSession({
      shopInternalId,
      shopDomain: shop,
      sessionType: "online",
      userId,
      accessToken: tokenResult.accessToken,
      scopes: tokenResult.scope,
      expiresAt,
    });

    cookieStore.set("shopify_shop", shop, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    cookieStore.set("shopify_shop_id", shopInternalId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    const embeddedUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    return NextResponse.redirect(embeddedUrl);
  } catch (err) {
    console.error("[auth/shopify/callback] Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "OAuth callback failed", detail: message },
      { status: 500 }
    );
  }
}

async function ensureShopSetup(
  db: ReturnType<typeof getServiceClient>,
  shopId: string
) {
  const { data: existing } = await db
    .from("shop_setup")
    .select("shop_id, steps")
    .eq("shop_id", shopId)
    .single();

  const permissionsDone = {
    status: "done",
    completed_at: new Date().toISOString(),
    payload: { auto: true, trigger: "oauth_callback" },
  };

  if (!existing) {
    await db.from("shop_setup").insert({
      shop_id: shopId,
      steps: { permissions: permissionsDone },
      current_step: "permissions",
    });
  } else {
    const steps = (existing.steps ?? {}) as Record<string, unknown>;
    const alreadyDone =
      steps.permissions &&
      (steps.permissions as { status?: string }).status === "done";
    if (!alreadyDone) {
      steps.permissions = permissionsDone;
      await db
        .from("shop_setup")
        .update({
          steps,
          current_step: "permissions",
          updated_at: new Date().toISOString(),
        })
        .eq("shop_id", shopId);
    }
  }
}

async function linkPortalUserToShop(
  req: NextRequest,
  db: ReturnType<typeof getServiceClient>,
  shopId: string
) {
  const { createServerClient } = await import("@supabase/ssr");

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { count } = await db
    .from("portal_user_shops")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const isFirstShop = (count ?? 0) === 0;

  await db.from("portal_user_shops").upsert(
    {
      user_id: user.id,
      shop_id: shopId,
      role: "admin",
    },
    { onConflict: "user_id,shop_id" }
  );

  if (isFirstShop && user.email) {
    const fullName =
      (user.user_metadata?.full_name as string | undefined)?.trim() || undefined;
    sendWelcomeEmail({
      to: user.email,
      fullName,
      idempotencyKey: `welcome/${user.id}`,
    }).then((result) => {
      if (!result.ok) console.warn("[email] Welcome send failed after OAuth:", result.error);
    });
  }
}
