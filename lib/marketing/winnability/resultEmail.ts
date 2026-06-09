/**
 * The merchant result email for the 5-Minute Winnability Test (DP-RESULT-EMAIL).
 *
 * Sent once, to the merchant, right after they finish the test — the email the
 * tool promises ("we'll email you a copy"). Table-based + inline styles only so
 * it renders in Gmail/Outlook/Apple Mail; no SVG (Gmail strips it) — the gauge
 * is a table-cell meter, and the shield is a hosted PNG (public/shield-icon.png).
 *
 * Verdict, reasons and CTAs come from lib/marketing/winnability/scoring.ts, the
 * same source the on-screen test uses, so the email can never diverge from what
 * the merchant just saw.
 */

import {
  scoreWinnability,
  scoreRatio,
  ctaFor,
  ratioMarkerPct,
  VERDICT_BAND,
  RATIO_BAND_COLOR,
  RATIO_BAND_TEXT,
  RATIO_BAND_DESC,
  type WinnabilityAnswers,
} from "./scoring";

export interface WinnabilityResultEmail {
  subject: string;
  html: string;
  text: string;
}

interface BuildOpts {
  answers: WinnabilityAnswers;
  /** Absolute site origin, e.g. https://disputedesk.app (no trailing slash). */
  baseUrl: string;
  /** Absolute unsubscribe URL for the footer. */
  unsubscribeUrl: string;
}

