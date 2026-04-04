import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

const BodySchema = z.object({
  email: z.string().email(),
  shopDomain: z.string().optional(),
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body: email required" }, { status: 400 });
  }

  // Resolve shop domain: prefer explicit body value, fall back to embedded session cookie
  if (!body.shopDomain) {
    const shopCookie = req.cookies.get("shopify_shop")?.value;
    if (shopCookie) body = { ...body, shopDomain: shopCookie };
  }

  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping invite email");
    return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
  }

  const base = getPublicSiteBaseUrl();
  const signUpUrl = body.shopDomain
    ? `${base}/auth/sign-up?invited_shop=${encodeURIComponent(body.shopDomain)}`
    : `${base}/auth/sign-up`;
  const resend = new Resend(RESEND_API_KEY);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:40px;border:1px solid #e5e7eb">
      <tr><td>
        <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px">You've been invited to DisputeDesk</p>
        <p style="font-size:15px;color:#374151;margin:0 0 24px">A teammate has invited you to join their DisputeDesk workspace to help manage chargeback evidence.</p>
        <a href="${signUpUrl}" style="display:inline-block;background:#111827;color:#fff;font-size:15px;font-weight:600;padding:12px 24px;border-radius:6px;text-decoration:none">Accept invitation</a>
        <p style="font-size:13px;color:#6b7280;margin:32px 0 0">If you weren't expecting this invitation, you can ignore this email.</p>
        <p style="font-size:13px;color:#9ca3af;margin:16px 0 0">© 2026 DisputeDesk. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = `You've been invited to DisputeDesk\n\nA teammate has invited you to join their DisputeDesk workspace.\n\nAccept invitation: ${signUpUrl}\n\nIf you weren't expecting this, ignore this email.`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: body.email,
    subject: "You've been invited to DisputeDesk",
    html,
    text,
  });

  if (error) {
    console.error("[email] Invite send failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
