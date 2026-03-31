import { NextRequest, NextResponse } from "next/server";
import { validateAdminCredentials } from "@/lib/admin/auth";

export const runtime = "nodejs";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!validateAdminCredentials(password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Set the cookie directly on the Response — cookies().set() is read-only in
  // Route Handlers in Next.js 15, so we use res.cookies.set() instead (same
  // pattern as clearAdminSessionOnResponse in lib/admin/auth.ts).
  const res = NextResponse.json({ ok: true });
  res.cookies.set("dd_admin_session", "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });
  return res;
}