/** Prepend the origin to a relative ("/...") href; leave absolute URLs as-is. */
function abs(baseUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${baseUrl}${href}`;
}

const FONT_SERIF = "Georgia,'Times New Roman',serif";
const FONT_SANS = "-apple-system,Arial,sans-serif";
const FONT_MONO = "ui-monospace,'Courier New',monospace";

export function buildWinnabilityResultEmail(opts: BuildOpts): WinnabilityResultEmail {
  const { answers, baseUrl, unsubscribeUrl } = opts;
  const w = scoreWinnability(answers);
  const ratio = scoreRatio(answers);
  const cta = ctaFor(w);

  const band = VERDICT_BAND[w.state];
  const ratioColor = RATIO_BAND_COLOR[ratio.band];
  const ratioText = RATIO_BAND_TEXT[ratio.band];
  const ratioDesc = RATIO_BAND_DESC[ratio.band];
  const pctLabel = ratio.pct == null ? "—" : `${ratio.pct.toFixed(2)}%`;
  const markerPct = Math.round(ratioMarkerPct(ratio.pct));

  const shieldSrc = `${baseUrl}/shield-icon.png`;
  const ctaPrimaryHref = abs(baseUrl, cta.primary.href);
  const ctaSecondaryHref = cta.secondary ? abs(baseUrl, cta.secondary.href) : null;

  // ---- reason rows (✓/✕) ----
  const reasonRows = w.reasons
    .map(([mark, textVal]) => {
      const sym = mark === "ok" ? "&#10003;" : "&#10005;";
      const color = mark === "ok" ? "#1f7a4d" : "#8a2a1f";
      return `<tr><td style="padding:11px 0;border-bottom:1px solid rgba(11,18,32,0.12);font-family:Arial,sans-serif;font-size:15px;color:#233045;">
        <span style="color:${color};font-weight:bold;">${sym}</span>&nbsp;&nbsp;${textVal}</td></tr>`;
    })
    .join("");

  // ---- ratio meter (only render the pointer when we have a number) ----
  const markerRow =
    ratio.pct == null
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>
          <td width="${markerPct}%" style="font-size:0;line-height:0;">&nbsp;</td>
          <td align="left" style="font-family:Arial,sans-serif;font-size:13px;color:${ratioColor};line-height:1;">&#9650;</td>
        </tr></table>`;

  const secondaryLink = ctaSecondaryHref
    ? `<p style="margin:14px 0 0 0;"><a href="${ctaSecondaryHref}" target="_blank" style="font-family:Arial,sans-serif;font-size:13px;color:#93c5fd;text-decoration:none;">${cta.secondary!.label} &rarr;</a></p>`
    : "";

  const preheader = `Your chargeback result: ${band.label} — here’s why, and your ratio risk.`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Your chargeback result</title></head>
<body style="margin:0;padding:0;background:#1e293b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1e293b;">
  <tr><td align="center" style="padding:0;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#1e293b;font-size:1px;line-height:1px;">${preheader}</div>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fbf7ee;border:1px solid #0b1220;">

      <!-- masthead -->
      <tr><td style="background:#0f172a;padding:22px 32px;" align="left">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td align="left" style="vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;padding-right:11px;">
                <img src="${shieldSrc}" width="26" height="26" alt="DisputeDesk" style="display:block;border:0;" />
              </td>
              <td style="vertical-align:middle;font-family:${FONT_MONO};font-size:13px;letter-spacing:2px;color:#f4eee2;">DISPUTEDESK</td>
            </tr></table>
          </td>
          <td align="right" style="vertical-align:middle;font-family:${FONT_MONO};font-size:11px;letter-spacing:1px;color:rgba(244,238,226,0.55);">YOUR RESULT</td>
        </tr></table>
      </td></tr>

      <!-- accent rule -->
      <tr><td style="height:3px;background:#1d4ed8;font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- body -->
      <tr><td style="padding:34px 32px 8px 32px;">

        <!-- verdict band -->
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${band.bg};border-radius:4px;padding:6px 13px;font-family:${FONT_MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${band.color};">&#9679;&nbsp; ${band.label}</td>
        </tr></table>

        <!-- headline -->
        <h1 style="font-family:${FONT_SERIF};font-weight:bold;font-size:32px;line-height:1.1;letter-spacing:-0.5px;color:#0b1220;margin:18px 0 6px 0;">${w.headline}</h1>
        <p style="font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:#475569;margin:0 0 22px 0;">You answered about one recent dispute. Here&rsquo;s how it scores against Visa&rsquo;s Compelling Evidence 3.0 &mdash; the rulebook that actually decides friendly-fraud cases.</p>

        <!-- reasons -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(11,18,32,0.12);">
          ${reasonRows}
        </table>

        <!-- ratio meter -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 6px 0;background:#ffffff;border:1px solid rgba(11,18,32,0.12);border-radius:8px;">
          <tr><td style="padding:18px 20px;">
            <p style="margin:0 0 3px 0;font-family:${FONT_MONO};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Your chargeback ratio</p>
            <p style="margin:0 0 12px 0;font-family:${FONT_SERIF};font-size:30px;font-weight:bold;color:${ratioColor};line-height:1;">${pctLabel}
              <span style="font-family:Arial,sans-serif;font-size:13px;font-weight:normal;color:${ratioColor};">&nbsp; ${ratioText}</span></p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>
              <td width="60%" style="height:8px;background:#bfe3cd;font-size:0;line-height:0;border-radius:4px 0 0 4px;">&nbsp;</td>
              <td width="40%" style="height:8px;background:#e7c2bb;font-size:0;line-height:0;border-radius:0 4px 4px 0;">&nbsp;</td>
            </tr></table>
            ${markerRow}
            <p style="margin:6px 0 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#475569;">The danger line sits at ~0.9% (Visa&rsquo;s Dispute Monitoring Program). ${ratioDesc}</p>
          </td></tr>
        </table>

      </td></tr>

      <!-- CTA block -->
      <tr><td style="padding:8px 32px 34px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:8px;"><tr><td style="padding:24px 26px;">
          <h2 style="font-family:${FONT_SERIF};font-size:21px;font-weight:bold;color:#f4eee2;margin:0 0 7px 0;">${cta.h}</h2>
          <p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:rgba(244,238,226,0.78);margin:0 0 18px 0;">${cta.p}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td align="center" style="border-radius:6px;background:#2563eb;">
              <a href="${ctaPrimaryHref}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${cta.primary.label}</a>
            </td>
          </tr></table>
          ${secondaryLink}
        </td></tr></table>
      </td></tr>

      <!-- footer -->
      <tr><td style="padding:0 32px 30px 32px;">
        <hr style="border:none;border-top:1px solid rgba(11,18,32,0.12);margin:0 0 16px 0;" />
        <p style="font-family:Arial,sans-serif;font-size:11.5px;line-height:1.6;color:#64748b;margin:0 0 8px 0;font-style:italic;">Indicative only, based on your answers — a full dispute review may surface evidence this quick test can&rsquo;t. Thresholds reflect Visa&rsquo;s published Dispute Monitoring Program; Shopify Payments operates under the card-network rules.</p>
        <p style="font-family:Arial,sans-serif;font-size:11.5px;line-height:1.6;color:#94a3b8;margin:0;">DisputeDesk &middot; chargeback evidence automation for Shopify &nbsp;&middot;&nbsp; <a href="${baseUrl}" style="color:#64748b;">disputedesk.app</a><br/>You got this because you took the Winnability Test. <a href="${unsubscribeUrl}" style="color:#64748b;">Unsubscribe</a>.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  // ---- plain-text fallback ----
  const reasonsText = w.reasons.map(([m, t]) => `${m === "ok" ? "✓" : "✕"} ${t}`).join("\n");
  const text = [
    `YOUR RESULT — ${band.label}`,
    "",
    w.headline,
    "",
    "How it scores against Visa Compelling Evidence 3.0:",
    reasonsText,
    "",
    `Your chargeback ratio: ${pctLabel} (${ratioText})`,
    `The danger line sits at ~0.9% (Visa's Dispute Monitoring Program). ${ratioDesc}`,
    "",
    `${cta.h}`,
    cta.p,
    `${cta.primary.label}: ${ctaPrimaryHref}`,
    cta.secondary ? `${cta.secondary.label}: ${ctaSecondaryHref}` : "",
    "",
    "Indicative only, based on your answers — a full dispute review may surface evidence this quick test can't.",
    "DisputeDesk · chargeback evidence automation for Shopify · " + baseUrl,
    `Unsubscribe: ${unsubscribeUrl}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const subject = `Your chargeback result: ${band.label}`;

  return { subject, html, text };
}
