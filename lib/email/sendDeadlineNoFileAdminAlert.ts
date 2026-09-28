/**
 * The deadline cron filed NOTHING for a dispute due today — tell the admin.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * blume-box #353605 (2026-08-11): a 98%-complete pack with carrier-confirmed
 * delivery reached its deadline with a package the content check refused, the
 * cron logged `deadline_cron_no_fallback`, and the only notice went to the
 * merchant. Shopify then filed its own scrape. Nobody at DisputeDesk saw it
 * until the merchant's admin list showed "Filed by Shopify" six weeks later.
 *
 * `sendDefencePackageFailedAlert` covers a failed BUILD. This covers the other
 * half: every way the last-day run can end with no submission for a case it
 * scanned — refused selection, stale response cycle, missing bank claim, a
 * finalize/enqueue the database refused, or no pack at all. Each of those is a
 * dispute Shopify will argue for us, badly.
 *
 * Not a merchant email; the merchant copy is `sendDefenceDeadlineFallbackAlert`.
 * Fire and forget — `sendAdminEmail` never throws, so a failed alert cannot
 * change what the cron does next.
 */

import { sendAdminEmail } from "./adminEmail";

export interface DeadlineNoFileAdminAlertOptions {
  shopDomain: string | null;
  orderName: string | null;
  disputeId: string;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string | null;
  /** The cron's own name for why nothing was filed (audit vocabulary). */
  refusal: string;
  /** Anything else the reader needs to triage: package id/version, reasons. */
  detail?: Record<string, unknown>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildDeadlineNoFileAdminAlert(options: DeadlineNoFileAdminAlertOptions): {
  subject: string;
  text: string;
  html: string;
} {
  const who = [options.shopDomain, options.orderName].filter(Boolean).join(" ");
  const subject = `Deadline today — DisputeDesk filed nothing: ${who || options.disputeId}`;

  const amount =
    options.amount != null ? `${options.amount} ${options.currencyCode ?? ""}`.trim() : "—";
  const detailLines = Object.entries(options.detail ?? {})
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]);

  const facts: Array<[string, string]> = [
    ["Shop", options.shopDomain ?? "—"],
    ["Order", options.orderName ?? "—"],
    ["Dispute", options.disputeId],
    ["Reason", options.reason ?? "—"],
    ["Amount", amount],
    ["Deadline", options.dueAt ?? "—"],
    ["Refusal", options.refusal],
    ...detailLines,
  ];

  const footer =
    "The deadline cron submitted no evidence for this dispute. Unless someone " +
    "files before the deadline, Shopify submits its own order-data scrape instead.";

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

export async function sendDeadlineNoFileAdminAlert(
  options: DeadlineNoFileAdminAlertOptions,
): Promise<void> {
  const { subject, text, html } = buildDeadlineNoFileAdminAlert(options);
  await sendAdminEmail({ subject, html, text, logTag: "deadline-no-file" });
}
