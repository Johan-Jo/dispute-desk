import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendMagicLinkEmail } from "@/lib/email/sendMagicLink";
import { normalizeLocale } from "@/lib/i18n/locales";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import type { Locale } from "@/lib/i18n/locales";

export const runtime = "nodejs";

/**
 * POST /api/auth/magic-link
 *
 * Generates a Supabase magic-link server-side (so the redirectTo uses the
 * production APP URL, never localhost) and sends our branded Resend email
 * rather than Supabase's default template.
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

  // Resolve redirect URL using the server-side env var — never trust the client's origin.
  const base = getPublicSiteBaseUrl();
  let redirectTo = base + "/portal/dashboard";
  if (rawRedirect && typeof rawRedirect === "string" && rawRedirect.startsWith("/")) {
    redirectTo = base + rawRedirect;
  }

  const db = getServiceClient();
  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
    options: { redirectTo },
  });

  if (error || !data?.properties?.action_link) {
    console.error("[magic-link] generateLink failed:", error?.message);
    // Return generic success to avoid leaking whether an account exists.
    return NextResponse.json({ ok: true });
  }

  await sendMagicLinkEmail({
    to: email.trim(),
    actionLink: data.properties.action_link,
    locale,
  });

  return NextResponse.json({ ok: true });
}
