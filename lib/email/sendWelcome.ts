/**
 * Send welcome email via Resend.
 * Used after sign-up (email/password) or when a user links their first shop (OAuth).
 */

import { Resend } from "resend";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import type { Locale } from "@/lib/i18n/locales";
import {
  generateWelcomeEmailHTML,
  generateWelcomeEmailText,
  getWelcomeSubject,
  type WelcomeEmailVariables,
} from "./templates";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
/** Use verified sending subdomain in Resend (mail.disputedesk.app). Set EMAIL_FROM to override. */
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
/** Reply-To (avoid no-reply; helps deliverability). Defaults to same as FROM. */
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

function getDashboardUrl(): string {
  return `${getPublicSiteBaseUrl()}/portal/dashboard`;
}

export interface SendWelcomeOptions {
  to: string;
  fullName?: string;
  idempotencyKey: string;
  locale?: Locale;
}

/**
 * Send the welcome email to a newly registered user.
 * Returns { ok: true } on success, { ok: false, error: string } on failure.
 * Does not throw; callers should log and not block UX.
 */
export async function sendWelcomeEmail(
  options: SendWelcomeOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping welcome email");
    return { ok: false, error: "Email service not configured" };
  }

  const dashboardUrl = getDashboardUrl();
  const firstName =
    options.fullName?.trim().split(/\s+/)[0] || "there";

  const variables: WelcomeEmailVariables = {
    firstName,
    dashboardUrl,
    locale: options.locale,
  };

  const html = generateWelcomeEmailHTML(variables);
  const text = generateWelcomeEmailText(variables);
  const subject = getWelcomeSubject(options.locale);

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send(
    {
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: options.to,
      subject,
      html,
      text,
    },
    { idempotencyKey: options.idempotencyKey }
  );

  if (error) {
    console.error("[email] Welcome send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
