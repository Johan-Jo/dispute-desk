/**
 * Send an admin notification when the daily Shopify GraphQL dry-run
 * drift checker (lib/shopify/checkQueryFieldDrift.ts) detects one or
 * more `undefinedField` errors — i.e. a production query string
 * selects a field Shopify no longer accepts.
 *
 * Fires from /api/cron/check-shopify-reasons. The route handles dedup
 * by comparing against the latest audit_events row with event_type =
 * 'shopify_query_field_drift' — this helper only sends the email.
 *
 * Non-blocking: does not throw, logs on failure only.
 */

import { sendAdminEmail } from "./adminEmail";
import type { QueryFieldDriftRow } from "@/lib/shopify/checkQueryFieldDrift";

export interface QueryFieldDriftAlertOptions {
  driftRows: QueryFieldDriftRow[];
  /** The shop whose offline session was used to send the dry-run. */
  checkedShopDomain: string;
  /** How many queries the checker exercised in this run. */
  queriesChecked: number;
}

function renderRows(rows: QueryFieldDriftRow[]): string {
  if (rows.length === 0) return "<li><em>none</em></li>";
  return rows
    .map(
      (r) =>
        `<li><code>${r.query}</code> — <code>${r.type}.${r.field}</code><br><span style="color:#6B7280;font-size:12px;">${r.message}</span></li>`,
    )
    .join("");
}

export async function sendQueryFieldDriftAlert(
  options: QueryFieldDriftAlertOptions,
): Promise<void> {
  const { driftRows, checkedShopDomain, queriesChecked } = options;
  const timestamp = new Date().toUTCString();
  const subject = `Shopify GraphQL query field drift detected (${driftRows.length})`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#991B1B;">Shopify GraphQL query field drift detected</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;">
    The daily <code>check-shopify-reasons</code> cron dry-ran
    <strong>${queriesChecked}</strong> production GraphQL queries
    against <code>${checkedShopDomain}</code> and Shopify rejected
    <strong>${driftRows.length}</strong> field selection${driftRows.length === 1 ? "" : "s"}
    with an <code>undefinedField</code> error. Every dispute pack
    build, sync, or KPI computation that touches one of these
    queries is failing silently on production right now — the parent
    <code>data.node</code> nulls out and the consumer sees "couldn&apos;t
    load order data".
  </p>

  <h3 style="margin:24px 0 4px;font-size:15px;color:#0F172A;">Failing field selections</h3>
  <ul style="margin:4px 0 12px 20px;padding:0;color:#991B1B;">
    ${renderRows(driftRows)}
  </ul>

  <h3 style="margin:24px 0 4px;font-size:15px;color:#0F172A;">Remediation</h3>
  <ol style="margin:4px 0 12px 20px;padding:0;color:#374151;font-size:13px;">
    <li>For each row above, open the named query file under
        <code>lib/shopify/queries/</code> and remove or rename the field
        selection. The Shopify 2026-01 changelog at
        shopify.dev/changelog lists the canonical replacements.</li>
    <li>Add the removed field to the deny-list in
        <code>lib/shopify/queries/__tests__/schemaDriftGuard.test.ts</code>
        so the static guard prevents reintroduction.</li>
    <li>Run <code>npm run release:verify</code>; the deny-list test
        should fail on the old query before your edit and pass after.</li>
    <li>Deploy. On the next cron tick this alert resets and a
        "resolved" email lands.</li>
  </ol>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Checked shop</td><td style="padding:4px 0;"><code>${checkedShopDomain}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Queries checked</td><td style="padding:4px 0;">${queriesChecked}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Failing rows</td><td style="padding:4px 0;">${driftRows.length}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Detected at</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>

  <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
    This alert deduplicates: subsequent runs with the same exact diff
    will not re-send. Once any drift entry changes (new field
    affected, or the existing one is removed from a query), the alert
    resets and re-fires.
  </p>
</body>
</html>`;

  const textLines = [
    `Shopify GraphQL query field drift detected (${driftRows.length})`,
    "",
    `The daily check-shopify-reasons cron dry-ran ${queriesChecked}`,
    `production GraphQL queries against ${checkedShopDomain} and`,
    `Shopify rejected ${driftRows.length} field selection${driftRows.length === 1 ? "" : "s"}`,
    `with an undefinedField error.`,
    "",
    "Failing field selections:",
    ...(driftRows.length > 0
      ? driftRows.map((r) => `  - ${r.query}: ${r.type}.${r.field}  (${r.message})`)
      : ["  (none)"]),
    "",
    "Remediation:",
    "  1. Open the query file under lib/shopify/queries/ and remove/rename the field.",
    "  2. Add the removed field to the deny-list in",
    "     lib/shopify/queries/__tests__/schemaDriftGuard.test.ts.",
    "  3. Run npm run release:verify; deploy.",
    "",
    `Checked shop: ${checkedShopDomain}`,
    `Queries checked: ${queriesChecked}`,
    `Detected at: ${timestamp}`,
  ];
  const text = textLines.join("\n");

  await sendAdminEmail({ subject, html, text, logTag: "query-field-drift" });
}
