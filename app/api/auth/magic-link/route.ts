import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeLocale } from "@/lib/i18n/locales";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import type { Locale } from "@/lib/i18n/locales";

export const runtime = "nodejs";

/**
 * POST /api/auth/magic-link
 *
 * Initiates a magic-link sign-in server-side so the redirectTo URL always
 * uses NEXT_PUBLIC_APP_URL (never localhost). Uses `signInWithOtp` (not
 * `admin.generateLink`) because only the former invokes the Supabase
 * "Send Email" hook at /api/auth/email-hook, which is what actually
 * delivers the branded Resend email. The locale is encoded in the
 * redirectTo URL so the hook can pick it up.
 *
 * Body: { email: string; locale?: string; redirectTo?: string }
 */
export async function POST(req: NextRequest) {
  const { email, locale: rawLocale, redirectTo: rawRedirect } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const locale: Locale =
    normalizeLocale(rawLocale) ??
    normalizeLocale(req.headers.get("accept-language")?.split(",")[0]) ??
    "en";

  const base = getPublicSiteBaseUrl();
  const destination =
    rawRedirect && typeof rawRedirect === "string" && rawRedirect.startsWith("/")
      ? rawRedirect
      : "/portal/dashboard";

  const confirmUrl = new URL(`${base}/api/auth/confirm`);
  confirmUrl.searchParams.set("type", "magiclink");
  confirmUrl.searchParams.set("redirect", destination);
  confirmUrl.searchParams.set("locale", locale);

  // Anon client — signInWithOtp on the service-role client returns silently
  // without triggering the Send Email hook.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await anon.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: confirmUrl.toString() },
  });

  if (error) {
    console.error("[magic-link] signInWithOtp failed:", error.message);
  }

  // Always return success — prevents email enumeration.
  return NextResponse.json({ ok: true });
}
