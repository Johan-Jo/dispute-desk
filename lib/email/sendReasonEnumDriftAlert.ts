/**
 * Send an admin notification when the daily Shopify GraphQL
 * introspection detects drift between the live
 * ShopifyPaymentsDisputeReason enum and our local ALL_DISPUTE_REASONS.
 *
 * Fires from the /api/cron/check-shopify-reasons route. The route
 * handles dedup by comparing against the latest audit_events row with
 * event_type = 'shopify_enum_drift' — this helper just sends the email.
 *
 * Non-blocking: does not throw, logs on failure only.
 */

import { sendAdminEmail } from "./adminEmail";

export interface ReasonEnumDriftAlertOptions {
  /** Reasons in Shopify's enum that are missing from ALL_DISPUTE_REASONS. */
  missingLocally: string[];
  /** Reasons in ALL_DISPUTE_REASONS that are missing from Shopify's enum. */
  extraLocally: string[];
  /** The shop whose session was used to run the introspection query. */
  checkedShopDomain: string;
  /** Total enum value count reported by Shopify (for context). */
  enumTotalCount: number;
}

function renderList(items: string[]): string {
  if (items.length === 0) return "<li><em>none</em></li>";
  return items.map((v) => `<li><code>${v}</code></li>`).join("");
}

export async function sendReasonEnumDriftAlert(
  options: ReasonEnumDriftAlertOptions,
): Promise<void> {
  const { missingLocally, extraLocally, checkedShopDomain, enumTotalCount } =
    options;
  const timestamp = new Date().toUTCString();
  const subject = `Shopify dispute reason enum drift detected`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">Shopify dispute reason enum drift detected</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;">
    The daily <code>check-shopify-reasons</code> cron ran a GraphQL
    introspection against <code>${checkedShopDomain}</code> and found
    a difference between Shopify&apos;s live
    <code>ShopifyPaymentsDisputeReason</code> enum (${enumTotalCount}
    values) and our local <code>ALL_DISPUTE_REASONS</code> list in
    <code>lib/rules/disputeReasons.ts</code>.
  </p>

  <h3 style="margin:24px 0 4px;font-size:15px;color:#0F172A;">Missing locally</h3>
  <p style="margin:0 0 4px;color:#374151;font-size:13px;">
    Shopify has these values and we don&apos;t. These need to be added
    to <code>ALL_DISPUTE_REASONS</code> with labels and families, and
    assigned default templates on the admin reason-mapping page.
  </p>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#991B1B;">
    ${renderList(missingLocally)}
  </ul>

  <h3 style="margin:16px 0 4px;font-size:15px;color:#0F172A;">Extra locally</h3>
  <p style="margin:0 0 4px;color:#374151;font-size:13px;">
    We have these values and Shopify doesn&apos;t (anymore, or on this
    API version). Not urgent — but if they stay missing, consider
    retiring the local entries.
  </p>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#92400E;">
    ${renderList(extraLocally)}
  </ul>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Checked shop</td><td style="padding:4px 0;"><code>${checkedShopDomain}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Shopify enum count</td><td style="padding:4px 0;">${enumTotalCount}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Detected at</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>

  <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
    This alert deduplicates: subsequent runs with the same diff will
    not re-send. Once the drift is resolved (local list updated), the
    alert resets and future drift will notify again.
  </p>
</body>
</html>`;

  const textLines = [
    "Shopify dispute reason enum drift detected",
    "",
    `The daily check-shopify-reasons cron ran a GraphQL introspection`,
    `against ${checkedShopDomain} and found a difference between`,
    `Shopify's live ShopifyPaymentsDisputeReason enum (${enumTotalCount}`,
    `values) and our local ALL_DISPUTE_REASONS in lib/rules/disputeReasons.ts.`,
    "",
    "Missing locally (Shopify has, we don't):",
    ...(missingLocally.length > 0
      ? missingLocally.map((v) => `  - ${v}`)
      : ["  (none)"]),
    "",
    "Extra locally (we have, Shopify doesn't):",
    ...(extraLocally.length > 0
      ? extraLocally.map((v) => `  - ${v}`)
      : ["  (none)"]),
    "",
    `Checked shop: ${checkedShopDomain}`,
    `Shopify enum count: ${enumTotalCount}`,
    `Detected at: ${timestamp}`,
  ];
  const text = textLines.join("\n");

  await sendAdminEmail({ subject, html, text, logTag: "enum-drift" });
}
