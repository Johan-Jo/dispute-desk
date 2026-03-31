import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPortalClient } from "@/lib/supabase/portal";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";
import { sendAdminSignupNotification } from "@/lib/email/sendAdminNotification";
import { normalizeLocale } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";

/**
 * GET /api/auth/confirm
 *
 * Landing route for Supabase email confirmation and magic-link clicks.
 * Receives the PKCE `code` from Supabase, exchanges it for a session,
 * then fires post-signup emails (welcome + admin) for sign-up confirmations only.
 *
 * Query params:
 *   code     – PKCE auth code from Supabase (required)
 *   redirect – destination path after auth (default: /portal/dashboard)
 *   type     – "signup" | "magiclink" — controls whether emails are sent
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type"); // "signup" | "magiclink"
  const rawRedirect = url.searchParams.get("redirect") ?? "/portal/dashboard";

  // Only allow relative redirect paths — prevent open redirect
  const redirectPath = rawRedirect.startsWith("/") ? rawRedirect : "/portal/dashboard";

  // Resolve locale: dd_locale cookie → Accept-Language header → en-US fallback
  const cookieStore = await cookies();
  const ddLocale = cookieStore.get("dd_locale")?.value;
  const acceptLanguage = request.headers.get("accept-language")?.split(",")[0];
  const locale: Locale =
    normalizeLocale(ddLocale) ?? normalizeLocale(acceptLanguage) ?? "en-US";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/sign-in?error=no_code", url.origin));
  }

  const supabase = await createPortalClient();
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

  // Send emails only on sign-up confirmation (not magic-link logins)
  if (type === "signup") {
    const email = user.email!;
    const fullName = user.user_metadata?.full_name as string | undefined;

    // Await both so they complete before the serverless function terminates
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
