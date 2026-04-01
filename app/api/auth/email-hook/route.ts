import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";
import { sendMagicLinkEmail } from "@/lib/email/sendMagicLink";
import { sendConfirmationEmail } from "@/lib/email/sendConfirmationEmail";
import { sendPasswordResetEmail } from "@/lib/email/sendPasswordResetEmail";

export const runtime = "nodejs";

/**
 * POST /api/auth/email-hook
 *
 * Supabase "Send Email" Auth Hook. When registered in the Supabase dashboard
 * (Authentication → Hooks → Send Email), Supabase calls this endpoint instead
 * of sending its own default email. We verify the HMAC signature and send a
 * branded Resend email instead.
 *
 * Required env var: SUPABASE_AUTH_HOOK_SECRET
 * Dashboard setup: Authentication → Hooks → Send Email → HTTP POST →
 *   https://disputedesk.app/api/auth/email-hook
 *
 * Hook payload:
 *   user.email, user.user_metadata.full_name
 *   email_data.token_hash, email_data.redirect_to, email_data.email_action_type
 *
 * Action link: ${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify?token_hash=…&type=…&redirect_to=…
 */
export async function POST(req: NextRequest) {
  const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  if (!hookSecret) {
    console.error("[email-hook] SUPABASE_AUTH_HOOK_SECRET not set");
    return NextResponse.json({ error: "Hook not configured" }, { status: 500 });
  }

  // Supabase HTTP auth hooks send: Authorization: Bearer <HS256 JWT>
  // The JWT is signed with the raw bytes of the base64-decoded whsec_ secret.
  const authHeader = req.headers.get("authorization");
  if (!verifyHookJWT(authHeader, hookSecret)) {
    console.warn("[email-hook] JWT verification failed — header:", authHeader?.slice(0, 20));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = (await req.json()) as HookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = payload.user?.email;
  const fullName = (payload.user?.user_metadata?.full_name as string | undefined)?.trim() || undefined;
  const actionType = payload.email_data?.email_action_type;
  const tokenHash = payload.email_data?.token_hash;
  const redirectTo = payload.email_data?.redirect_to ?? "";

  if (!email || !actionType || !tokenHash) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Construct the action link Supabase would normally embed in its email.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const actionLink = `${supabaseUrl}/auth/v1/verify?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(actionType)}&redirect_to=${encodeURIComponent(redirectTo)}`;

  // Resolve locale: encoded in redirectTo as ?locale=xx-XX by our magic-link route.
  let locale: Locale = "en-US";
  try {
    const redirectUrl = new URL(redirectTo, "https://x");
    const localeParam = redirectUrl.searchParams.get("locale");
    locale = normalizeLocale(localeParam) ?? "en-US";
  } catch {
    // ignore malformed redirect_to
  }

  switch (actionType) {
    case "magiclink":
      await sendMagicLinkEmail({ to: email, actionLink, locale });
      break;

    case "signup":
    case "email_change_new":
      await sendConfirmationEmail({ to: email, actionLink, locale, fullName });
      break;

    case "recovery":
      await sendPasswordResetEmail({ to: email, actionLink, locale });
      break;

    case "email_change_current":
      // Notify the old address that an email change was initiated.
      await sendConfirmationEmail({ to: email, actionLink, locale });
      break;

    default:
      console.warn("[email-hook] Unknown email_action_type:", actionType);
  }

  // Return empty object — Supabase treats any 2xx as success.
  return NextResponse.json({});
}

// ─── Types ────────────────────────────────────────────────────────────────

interface HookPayload {
  user?: {
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };
}

// ─── JWT verification ────────────────────────────────────────────────────

/**
 * Verify the HS256 JWT Bearer token Supabase sends with every HTTP auth hook.
 * The JWT is signed with the raw bytes obtained by base64-decoding the
 * "whsec_<base64>" part of the hook secret (stripping the "v1," prefix).
 */
function verifyHookJWT(authHeader: string | null, secret: string): boolean {
  try {
    if (!authHeader?.startsWith("Bearer ")) return false;
    const token = authHeader.slice(7);

    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    // Decode and check expiry.
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const { exp } = JSON.parse(payloadJson) as { exp?: number };
    if (exp && exp < Date.now() / 1000) return false;

    // Strip "v1,whsec_" prefix, base64-decode to get raw key bytes.
    const rawSecret = secret.replace(/^v\d+,whsec_/, "");
    const keyBytes = Buffer.from(rawSecret, "base64");

    // Recompute signature over "<header>.<payload>".
    const expected = crypto
      .createHmac("sha256", keyBytes)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    // Constant-time comparison.
    const sigBuf = Buffer.from(sigB64);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
