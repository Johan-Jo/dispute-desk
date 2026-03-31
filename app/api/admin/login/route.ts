import { NextRequest, NextResponse } from "next/server";
import {
  validateAdminCredentials,
  buildAdminCookieToken,
  SESSION_TTL_MS,
  ADMIN_COOKIE,
  ADMIN_COOKIE_PATH,
} from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const result = await validateAdminCredentials(email, password);

  if (!result.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = buildAdminCookieToken(result.user.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: ADMIN_COOKIE_PATH,
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });

  // Update last_login_at (fire-and-forget; skip for bootstrap user)
  if (result.user.id !== "bootstrap") {
    void getServiceClient()
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", result.user.id);
  }

  return res;
}
