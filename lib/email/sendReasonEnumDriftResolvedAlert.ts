/**
 * Send an admin notification when a previously-detected Shopify
 * dispute-reason enum drift has been resolved — i.e. the daily
 * introspection now matches ALL_DISPUTE_REASONS exactly after a
 * prior run reported drift.
 *
 * Fires from lib/shopify/checkReasonEnumDrift.ts when the most
 * recent audit_events row was of type 'shopify_enum_drift' and the
 * current run is clean. Pairs with sendReasonEnumDriftAlert.ts so
 * the admin gets both "broken" and "fixed" signals.
 *
 * Non-blocking: does not throw, logs on failure only.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? "oi@johan.com.br";

export interface ReasonEnumDriftResolvedAlertOptions {
  /**
   * The diff the previous alert reported. Echoed back so the email
   * shows "what was drifted and is now resolved" without the admin
   * having to look at the earlier email.
   */
  previousMissingLocally: string[];
  previousExtraLocally: string[];
  /** Shop used for the introspection query. */
  checkedShopDomain: string;
  /** Current Shopify enum total count. */
  enumTotalCount: number;
}

function renderList(items: string[]): string {
  if (items.length === 0) return "<li><em>none</em></li>";
  return items.map((v) => `<li><code>${v}</code></li>`).join("");
}

export async function sendReasonEnumDriftResolvedAlert(
  options: ReasonEnumDriftResolvedAlertOptions,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping drift-resolved alert",
    );
    return;
  }

  const {
    previousMissingLocally,
    previousExtraLocally,
    checkedShopDomain,
    enumTotalCount,
  } = options;
  const timestamp = new Date().toUTCString();
  const subject = `Shopify dispute reason enum drift resolved`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#15803D;">✓ Shopify dispute reason enum drift resolved</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;">
    The daily <code>check-shopify-reasons</code> cron ran against
    <code>${checkedShopDomain}</code> and found that the previously
    reported drift is now resolved. Our local
    <code>ALL_DISPUTE_REASONS</code> list in
    <code>lib/rules/disputeReasons.ts</code> matches Shopify&apos;s
    live enum (${enumTotalCount} values).
  </p>

  <h3 style="margin:24px 0 4px;font-size:15px;color:#0F172A;">Previously missing locally (now added)</h3>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#15803D;">
    ${renderList(previousMissingLocally)}
  </ul>

  <h3 style="margin:16px 0 4px;font-size:15px;color:#0F172A;">Previously extra locally (now aligned)</h3>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#15803D;">
    ${renderList(previousExtraLocally)}
  </ul>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Checked shop</td><td style="padding:4px 0;"><code>${checkedShopDomain}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Shopify enum count</td><td style="padding:4px 0;">${enumTotalCount}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Resolved at</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>

  <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
    Alerting is re-armed: any future drift will notify again.
  </p>
</body>
</html>`;

  const textLines = [
    "✓ Shopify dispute reason enum drift resolved",
    "",
    `The daily check-shopify-reasons cron ran against ${checkedShopDomain}`,
    `and confirmed the previously reported drift is now resolved. Our local`,
    `ALL_DISPUTE_REASONS matches Shopify's live enum (${enumTotalCount} values).`,
    "",
    "Previously missing locally (now added):",
    ...(previousMissingLocally.length > 0
      ? previousMissingLocally.map((v) => `  + ${v}`)
      : ["  (none)"]),
    "",
    "Previously extra locally (now aligned):",
    ...(previousExtraLocally.length > 0
      ? previousExtraLocally.map((v) => `  + ${v}`)
      : ["  (none)"]),
    "",
    `Checked shop: ${checkedShopDomain}`,
    `Shopify enum count: ${enumTotalCount}`,
    `Resolved at: ${timestamp}`,
    "",
    "Alerting is re-armed: any future drift will notify again.",
  ];
  const text = textLines.join("\n");

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error("[email] Reason enum drift-resolved alert failed:", err);
  }
}
