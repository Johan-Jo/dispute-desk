/**
 * Send an admin notification when a previously-detected Shopify
 * query-field drift has been resolved — i.e. the daily dry-run
 * checker now reports zero `undefinedField` errors after a prior
 * run reported drift.
 *
 * Fires from lib/shopify/checkQueryFieldDrift.ts when the most recent
 * audit_events row was of type 'shopify_query_field_drift' and the
 * current run is clean. Pairs with sendQueryFieldDriftAlert.ts so the
 * admin gets both "broken" and "fixed" signals.
 *
 * Non-blocking: does not throw, logs on failure only.
 */

import { sendAdminEmail } from "./adminEmail";
import type { QueryFieldDriftRow } from "@/lib/shopify/checkQueryFieldDrift";

export interface QueryFieldDriftResolvedAlertOptions {
  previousDrift: QueryFieldDriftRow[];
  checkedShopDomain: string;
  queriesChecked: number;
}

function renderRows(rows: QueryFieldDriftRow[]): string {
  if (rows.length === 0) return "<li><em>none</em></li>";
  return rows
    .map(
      (r) =>
        `<li><code>${r.query}</code> — <code>${r.type}.${r.field}</code></li>`,
    )
    .join("");
}

export async function sendQueryFieldDriftResolvedAlert(
  options: QueryFieldDriftResolvedAlertOptions,
): Promise<void> {
  const { previousDrift, checkedShopDomain, queriesChecked } = options;
  const timestamp = new Date().toUTCString();
  const subject = `Shopify GraphQL query field drift resolved`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#15803D;">✓ Shopify GraphQL query field drift resolved</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;">
    The daily <code>check-shopify-reasons</code> cron dry-ran
    <strong>${queriesChecked}</strong> production GraphQL queries
    against <code>${checkedShopDomain}</code> and Shopify accepted
    every field selection. The previously reported drift is gone.
  </p>

  <h3 style="margin:24px 0 4px;font-size:15px;color:#0F172A;">Previously failing field selections (now fixed)</h3>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#15803D;">
    ${renderRows(previousDrift)}
  </ul>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Checked shop</td><td style="padding:4px 0;"><code>${checkedShopDomain}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Queries checked</td><td style="padding:4px 0;">${queriesChecked}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Resolved at</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>

  <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
    Alerting is re-armed: any future drift will notify again.
  </p>
</body>
</html>`;

  const textLines = [
    "✓ Shopify GraphQL query field drift resolved",
    "",
    `The daily check-shopify-reasons cron dry-ran ${queriesChecked}`,
    `production GraphQL queries against ${checkedShopDomain} and`,
    `Shopify accepted every field selection. Drift is gone.`,
    "",
    "Previously failing field selections (now fixed):",
    ...(previousDrift.length > 0
      ? previousDrift.map((r) => `  + ${r.query}: ${r.type}.${r.field}`)
      : ["  (none)"]),
    "",
    `Checked shop: ${checkedShopDomain}`,
    `Queries checked: ${queriesChecked}`,
    `Resolved at: ${timestamp}`,
    "",
    "Alerting is re-armed: any future drift will notify again.",
  ];
  const text = textLines.join("\n");

  await sendAdminEmail({
    subject,
    html,
    text,
    logTag: "query-field-drift-resolved",
  });
}
