/**
 * Server-side helpers for the Playbook lead funnel: URL builders, the
 * stateless unsubscribe token, and the Resend send wrapper.
 *
 * Tokens are HMAC-signed over the lowercased email so the unsubscribe link is
 * stateless (no per-lead token column) and cannot be forged. Secret reuses
 * CRON_SECRET (already a strong server-only secret in this app); falls back to
 * SUPABASE_SERVICE_ROLE_KEY so links still work if CRON_SECRET is unset.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import { getMarketingShopifyAppInstallUrl } from "@/lib/marketing/shopifyInstallUrl";

const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

/** The Cal.com booking handle used across the marketing site. */
export const CAL_HANDLE = "disputedesk";

function unsubSecret(): string {
  return (
    process.env.CRON_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "playbook-unsub-fallback"
  );
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign an email → opaque token for the unsubscribe link. */
export function signUnsubToken(email: string): string {
  const norm = email.trim().toLowerCase();
  const sig = base64url(
    createHmac("sha256", unsubSecret()).update(norm).digest(),
  );
  const payload = base64url(Buffer.from(norm, "utf8"));
  return `${payload}.${sig}`;
}

/** Verify a token; returns the normalized email or null if invalid. */
export function verifyUnsubToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let email: string;
  try {
    email = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  const expected = base64url(
    createHmac("sha256", unsubSecret()).update(email).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return email;
}

/** Public URL of the Playbook web reader. */
export function playbookReadUrl(): string {
  return `${getPublicSiteBaseUrl()}/playbook/read`;
}

/** Cal teardown booking URL. */
export function calTeardownUrl(): string {
  return `https://cal.com/${CAL_HANDLE}`;
}

/**
 * Install CTA URL for nurture emails — the on-site pricing section, where the
 * merchant picks a plan and the direct-install pop-up (shop domain → OAuth)
 * opens. Uses the canonical marketing install helper so emails stay consistent
 * with the site's own install buttons. The helper returns an absolute
 * `${origin}/#pricing`.
 */
export function installUrl(): string {
  return getMarketingShopifyAppInstallUrl();
}

/** Unsubscribe URL for a given email. */
export function unsubscribeUrl(email: string): string {
  return `${getPublicSiteBaseUrl()}/api/playbook/unsubscribe?token=${encodeURIComponent(signUnsubToken(email))}`;
}

/**
 * Send one email via Resend. Returns true on success, false on any failure
 * (logged). Never throws — the caller decides whether a send failure is fatal
 * (it isn't for lead capture: the cron retries).
 */
export async function sendPlaybookEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[playbook] RESEND_API_KEY not set; skipping send to", opts.to);
    return false;
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) {
      console.error("[playbook] Resend error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[playbook] send threw:", err);
    return false;
  }
}
