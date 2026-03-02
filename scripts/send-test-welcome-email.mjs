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
const subject = "Your DisputeDesk account is ready";
const from = process.env.EMAIL_FROM || "DisputeDesk <notifications@mail.disputedesk.app>";
const replyTo = process.env.EMAIL_REPLY_TO || from;

const greeting = `Hi ${firstName}`;
const content = "Your account is set up. Sign in to manage Shopify chargeback evidence and connect your store.";
const preheader = "Your DisputeDesk account is ready.";
const linkText = "Sign in to DisputeDesk";

const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#333;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 12px;">
<tr><td>
<p style="margin:0 0 20px 0;font-size:18px;font-weight:600;color:#111827;">DisputeDesk</p>
<p style="margin:0 0 16px 0;">${greeting}</p>
<p style="margin:0 0 16px 0;">${content}</p>
<p style="margin:0 0 24px 0;"><a href="${fullDashboardUrl}" style="color:#1976d2;text-decoration:underline;">${linkText}</a></p>
<p style="margin:0;font-size:14px;color:#6b7280;">Best regards,<br>The DisputeDesk Team</p>
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
