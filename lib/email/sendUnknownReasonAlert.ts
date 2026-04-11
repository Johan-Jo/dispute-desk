/**
 * Send an admin notification email when the dispute sync sees a Shopify
 * dispute reason that isn't in lib/rules/disputeReasons.ts ALL_DISPUTE_REASONS.
 * Fires at most once per (reason, phase) pair because the caller only
 * invokes it when a brand-new reason_template_mappings row was just created.
 *
 * Non-blocking — does not throw; logs on failure only.
 */

import { sendAdminEmail } from "./adminEmail";

export interface UnknownReasonAlertOptions {
  /** The new reason code Shopify sent (not in ALL_DISPUTE_REASONS). */
  reasonCode: string;
  /** Dispute phase Shopify reported: "inquiry" or "chargeback" (lowercased). */
  phase: string;
  /** Shop that received the dispute. */
  shopDomain: string;
  /** First dispute GID the new reason appeared on, for traceability. */
  firstSeenDisputeGid: string;
}

export async function sendUnknownReasonAlert(
  options: UnknownReasonAlertOptions,
): Promise<void> {
  const { reasonCode, phase, shopDomain, firstSeenDisputeGid } = options;
  const timestamp = new Date().toUTCString();
  const subject = `New Shopify dispute reason: ${reasonCode}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">New Shopify dispute reason detected</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;">
    The dispute sync received a reason code that isn&apos;t in
    <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;">ALL_DISPUTE_REASONS</code>.
    A placeholder row has been created in <code>reason_template_mappings</code>
    with <code>template_id = NULL</code> and <code>family = &apos;Unknown&apos;</code>.
    Open the admin reason-mapping page to review and assign a template.
  </p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Reason code</td><td style="padding:4px 0;"><code>${reasonCode}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Phase</td><td style="padding:4px 0;">${phase}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Shop</td><td style="padding:4px 0;">${shopDomain}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">First dispute</td><td style="padding:4px 0;"><code>${firstSeenDisputeGid}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Detected at</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>
  <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
    Next step: add <code>${reasonCode}</code> to <code>ALL_DISPUTE_REASONS</code>
    in <code>lib/rules/disputeReasons.ts</code>, add a label + family mapping,
    and assign a default template on the admin reason-mapping page.
  </p>
</body>
</html>`;

  const text = [
    "New Shopify dispute reason detected",
    "",
    `Reason code: ${reasonCode}`,
    `Phase: ${phase}`,
    `Shop: ${shopDomain}`,
    `First dispute: ${firstSeenDisputeGid}`,
    `Detected at: ${timestamp}`,
    "",
    `The dispute sync received a reason code that isn't in ALL_DISPUTE_REASONS.`,
    `A placeholder row has been created in reason_template_mappings with`,
    `template_id = NULL and family = 'Unknown'. Review and assign a template`,
    `on the admin reason-mapping page.`,
  ].join("\n");

  await sendAdminEmail({ subject, html, text, logTag: "unknown-reason" });
}
