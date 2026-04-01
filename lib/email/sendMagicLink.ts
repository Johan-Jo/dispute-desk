/**
 * Send a branded magic-link sign-in email via Resend.
 * Called from the /api/auth/magic-link route handler — never from the client.
 */

import { Resend } from "resend";
import type { Locale } from "@/lib/i18n/locales";
import {
  generateMagicLinkEmailHTML,
  generateMagicLinkEmailText,
  getMagicLinkSubject,
} from "./templates";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface SendMagicLinkOptions {
  to: string;
  actionLink: string;
  locale?: Locale;
}

export async function sendMagicLinkEmail(
  options: SendMagicLinkOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping magic link email");
    return { ok: false, error: "Email service not configured" };
  }

  const html = generateMagicLinkEmailHTML({ actionLink: options.actionLink, locale: options.locale });
  const text = generateMagicLinkEmailText({ actionLink: options.actionLink, locale: options.locale });
  const subject = getMagicLinkSubject(options.locale);

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: options.to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("[email] Magic link send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
