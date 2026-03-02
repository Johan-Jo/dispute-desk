/**
 * One-off script to send a test welcome email. Loads .env.local and uses Resend directly.
 * Usage: node scripts/send-test-welcome-email.mjs [email]
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Resend } from "resend";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");

try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (key && !process.env[key]) process.env[key] = value;
  }
} catch (e) {
  console.error("Could not load .env.local:", e.message);
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error("RESEND_API_KEY not set in .env.local");
  process.exit(1);
}

const email = process.argv[2] || "hej@johan.com.br";
const firstName = "Johan";
// Links must match sending domain or spam filters penalize. Prefer production URL.
const dashboardUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  "https://disputedesk.app";
const fullDashboardUrl = `${dashboardUrl}/portal/dashboard`;
const baseUrl = dashboardUrl;
const subject = "Welcome to DisputeDesk — you're all set";
const from = process.env.EMAIL_FROM || "DisputeDesk <notifications@mail.disputedesk.app>";
const replyTo = process.env.EMAIL_REPLY_TO || from;

const greeting = `Hi ${firstName}`;
const content = `You're in. DisputeDesk helps you manage Shopify chargeback evidence: sync disputes, build evidence packs, and save them back to Shopify — with optional automation so you can focus on running your store.

Click the button below to open your dashboard and connect your first store.`.replace(/\n/g, "<br>");

const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#F5F7FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F7FB;padding:32px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E6E8EF;border-radius:12px;">
<tr><td style="padding:24px 28px;border-bottom:1px solid #E6E8EF;">
<h1 style="margin:0;font-size:20px;font-weight:700;color:#111827;"><span style="color:#000000;">Dispute</span><span style="color:#2563EB;">Desk</span></h1>
</td></tr>
<tr><td style="padding:28px 28px 24px;">
<h2 style="margin:0 0 20px 0;font-size:24px;font-weight:700;color:#111827;">${subject}</h2>
<p style="margin:0 0 8px 0;font-size:16px;color:#374151;">${greeting}</p>
<div style="margin:0 0 20px 0;font-size:16px;color:#374151;">${content}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
<a href="${fullDashboardUrl}" style="display:inline-block;background-color:#1976d2;color:#ffffff !important;padding:14px 18px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:700;">Go to dashboard</a>
</td></tr></table>
<p style="margin:0 0 12px 0;font-size:14px;color:#6B7280;text-align:center;">
<a href="${fullDashboardUrl}" style="color:#2563EB;text-decoration:none;">Go to dashboard</a>
<span style="color:#D1D5DB;margin:0 8px;">&bull;</span>
<a href="${baseUrl}/auth/sign-in" style="color:#2563EB;text-decoration:none;">Sign in</a>
</p>
</td></tr>
<tr><td style="padding:24px 28px;border-top:1px solid #E6E8EF;background-color:#F9FAFB;">
<p style="margin:0 0 8px 0;font-size:14px;color:#6B7280;text-align:center;">Need help? Reply to this email.</p>
<p style="margin:0;font-size:13px;color:#9CA3AF;text-align:center;">© ${new Date().getFullYear()} DisputeDesk.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const resend = new Resend(apiKey);
const { data, error } = await resend.emails.send(
  { from, replyTo, to: email, subject, html },
  { idempotencyKey: `welcome/test-${email}-${Date.now()}` }
);

if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log("Test welcome email sent to", email, "(id:", data?.id, ")");
