import crypto from "crypto";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getServiceClient } from "@/lib/supabase/server";

const ADMIN_COOKIE = "dd_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Cookie path must be `/` so the browser sends `dd_admin_session` on `/api/admin/*` fetches. */
const ADMIN_COOKIE_PATH = "/";

// ─── Types ────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by: string | null;
}

// ─── Password helpers ─────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── Cookie token helpers ─────────────────────────────────────────────────

function secret(): string {
  return process.env.ADMIN_SECRET ?? "";
}

/** Build a `userId:hmac` token for the session cookie. */
export function buildAdminCookieToken(userId: string): string {
  const sig = crypto
    .createHmac("sha256", secret())
    .update(userId)
    .digest("hex");
  return `${userId}:${sig}`;
}

/**
 * Verify the HMAC on a session cookie value WITHOUT hitting the database.
 * Used in middleware (sync, no DB access).
 */
export function verifyAdminCookieToken(value: string | undefined): boolean {
  if (!value) return false;
  const colon = value.indexOf(":");
  if (colon === -1) return false;
  const userId = value.slice(0, colon);
  const sig = value.slice(colon + 1);
  if (!userId || !sig) return false;
  const expected = crypto
    .createHmac("sha256", secret())
    .update(userId)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Credential validation ────────────────────────────────────────────────

export type CredentialResult =
  | { ok: true; user: Pick<AdminUser, "id" | "email" | "name"> }
  | { ok: false };

/**
 * Validate admin email + password against the `admin_users` table.
 *
 * Bootstrap fallback: when the table has zero active users and
 * `ADMIN_SECRET` is set, the login `admin@bootstrap` / ADMIN_SECRET value
 * is accepted so the first real account can be created.
 */
export async function validateAdminCredentials(
  email: string,
  password: string
): Promise<CredentialResult> {
  const db = getServiceClient();

  // Fetch the matching user (case-insensitive email)
  const { data: user } = await db
    .from("admin_users")
    .select("id, email, name, is_active, password_hash")
    .ilike("email", email.trim())
    .single();

  if (user) {
    if (!user.is_active) return { ok: false };
    const match = await verifyPassword(password, user.password_hash);
    if (!match) return { ok: false };
    return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
  }

  // Bootstrap fallback — only when table is empty
  const sec = secret();
  if (sec && password === sec && email.trim().toLowerCase() === "admin@bootstrap") {
    const { count } = await db
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    if ((count ?? 0) === 0) {
      return {
        ok: true,
        user: { id: "bootstrap", email: "admin@bootstrap", name: "Bootstrap" },
      };
    }
  }

  return { ok: false };
}

// ─── Session helpers ──────────────────────────────────────────────────────

/**
 * Check if the current request has a valid admin session (HMAC + DB active check).
 * Use in async API route handlers.
 */
export async function hasAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!verifyAdminCookieToken(value)) return false;

  const userId = value!.slice(0, value!.indexOf(":"));
  if (userId === "bootstrap") return true; // Bootstrap session needs no DB check

  const db = getServiceClient();
  const { data } = await db
    .from("admin_users")
    .select("is_active")
    .eq("id", userId)
    .single();

  return data?.is_active === true;
}

/**
 * Returns the full admin user record for the current session, or null.
 * Used by Team API to identify the caller (prevent self-deactivation etc.).
 */
export async function getAdminSessionUser(): Promise<AdminUser | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!verifyAdminCookieToken(value)) return null;

  const userId = value!.slice(0, value!.indexOf(":"));
  if (userId === "bootstrap") return null;

  const db = getServiceClient();
  const { data } = await db
    .from("admin_users")
    .select("id, email, name, is_active, last_login_at, created_at, created_by")
    .eq("id", userId)
    .single();

  return (data as AdminUser | null) ?? null;
}

/**
 * Append Set-Cookie headers to clear `dd_admin_session` on both `/` and
 * legacy `/admin` path. Uses `NextResponse.headers.append` so two
 * `Set-Cookie` lines are emitted.
 */
export function clearAdminSessionOnResponse(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  const tail = secure ? "; Secure" : "";
  const base = `${ADMIN_COOKIE}=; HttpOnly; Max-Age=0; SameSite=Lax`;
  res.headers.append("Set-Cookie", `${base}; Path=/${tail}`);
  res.headers.append("Set-Cookie", `${base}; Path=/admin${tail}`);
}

export { SESSION_TTL_MS, ADMIN_COOKIE, ADMIN_COOKIE_PATH };
