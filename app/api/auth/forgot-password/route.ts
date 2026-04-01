import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

export const runtime = "nodejs";

/**
 * POST /api/auth/forgot-password
 *
 * Server-side password reset initiation. Uses admin.generateLink so the
 * redirectTo URL is always built from NEXT_PUBLIC_APP_URL — never from the
 * client's origin (which would be localhost in local dev).
 *
 * The email itself is sent by the Supabase "Send Email" hook
 * (/api/auth/email-hook) using our branded Resend template.
 *
 * Body: { email: string }
 * Returns: { ok: true } always (prevents email enumeration)
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const base = getPublicSiteBaseUrl();
  const redirectTo = `${base}/auth/reset-password`;

  const db = getServiceClient();
  const { error } = await db.auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase(),
    options: { redirectTo },
  });

  if (error) {
    // Log but don't expose — return generic success to prevent email enumeration.
    console.error("[forgot-password] generateLink failed:", error.message);
  }

  return NextResponse.json({ ok: true });
}
