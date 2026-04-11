/**
 * Shared Resend wrapper for admin-alert emails.
 *
 * Several internal-staff notification helpers (sign-up alerts, new
 * Shopify dispute reasons, enum drift, enum drift resolved, partial
 * generation alerts, etc.) all follow the same pattern:
 *
 *   1. Read RESEND_API_KEY / EMAIL_FROM / ADMIN_NOTIFY_EMAIL from env
 *      with the same defaults
 *   2. Warn-and-return if the API key isn't set, so a missing env
 *      never fails the calling code path
 *   3. new Resend(...).emails.send(...) inside try/catch
 *   4. console.error on failure, never throw
 *
 * Before this helper existed each alert file redeclared all four
 * constants + the try/catch. This module collapses that boilerplate
 * into one place. Transactional / user-facing emails (welcome, magic
 * link, password reset, merchant evidence alerts) keep their own
 * helpers because they have different to-addresses and caller
 * contracts (they return {ok, error} so API routes can surface
 * failures to the client).
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? "oi@johan.com.br";

export interface SendAdminEmailOptions {
  subject: string;
  html: string;
  text: string;
  /** Override the default ADMIN_NOTIFY_EMAIL destination. */
  to?: string;
  /** Used in the console.warn / console.error prefix for traceability. */
  logTag?: string;
}

/**
 * Fire an admin-alert email. Non-blocking: returns a Promise that
 * resolves (never rejects) so call sites can `void sendAdminEmail(...)`
 * or `await sendAdminEmail(...)` as they prefer — failure is logged
 * but never thrown.
 */
export async function sendAdminEmail(options: SendAdminEmailOptions): Promise<void> {
  const tag = options.logTag ? `[email:${options.logTag}]` : "[email]";

  if (!RESEND_API_KEY) {
    console.warn(`${tag} RESEND_API_KEY not set — skipping`);
    return;
  }

  const to = options.to ?? ADMIN_EMAIL;

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  } catch (err) {
    console.error(`${tag} send failed:`, err);
  }
}
