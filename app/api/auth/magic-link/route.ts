import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { normalizeLocale } from "@/lib/i18n/locales";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import type { Locale } from "@/lib/i18n/locales";

export const runtime = "nodejs";

/**
 * POST /api/auth/magic-link
 *
 * Initiates a magic-link sign-in server-side so the redirectTo URL always
 * uses NEXT_PUBLIC_APP_URL (never localhost). The locale is encoded in the
 * redirectTo URL so the Supabase "Send Email" hook (/api/auth/email-hook)
 * can pick it up and send the correct branded Resend email.
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
    "en-US";

  // Build the confirm URL with locale encoded so the email hook can read it.
  const base = getPublicSiteBaseUrl();
  const destination =
    rawRedirect && typeof rawRedirect === "string" && rawRedirect.startsWith("/")
      ? rawRedirect
      : "/portal/dashboard";

  const confirmUrl = new URL(`${base}/api/auth/confirm`);
  confirmUrl.searchParams.set("type", "magiclink");
  confirmUrl.searchParams.set("redirect", destination);
  confirmUrl.searchParams.set("locale", locale);

  const db = getServiceClient();
  const { error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
    options: { redirectTo: confirmUrl.toString() },
  });

  if (error) {
    console.error("[magic-link] generateLink failed:", error.message);
  }

  // Always return success — prevents email enumeration.
  return NextResponse.json({ ok: true });
}
