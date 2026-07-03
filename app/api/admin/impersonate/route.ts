import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  impersonationCookieOptions,
  signImpersonation,
  verifyImpersonationValue,
  type ImpersonationMode,
} from "@/lib/admin/impersonation";

export const runtime = "nodejs";

/**
 * POST /api/admin/impersonate — enter "View as merchant" for one shop.
 *
 * Grant-gated by the `/api/admin/*` middleware AND re-checked here. Validates
 * the shop exists, signs a short-TTL cookie, audits the enter, and returns the
 * target URL. The caller opens that URL in a new top-level tab.
 *
 * Body: { shopId: string, mode?: "read" | "write" }  (default mode: "read")
 */
export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = await getAdminSessionUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    shopId?: unknown;
    mode?: unknown;
  } | null;
  const shopId = typeof body?.shopId === "string" ? body.shopId : "";
  const mode: ImpersonationMode = body?.mode === "write" ? "write" : "read";

  if (!shopId) {
    return NextResponse.json({ error: "shopId is required" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id, shop_domain")
    .eq("id", shopId)
    .maybeSingle();

  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const cookieValue = await signImpersonation({
    shopId: shop.id,
    shopDomain: shop.shop_domain,
    mode,
    adminUserId: admin.id,
    iat: Math.floor(Date.now() / 1000),
  });

  await logAuditEvent({
    shopId: shop.id,
    actorType: "system",
    actorId: admin.id,
    eventType: "admin_impersonation_started",
    eventPayload: {
      admin: true,
      adminUserId: admin.id,
      adminEmail: admin.email,
      mode,
    },
  });

  const res = NextResponse.json({
    ok: true,
    targetUrl: "/app",
    shopDomain: shop.shop_domain,
    mode,
  });
  res.cookies.set(
    IMPERSONATION_COOKIE,
    cookieValue,
    impersonationCookieOptions(IMPERSONATION_TTL_SECONDS),
  );
  return res;
}

/**
 * DELETE /api/admin/impersonate — exit impersonation (clear the cookie).
 *
 * Idempotent. Audits the exit when a valid cookie was present. Reachable while
 * impersonating even if the grant lapsed, so it does NOT hard-require an admin
 * session — but it clears only our own signed cookie.
 */
export async function DELETE(req: NextRequest) {
  const existing = await verifyImpersonationValue(
    req.cookies.get(IMPERSONATION_COOKIE)?.value,
  );

  if (existing) {
    try {
      await logAuditEvent({
        shopId: existing.shopId,
        actorType: "system",
        actorId: existing.adminUserId,
        eventType: "admin_impersonation_ended",
        eventPayload: { admin: true, adminUserId: existing.adminUserId },
      });
    } catch {
      /* audit best-effort — never block the exit */
    }
  }

  const res = NextResponse.json({ ok: true });
  // Expire with the SAME attributes the cookie was set with, or the browser
  // keeps the old value (sameSite=none; partitioned).
  res.cookies.set(
    IMPERSONATION_COOKIE,
    "",
    impersonationCookieOptions(0),
  );
  return res;
}
