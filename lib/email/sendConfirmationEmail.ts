import { Resend } from "resend";
import type { Locale } from "@/lib/i18n/locales";
import {
  generateConfirmationEmailHTML,
  generateConfirmationEmailText,
  getConfirmationSubject,
} from "./templates";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface SendConfirmationOptions {
  to: string;
  actionLink: string;
  locale?: Locale;
  fullName?: string;
}

export async function sendConfirmationEmail(
  options: SendConfirmationOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping confirmation email");
    return { ok: false, error: "Email service not configured" };
  }

  const html = generateConfirmationEmailHTML({
    actionLink: options.actionLink,
    locale: options.locale,
    fullName: options.fullName,
  });
  const text = generateConfirmationEmailText({
    actionLink: options.actionLink,
    locale: options.locale,
    fullName: options.fullName,
  });
  const subject = getConfirmationSubject(options.locale);

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
    console.error("[email] Confirmation send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
