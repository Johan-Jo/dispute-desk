/**
 * A save to Shopify ENDED in `save_failed` — tell the admin.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * whj8db-1q #23750 (2026-11-10): Shopify rejected every defence-PDF upload
 * with HTTP 422 for nine days while the pack read "saved". Nothing at
 * DisputeDesk said anything. `sendDefencePackageFailedAlert` covers a failed
 * BUILD and `sendDeadlineNoFileAdminAlert` covers the deadline cron's refusals;
 * this covers the third way a dispute ends up filed by nobody: the save job
 * itself giving up.
 *
 * Not a merchant email. Fire and forget — `sendAdminEmail` never throws.
 */

import { sendAdminEmail } from "./adminEmail";

export interface SaveFailedAdminAlertOptions {
  shopDomain: string | null;
  orderName: string | null;
  disputeId: string;
  packId: string;
  dueAt: string | null;
  /** Short machine class, e.g. `shopify_upload_rejected`. */
  errorClass: string;
  /** The handler's own reason string (already includes Shopify's message). */
  reason: string;
  attempt: number;
  maxAttempts: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildSaveFailedAdminAlert(options: SaveFailedAdminAlertOptions): {
  subject: string;
  text: string;
  html: string;
} {
  const who = [options.shopDomain, options.orderName].filter(Boolean).join(" ");
  const subject = `Save to Shopify failed: ${who || options.disputeId}`;
  const facts: Array<[string, string]> = [
    ["Shop", options.shopDomain ?? "—"],
    ["Order", options.orderName ?? "—"],
    ["Dispute", options.disputeId],
    ["Pack", options.packId],
    ["Deadline", options.dueAt ?? "—"],
    ["Error class", options.errorClass],
    ["Attempt", `${options.attempt} of ${options.maxAttempts}`],
    ["Reason", options.reason.slice(0, 500)],
  ];
  const footer =
    "The pack is now save_failed and can be saved again. Until it is, DisputeDesk's latest evidence is " +
    "not in Shopify for this dispute, and unless a response is sent first Shopify submits its own scrape at the deadline.";

  const text = [subject, "", ...facts.map(([k, v]) => `${k}: ${v}`), "", footer].join("\n");
  const html = [
    `<h2>${esc(subject)}</h2>`,
    '<table cellpadding=6 style="border-collapse:collapse">',
    ...facts.map(
      ([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`,
    ),
    "</table>",
    `<p style="color:#666">${esc(footer)}</p>`,
  ].join("\n");
  return { subject, text, html };
}

export async function sendSaveFailedAdminAlert(
  options: SaveFailedAdminAlertOptions,
): Promise<void> {
  const { subject, text, html } = buildSaveFailedAdminAlert(options);
  await sendAdminEmail({ subject, html, text, logTag: "save-failed" });
}
