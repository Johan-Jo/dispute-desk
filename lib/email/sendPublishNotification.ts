/**
 * Send email notification when an autopilot article is published.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export interface PublishNotificationOptions {
  to: string;
  articleTitle: string;
  articleSlug: string;
  routeKind: string;
  pillar: string;
  locale: string;
}

export async function sendPublishNotification(
  options: PublishNotificationOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping publish notification");
    return { ok: false, error: "Email service not configured" };
  }

  const baseUrl = getBaseUrl();
  const routeBase = options.routeKind || "resources";
  const pillarSegment = routeBase === "resources" && options.pillar ? `/${options.pillar}` : "";
  const articleUrl = `${baseUrl}/${routeBase}${pillarSegment}/${options.articleSlug}`;

  const subject = `New article published: ${options.articleTitle}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #0B1220;">
  <div style="border-bottom: 3px solid #1D4ED8; padding-bottom: 16px; margin-bottom: 24px;">
    <h2 style="margin: 0; color: #1D4ED8;">DisputeDesk</h2>
    <p style="margin: 4px 0 0; font-size: 14px; color: #64748B;">Autopilot Content Published</p>
  </div>

  <p style="font-size: 16px; line-height: 1.6;">A new article has been automatically generated and published:</p>

  <div style="background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600;">${options.articleTitle}</p>
    <p style="margin: 0; font-size: 14px; color: #64748B;">Locale: ${options.locale}</p>
  </div>

  <a href="${articleUrl}" style="display: inline-block; background: #1D4ED8; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 500;">View Article</a>

  <p style="margin-top: 24px; font-size: 13px; color: #64748B;">
    You can manage autopilot settings at <a href="${baseUrl}/admin/resources/settings" style="color: #1D4ED8;">Admin &gt; Resources &gt; Settings</a>.
  </p>

  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
  <p style="font-size: 12px; color: #94A3B8;">This is an automated notification from DisputeDesk Autopilot.</p>
</body>
</html>`.trim();

  const text = `New article published: ${options.articleTitle}\nLocale: ${options.locale}\nView: ${articleUrl}\n\nManage autopilot: ${baseUrl}/admin/resources/settings`;

  const resend = new Resend(RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: options.to,
      subject,
      html,
      text,
      headers: {
        "X-Entity-Ref-ID": `publish-${options.articleSlug}-${options.locale}`,
      },
      tags: [{ name: "category", value: "autopilot-publish" }],
    });

    if (error) {
      console.error("[email] Publish notification failed:", error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Publish notification error:", msg);
    return { ok: false, error: msg };
  }
}
