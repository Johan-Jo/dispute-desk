/**
 * Send an admin notification email when a new user signs up.
 * Fires from the email confirmation handler — one notification per confirmed sign-up.
 */

import { sendAdminEmail } from "./adminEmail";

export interface AdminSignupNotificationOptions {
  email: string;
  fullName?: string;
}

/**
 * Notify the admin that a new user has confirmed their account.
 * Non-blocking — does not throw; logs on failure only.
 */
export async function sendAdminSignupNotification(
  options: AdminSignupNotificationOptions
): Promise<void> {
  const name = options.fullName?.trim() || "—";
  const timestamp = new Date().toUTCString();
  const subject = `New DisputeDesk sign-up: ${options.email}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">New sign-up confirmed</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Name</td><td style="padding:4px 0;">${name}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Email</td><td style="padding:4px 0;">${options.email}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Time</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>
</body>
</html>`;

  const text = `New sign-up confirmed\n\nName: ${name}\nEmail: ${options.email}\nTime: ${timestamp}`;

  await sendAdminEmail({ subject, html, text, logTag: "admin-signup" });
}
