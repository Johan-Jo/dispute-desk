/**
 * Send email alert when AI generation succeeds for some locales but not all.
 * Fire-and-forget — never throws; caller should not await the result in the hot path.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface PartialGenerationAlertOptions {
  to: string;
  contentItemId: string;
  proposedTitle: string;
  succeededLocales: string[];
  failedLocales: Array<{ locale: string; error: string | null }>;
  adminBaseUrl: string;
}

export async function sendPartialGenerationAlert(
  options: PartialGenerationAlertOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping partial generation alert");
    return { ok: false, error: "Email service not configured" };
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const adminUrl = `${options.adminBaseUrl}/admin/resources/list`;
  const subject = `Generation incomplete: ${options.proposedTitle}`;

  const failedRows = options.failedLocales
    .map(
      (f) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;font-weight:500;">${esc(f.locale)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;color:#64748B;font-size:13px;">${esc(f.error ?? "Unknown error")}</td></tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0B1220;">
  <div style="border-bottom:3px solid #F59E0B;padding-bottom:16px;margin-bottom:24px;">
    <h2 style="margin:0;color:#1D4ED8;">DisputeDesk</h2>
    <p style="margin:4px 0 0;font-size:14px;color:#64748B;">Autopilot — Partial Generation</p>
  </div>

  <p style="font-size:16px;line-height:1.6;">
    Generation for <strong>${esc(options.proposedTitle)}</strong> completed but
    <strong>${options.failedLocales.length} locale(s) failed</strong>.
    ${options.succeededLocales.length} locale(s) were saved and queued for publish.
  </p>

  <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;margin:16px 0;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#92400E;">Failed locales</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #FDE68A;color:#92400E;">Locale</th>
          <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #FDE68A;color:#92400E;">Error</th>
        </tr>
      </thead>
      <tbody>${failedRows}</tbody>
    </table>
  </div>

  <p style="font-size:14px;color:#374151;">
    Succeeded: <strong>${esc(options.succeededLocales.join(", "))}</strong>
  </p>

  <a href="${adminUrl}" style="display:inline-block;background:#1D4ED8;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;margin-top:8px;">
    View in Admin
  </a>

  <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
  <p style="font-size:12px;color:#94A3B8;">This is an automated alert from DisputeDesk Autopilot. Content item ID: ${esc(options.contentItemId)}</p>
</body>
</html>`.trim();

  const text = [
    `Generation incomplete: ${options.proposedTitle}`,
    `Failed locales (${options.failedLocales.length}): ${options.failedLocales.map((f) => `${f.locale} — ${f.error ?? "unknown"}`).join("; ")}`,
    `Succeeded: ${options.succeededLocales.join(", ")}`,
    `View in admin: ${adminUrl}`,
  ].join("\n\n");

  const resend = new Resend(RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: options.to,
      subject,
      html,
      text,
      tags: [{ name: "category", value: "autopilot-partial-generation" }],
    });

    if (error) {
      console.error("[email] Partial generation alert failed:", error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Partial generation alert error:", msg);
    return { ok: false, error: msg };
  }
}
