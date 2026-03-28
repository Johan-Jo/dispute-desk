import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "dd_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Cookie path must be `/` so the browser sends `dd_admin_session` on `/api/admin/*` fetches, not only `/admin/*`. */
const ADMIN_COOKIE_PATH = "/";

/**
 * Validate admin credentials. V1 uses env-based secret.
 * Returns true if the password matches ADMIN_SECRET.
 */
export function validateAdminCredentials(password: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return password === secret;
}

/**
 * Create an admin session cookie.
 */
export async function createAdminSession() {
  const cookieStore = await cookies();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  cookieStore.set(ADMIN_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: ADMIN_COOKIE_PATH,
    expires,
  });
}

/**
 * Check if the current request has a valid admin session.
 */
export async function hasAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "authenticated";
}

/**
 * Append Set-Cookie headers to clear `dd_admin_session` for both current (`Path=/`)
 * and legacy (`Path=/admin`) cookies. Uses `NextResponse.headers.append` so two
 * `Set-Cookie` lines are emitted; `cookies().set` cannot reliably do same-name
 * clears for different paths in Route Handlers.
 */
export function clearAdminSessionOnResponse(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  const tail = secure ? "; Secure" : "";
  const base = `${ADMIN_COOKIE}=; HttpOnly; Max-Age=0; SameSite=Lax`;
  res.headers.append("Set-Cookie", `${base}; Path=/${tail}`);
  res.headers.append("Set-Cookie", `${base}; Path=/admin${tail}`);
}
