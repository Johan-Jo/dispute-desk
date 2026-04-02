import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPortalClient } from "@/lib/supabase/portal";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";
import { sendAdminSignupNotification } from "@/lib/email/sendAdminNotification";
import { normalizeLocale } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";
import { isEmailOtpTypeParam } from "@/lib/auth/confirmEmailLink";

/**
 * GET /api/auth/confirm
 *
 * Landing route for Supabase email confirmation and magic-link clicks.
 *
 * Preferred: `token_hash` + `type` from our Send Email hook — calls `verifyOtp`
 * (no PKCE; works when the link is opened outside the original browser).
 *
 * Legacy: PKCE `code` from Supabase-hosted verify redirects — `exchangeCodeForSession`.
 *
 * Query params:
 *   token_hash + type – verifyOtp (EmailOtpType)
 *   code              – exchangeCodeForSession
 *   redirect          – destination path after auth (default: /portal/dashboard)
 *   type              – also selects welcome/admin emails when "signup"
 *   locale            – optional; overrides cookie for transactional emails
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const rawRedirect = url.searchParams.get("redirect") ?? "/portal/dashboard";
  const localeParam = url.searchParams.get("locale");

  const redirectPath = rawRedirect.startsWith("/") ? rawRedirect : "/portal/dashboard";

  const cookieStore = await cookies();
  const ddLocale = cookieStore.get("dd_locale")?.value;
  const acceptLanguage = request.headers.get("accept-language")?.split(",")[0];
  const locale: Locale =
    normalizeLocale(localeParam) ??
    normalizeLocale(ddLocale) ??
    normalizeLocale(acceptLanguage) ??
    "en-US";

  const supabase = await createPortalClient();

  if (token_hash && type && isEmailOtpTypeParam(type)) {
    const {
      data: { user },
      error,
    } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (error || !user) {
      console.error("[confirm] verifyOtp failed:", error?.message);
      return NextResponse.redirect(
        new URL("/auth/sign-in?error=invalid_code", url.origin)
      );
    }

    if (type === "signup") {
      const email = user.email!;
      const fullName = user.user_metadata?.full_name as string | undefined;

      await Promise.allSettled([
        sendWelcomeEmail({
          to: email,
          fullName,
          idempotencyKey: `welcome-confirm/${email}`,
          locale,
        }),
        sendAdminSignupNotification({ email, fullName }),
      ]);
    }

    return NextResponse.redirect(new URL(redirectPath, url.origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/auth/sign-in?error=no_code", url.origin));
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !user) {
    console.error("[confirm] Code exchange failed:", error?.message);
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=invalid_code", url.origin)
    );
  }

  if (type === "signup") {
    const email = user.email!;
    const fullName = user.user_metadata?.full_name as string | undefined;

    await Promise.allSettled([
      sendWelcomeEmail({
        to: email,
        fullName,
        idempotencyKey: `welcome-confirm/${email}`,
        locale,
      }),
      sendAdminSignupNotification({ email, fullName }),
    ]);
  }

  return NextResponse.redirect(new URL(redirectPath, url.origin));
}
