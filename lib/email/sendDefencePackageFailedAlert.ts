/**
 * A defence package failed to build — tell someone.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `markFailed` and the two validation-failure branches write a `failed` row
 * and an audit event, and nothing reads either. On 2026-08-12 that had let
 * FOURTEEN open disputes accumulate a failed latest package with no fileable
 * defence — discovered because a merchant opened the UI and asked, not because
 * the system said anything.
 *
 * The cost is measurable: `#12936` sat blocked three weeks past its deadline,
 * and `#353605` lost its deadline outright while two prompt versions shipped
 * past it. Both were recoverable the whole time. Silence, not the failure, is
 * what made them losses.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────
 *
 * Not a merchant email. A build failure is an internal defect — the merchant
 * has nothing to act on and telling them would be alarming and useless. This
 * goes to ADMIN_NOTIFY_EMAIL, like the enum-drift and carrier alerts.
 *
 * Not a retry trigger either. `evaluateGenerationGuard` decides that, from the
 * recorded versions; this only reports.
 *
 * ── FIRE AND FORGET ───────────────────────────────────────────────────
 *
 * `sendAdminEmail` never throws. A build that already failed must not fail a
 * SECOND time because the alert could not be delivered, and the caller must
 * never have its failure path altered by this.
 */

import { sendAdminEmail } from "./adminEmail";

export interface DefencePackageFailedAlertOptions {
  shopDomain: string | null;
  orderName: string | null;
  disputeId: string;
  packageId: string;
  version: number;
  failureCode: string;
  failureReason: string;
  /** Deterministic validator errors, when the failure came from validation. */
  validationErrors?: Array<{ rule?: string; section?: string; message?: string }>;
  /** ISO date the dispute is due, when known — decides how urgent this is. */
  dueAt?: string | null;
  /** The versions in force, so a reader can tell a stale failure from a live one. */
  promptVersion?: number | null;
  validatorVersion?: number | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Days until the deadline, or null when there is no date to measure against. */
function daysUntil(dueAt: string | null | undefined, now: Date): number | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  return Math.floor((due.getTime() - now.getTime()) / 86_400_000);
}

export async function sendDefencePackageFailedAlert(
  options: DefencePackageFailedAlertOptions,
  now: Date = new Date(),
): Promise<void> {
  const days = daysUntil(options.dueAt, now);
  /* The deadline is the whole reason this is urgent: a failed package is a
   * dispute that files nothing, and Shopify submits its own scrape instead. */
  const urgency =
    days === null ? "" : days < 0 ? " — PAST DEADLINE" : days <= 3 ? ` — due in ${days}d` : "";

  const who = [options.shopDomain, options.orderName].filter(Boolean).join(" ");
  const subject = `Defence package failed: ${who || options.disputeId}${urgency}`;

  const errors = (options.validationErrors ?? []).filter(
    (e) => e && (e.rule || e.section || e.message),
  );
  const errorLines = errors.map(
    (e) => `${e.section ?? "?"} — ${e.rule ?? "?"}: ${e.message ?? ""}`,
  );

  const facts: Array<[string, string]> = [
    ["Shop", options.shopDomain ?? "—"],
    ["Order", options.orderName ?? "—"],
    ["Dispute", options.disputeId],
    ["Package", `${options.packageId} (v${options.version})`],
    ["Deadline", options.dueAt ? `${options.dueAt}${urgency}` : "—"],
    ["Failure", `${options.failureCode} — ${options.failureReason}`],
    [
      "Versions",
      `prompt ${options.promptVersion ?? "—"} · validator ${options.validatorVersion ?? "—"}`,
    ],
  ];

  const text = [
    subject,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(errorLines.length ? ["", "Validation errors:", ...errorLines.map((l) => `  - ${l}`)] : []),
    "",
    /* The recovery rule, stated so the reader does not have to remember it. */
    "This dispute has no fileable defence package. It will regenerate",
    "automatically once the prompt, validator or evidence changes",
    "(evaluateGenerationGuard); until then it files nothing and Shopify",
    "submits its own scrape at the deadline.",
  ].join("\n");

  const html = [
    `<h2>${esc(subject)}</h2>`,
    "<table cellpadding=6 style=\"border-collapse:collapse\">",
    ...facts.map(
      ([k, v]) =>
        `<tr><td style="color:#666">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`,
    ),
    "</table>",
    ...(errorLines.length
      ? [
          "<h3>Validation errors</h3><ul>",
          ...errorLines.map((l) => `<li>${esc(l)}</li>`),
          "</ul>",
        ]
      : []),
    "<p style=\"color:#666\">This dispute has no fileable defence package. It will regenerate automatically once the prompt, validator or evidence changes; until then it files nothing and Shopify submits its own scrape at the deadline.</p>",
  ].join("\n");

  await sendAdminEmail({ subject, html, text, logTag: "defence-package-failed" });
}
