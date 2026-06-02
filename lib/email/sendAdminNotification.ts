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

export interface AdminInstallNotificationOptions {
  /** The shop's myshopify domain — always available at install time. */
  shopDomain: string;
  /** Shop owner / contact email, when resolvable from the Shopify Admin API. */
  email?: string;
  /** Store name, when resolvable. */
  shopName?: string;
  /** OAuth entry point that created the shop: "portal" or "embedded". */
  source?: string;
}

/**
 * Notify the admin that a NEW shop installed the app — fired once, at the
 * moment the `shops` row is first created in the OAuth callback, regardless
 * of OAuth source (portal vs embedded App Store install). This is the
 * source-independent counterpart to {@link sendAdminSignupNotification},
 * which only covers the portal path. Non-blocking — never throws.
 */
export async function sendAdminInstallNotification(
  options: AdminInstallNotificationOptions
): Promise<void> {
  const shopName = options.shopName?.trim() || "—";
  const email = options.email?.trim() || "—";
  const source = options.source?.trim() || "—";
  const timestamp = new Date().toUTCString();
  const subject = `New DisputeDesk install: ${options.shopDomain}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">New merchant installed DisputeDesk</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Shop</td><td style="padding:4px 0;">${options.shopDomain}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Store name</td><td style="padding:4px 0;">${shopName}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Owner email</td><td style="padding:4px 0;">${email}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Source</td><td style="padding:4px 0;">${source}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Time</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>
</body>
</html>`;

  const text =
    `New merchant installed DisputeDesk\n\n` +
    `Shop: ${options.shopDomain}\n` +
    `Store name: ${shopName}\n` +
    `Owner email: ${email}\n` +
    `Source: ${source}\n` +
    `Time: ${timestamp}`;

  await sendAdminEmail({ subject, html, text, logTag: "admin-install" });
}

export interface AdminPlaybookLeadNotificationOptions {
  /** Lead's email address. */
  email: string;
  /** Which capture form: "hero" | "final" (or null/unknown). */
  source?: string | null;
  /** Captured UI locale (en|de|es|fr|pt|sv). */
  locale?: string | null;
  /** UTM attribution captured from the landing-page URL. */
  utm?: Record<string, string>;
}

/**
 * Notify the admin that a NEW Liability-Shift Playbook lead came in from the
 * inbound campaign. Fired once, at capture time, for genuinely new leads only
 * (re-submits of an existing email don't re-notify). Non-blocking — never
 * throws; logs on failure.
 */
export async function sendAdminPlaybookLeadNotification(
  options: AdminPlaybookLeadNotificationOptions
): Promise<void> {
  const source = options.source?.trim() || "—";
  const locale = options.locale?.trim() || "—";
  const utm = options.utm ?? {};
  const utmStr =
    Object.keys(utm).length > 0
      ? Object.entries(utm)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "—";
  const timestamp = new Date().toUTCString();
  const subject = `New Playbook lead: ${options.email}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">New Liability-Shift Playbook lead</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Email</td><td style="padding:4px 0;">${options.email}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Form</td><td style="padding:4px 0;">${source}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Locale</td><td style="padding:4px 0;">${locale}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">UTM</td><td style="padding:4px 0;">${utmStr}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Time</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>
</body>
</html>`;

  const text =
    `New Liability-Shift Playbook lead\n\n` +
    `Email: ${options.email}\n` +
    `Form: ${source}\n` +
    `Locale: ${locale}\n` +
    `UTM: ${utmStr}\n` +
    `Time: ${timestamp}`;

  await sendAdminEmail({ subject, html, text, logTag: "admin-playbook-lead" });
}
