import { cookies } from "next/headers";

const ADMIN_COOKIE = "dd_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

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
    path: "/admin",
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
 * Clear the admin session.
 */
export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}
