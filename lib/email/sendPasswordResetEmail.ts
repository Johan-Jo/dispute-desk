import { Resend } from "resend";
import type { Locale } from "@/lib/i18n/locales";
import {
  generatePasswordResetEmailHTML,
  generatePasswordResetEmailText,
  getPasswordResetSubject,
} from "./templates";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface SendPasswordResetOptions {
  to: string;
  actionLink: string;
  locale?: Locale;
}

export async function sendPasswordResetEmail(
  options: SendPasswordResetOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping password reset email");
    return { ok: false, error: "Email service not configured" };
  }

  const html = generatePasswordResetEmailHTML({ actionLink: options.actionLink, locale: options.locale });
  const text = generatePasswordResetEmailText({ actionLink: options.actionLink, locale: options.locale });
  const subject = getPasswordResetSubject(options.locale);

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
    console.error("[email] Password reset send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
