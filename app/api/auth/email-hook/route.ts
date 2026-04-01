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

  // Read raw body for signature verification.
  const rawBody = await req.text();

  // Verify Supabase hook signature: x-supabase-signature: t=<ts>,v1=<hmac>
  const sigHeader = req.headers.get("x-supabase-signature") ?? "";
  if (!verifyHookSignature(sigHeader, rawBody, hookSecret)) {
    console.warn("[email-hook] Signature verification failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
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

// ─── Signature verification ───────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature Supabase attaches to every hook request.
 * Header format: "t=<unix_ts>,v1=<hex_hmac>"
 * Signed payload: "<timestamp>.<rawBody>"
 * Rejects requests older than 5 minutes.
 *
 * Supabase generates secrets in the format "v1,whsec_<base64>" — strip
 * the prefix and base64-decode to get the raw HMAC key bytes.
 */
function verifyHookSignature(
  sigHeader: string,
  rawBody: string,
  secret: string
): boolean {
  try {
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => {
        const idx = p.indexOf("=");
        return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
      })
    );
    const ts = parts["t"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;

    // Reject stale requests (>5 min).
    const age = Math.abs(Date.now() / 1000 - parseInt(ts, 10));
    if (age > 300) return false;

    // Strip optional "v1,whsec_" prefix from secret, then base64-decode.
    const rawSecret = secret.replace(/^v\d+,whsec_/, "");
    const keyBytes = Buffer.from(rawSecret, "base64");

    const expected = crypto
      .createHmac("sha256", keyBytes)
      .update(`${ts}.${rawBody}`)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(v1, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}
