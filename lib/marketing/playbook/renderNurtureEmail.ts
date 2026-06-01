/**
 * Render one nurture-sequence email to { subject, html, text }.
 *
 * Table-based HTML for broad email-client compatibility (same approach as
 * lib/email/templates.ts), in the DisputeDesk editorial-dossier palette
 * (slate header, paper body, blue CTA). Used by both the welcome send at
 * capture time and the daily follow-up cron.
 */

import type { NurtureEmail } from "@/lib/marketing/playbook/nurtureSequence";

const SLATE = "#0f172a";
const BLUE = "#2563eb";
const PAPER = "#fbf7ee";
const INK = "#0b1220";
const INK_2 = "#233045";
const MUTED = "#64748b";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderNurtureEmail(
  email: NurtureEmail,
  opts: { unsubscribeUrl: string },
): RenderedEmail {
  const { unsubscribeUrl } = opts;

  const paragraphs = email.body
    .filter((b) => b.t === "p")
    .map(
      (b) =>
        `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.62;color:${INK_2};font-family:Georgia,'Times New Roman',serif;">${escapeHtml(b.c)}</p>`,
    )
    .join("");

  const signBlock = email.body.find((b) => b.t === "sign");
  const signLines = signBlock
    ? signBlock.c.split("\n").map((line, i) =>
        i === 0
          ? `<p style="margin:18px 0 0 0;font-size:15px;color:${INK_2};font-family:Georgia,'Times New Roman',serif;">${escapeHtml(line)}</p>`
          : `<p style="margin:10px 0 0 0;font-size:14px;font-style:italic;color:${MUTED};font-family:Georgia,'Times New Roman',serif;">${escapeHtml(line)}</p>`,
      ).join("")
    : "";

  const preheader = escapeHtml(email.preview);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#cfc6b4;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:${INK};">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#cfc6b4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${PAPER};border:1px solid ${INK};overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background-color:${SLATE};padding:20px 36px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#60a5fa;font-family:'Courier New',monospace;">&sect; DisputeDesk &middot; Field Guide</p>
              <p style="margin:6px 0 0 0;font-size:18px;font-weight:700;color:#f4eee2;letter-spacing:-0.3px;font-family:Arial,Helvetica,sans-serif;">DisputeDesk</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:34px 36px 30px 36px;">
              <p style="margin:0 0 22px 0;font-size:22px;font-weight:600;color:${INK};line-height:1.2;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(email.subject)}</p>
              ${paragraphs}

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px 0;">
                <tr>
                  <td style="background-color:${BLUE};border-radius:3px;">
                    <a href="${email.cta.href}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(email.cta.label)} &rarr;</a>
                  </td>
                </tr>
              </table>

              ${signLines}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:${SLATE};padding:16px 36px;">
              <p style="margin:0;font-size:12px;color:rgba(244,238,226,0.6);text-align:center;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                You're receiving this because you downloaded the Liability-Shift Playbook.<br>
                <a href="${unsubscribeUrl}" style="color:rgba(244,238,226,0.7);text-decoration:underline;">Unsubscribe</a>
                &middot; &copy; 2026 DisputeDesk
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = email.body
    .map((b) => b.c)
    .join("\n\n");
  const text = `${email.subject}\n\n${textBody}\n\n${email.cta.label}: ${email.cta.href}\n\n---\nYou're receiving this because you downloaded the Liability-Shift Playbook.\nUnsubscribe: ${unsubscribeUrl}\n© 2026 DisputeDesk`;

  return { subject: email.subject, html, text };
}
