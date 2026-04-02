import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { normalizeLocale } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";
import { sendMagicLinkEmail } from "@/lib/email/sendMagicLink";
import { sendConfirmationEmail } from "@/lib/email/sendConfirmationEmail";
import { sendPasswordResetEmail } from "@/lib/email/sendPasswordResetEmail";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import {
  mapActionTypeToOtpType,
  parseConfirmParamsFromRedirectTo,
} from "@/lib/auth/confirmEmailLink";

export const runtime = "nodejs";

/**
 * POST /api/auth/email-hook
 *
 * Supabase "Send Email" Auth Hook. When registered in the Supabase dashboard
 * (Authentication → Hooks → Send Email), Supabase calls this endpoint instead
 * of sending its own default email. Requests use the **Standard Webhooks** spec
 * (webhook-id, webhook-timestamp, webhook-signature); verify with the same
 * secret shown in the dashboard (`v1,whsec_…`).
 *
 * Required env var: SUPABASE_AUTH_HOOK_SECRET
 * Dashboard setup: Authentication → Hooks → Send Email → HTTP POST →
 *   https://disputedesk.app/api/auth/email-hook
 *
 * @see https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 */
export async function POST(req: NextRequest) {
  const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  if (!hookSecret) {
    console.error("[email-hook] SUPABASE_AUTH_HOOK_SECRET not set");
    return NextResponse.json({ error: "Hook not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const headerRecord = Object.fromEntries(req.headers);

  // Same as Supabase docs: base64 key material after stripping v{n},whsec_
  const secretKey = hookSecret.replace(/^v\d+,whsec_/, "");
  const wh = new Webhook(secretKey);

  let payload: HookPayload;
  try {
    payload = wh.verify(rawBody, headerRecord) as HookPayload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verify failed";
    console.warn("[email-hook] Webhook verify failed:", msg);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = payload.user?.email;
  const fullName = (payload.user?.user_metadata?.full_name as string | undefined)?.trim() || undefined;
  const actionType = payload.email_data?.email_action_type;
  const tokenHash = payload.email_data?.token_hash;
  const redirectTo = payload.email_data?.redirect_to ?? "";

  if (!email || !actionType || !tokenHash) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const otpType = mapActionTypeToOtpType(actionType);
  if (!otpType) {
    console.warn("[email-hook] Unsupported email_action_type:", actionType);
    return NextResponse.json({ error: "Unsupported action" }, { status: 500 });
  }

  // App-hosted confirm avoids PKCE (`code` exchange) when the link is opened in another app/device.
  const base = getPublicSiteBaseUrl();
  const { redirectPath, localeParam } = parseConfirmParamsFromRedirectTo(redirectTo);
  const confirmParams = new URLSearchParams({
    token_hash: tokenHash,
    type: otpType,
    redirect: redirectPath,
  });
  if (localeParam) {
    confirmParams.set("locale", localeParam);
  }
  const actionLink = `${base}/api/auth/confirm?${confirmParams.toString()}`;

  let locale: Locale = normalizeLocale(localeParam) ?? "en-US";
  if (!localeParam && redirectTo) {
    try {
      const redirectUrl = new URL(redirectTo, "https://x");
      const lp = redirectUrl.searchParams.get("locale");
      locale = normalizeLocale(lp) ?? locale;
    } catch {
      // ignore malformed redirect_to
    }
  }

  type SendOutcome = { ok: true } | { ok: false; error: string };

  let sendResult: SendOutcome = { ok: true };

  switch (actionType) {
    case "magiclink":
      sendResult = await sendMagicLinkEmail({ to: email, actionLink, locale });
      break;

    case "signup":
    case "email_change_new":
      sendResult = await sendConfirmationEmail({ to: email, actionLink, locale, fullName });
      break;

    case "recovery":
      sendResult = await sendPasswordResetEmail({ to: email, actionLink, locale });
      break;

    case "email_change_current":
      sendResult = await sendConfirmationEmail({ to: email, actionLink, locale });
      break;

    default:
      console.warn("[email-hook] Unknown email_action_type:", actionType);
  }

  if (!sendResult.ok) {
    console.error("[email-hook] Resend failed:", sendResult.error);
    return NextResponse.json({ error: "Email delivery failed" }, { status: 500 });
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
