/**
 * Shared rendering primitives for the chargeback exposure digest
 * family (onboarding "first analysis" email + recurring monthly
 * digest).
 *
 * Design goal: a single white plate per email. The earlier layout
 * stacked multiple bordered cards on a grey background — visually
 * loud and "dashboard-like" in an inbox. This module produces one
 * white container with hairline-divided sections, generous padding,
 * and severity used sparingly as accent.
 *
 * No side effects. Pure functions only.
 */

import type { Checkpoint } from "@/lib/insights/checkpoints.types";

// ─── Formatters ───────────────────────────────────────────────────

export function pct(v: number | null, digits = 0): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

export function hours(v: number | null): string {
  if (v == null) return "—";
  return v < 24 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`;
}

/** Money formatting using Intl. Falls back to a bare `${currency} {amt}`
 *  string when the locale data can't resolve. Returns "—" for null. */
export function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

/** "in 3 days" / "today" / "overdue 2 days" — short, calm, no
 *  alarm. Returns null when the input is unparseable. */
export function relativeDueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

// ─── Delta computation ────────────────────────────────────────────

export interface DeltaResult {
  color: string;
  text: string;
}

export function delta(
  cur: number | null,
  prior: number | null,
  unit: "pp" | "h" = "pp",
  /** When true, an UP movement is unfavorable (amber); when false,
   *  an UP is favorable (green). Chargeback rate / fraud rate /
   *  HIGH-risk rate / fulfillment hours are `inverse: true`. */
  inverse = false,
): DeltaResult {
  if (cur == null || prior == null) return { color: "#9CA3AF", text: "—" };
  const d = cur - prior;
  const flat = unit === "h" ? 0.5 : 0.1;
  if (Math.abs(d) < flat) return { color: "#6D7175", text: "→ stable" };
  const up = d > 0;
  const unfavorable = inverse ? up : !up;
  const color = unfavorable ? "#D97706" : "#10B981";
  const arrow = up ? "↑" : "↓";
  const unitLabel = unit === "h" ? " h" : " pp";
  return { color, text: `${arrow} ${Math.abs(d).toFixed(1)}${unitLabel}` };
}

// ─── Severity palette ─────────────────────────────────────────────

export function severityColor(s: Checkpoint["severity"]): {
  pip: string;
  bg: string;
  border: string;
  text: string;
} {
  switch (s) {
    case "breach":
      return {
        pip: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
        text: "#991B1B",
      };
    case "consider":
      return {
        pip: "#D97706",
        bg: "#FFFBEB",
        border: "#FDE68A",
        text: "#92400E",
      };
    case "healthy":
      return {
        pip: "#10B981",
        bg: "#ECFDF5",
        border: "#BBF7D0",
        text: "#065F46",
      };
    case "info":
    default:
      return {
        pip: "#6B7280",
        bg: "#F9FAFB",
        border: "#E5E7EB",
        text: "#374151",
      };
  }
}

// ─── Checkpoint copy (mirrors fraudIntel.checkpoint_* i18n keys) ─

const CHECKPOINT_COPY: Record<string, { title: string; body: string }> = {
  chargeback_rate_vs_vamp_healthy: {
    title: "Below Visa's monitoring band.",
    body:
      "Your 90-day chargeback rate is {current}. Visa's VAMP Excessive threshold is {vampExcessive}; the operationally watched 'approaching' band begins around {vampApproaching}.",
  },
  chargeback_rate_vs_vamp_consider: {
    title: "Approaching Visa's VAMP threshold.",
    body:
      "Your 90-day chargeback rate is {current} — inside the {vampApproaching}–{vampExcessive} 'approaching' band. Acquirers face $8 per disputed transaction once Excessive ({vampExcessive}) is reached.",
  },
  chargeback_rate_vs_vamp_breach: {
    title: "Above Visa's VAMP Excessive threshold.",
    body:
      "Your 90-day chargeback rate is {current}, at or above Visa's VAMP Excessive threshold of {vampExcessive}. Acquirers face $8 per disputed transaction at this level.",
  },
  chargeback_rate_vs_ecm_healthy: {
    title: "Below Mastercard's ECM threshold.",
    body:
      "Your 90-day chargeback rate is {current}, well below Mastercard's ECM ratio of {ecmRatio} (which also requires {ecmCount}+ chargebacks per month).",
  },
  chargeback_rate_vs_ecm_consider: {
    title: "Approaching Mastercard's ECM threshold.",
    body:
      "Your 90-day chargeback rate is {current}. Mastercard's ECM activates at {ecmRatio} ratio with {ecmCount}+ chargebacks per month (you average ~{monthlyEstimate}).",
  },
  chargeback_rate_vs_ecm_breach: {
    title: "Above Mastercard's ECM thresholds.",
    body:
      "Your 90-day chargeback rate is {current} and you average ~{monthlyEstimate} chargebacks per month. Both ECM criteria ({ecmRatio} ratio, {ecmCount}+/month) are now met.",
  },
  high_risk_fulfilled_consider: {
    title: "{current} of HIGH-risk orders were fulfilled.",
    body:
      "Each fulfilled HIGH-risk order is absorbed exposure — Shopify's risk model flagged but did not block. Consider an auto-hold or manual-review rule for HIGH-risk orders above a value threshold.",
  },
  signature_capture_low_consider: {
    title: "Signature captured on {current} of confirmed deliveries.",
    body:
      "Carrier-attested signature confirmation is the strongest delivery evidence in fraud-coded chargebacks. Requiring signature on higher-value shipments meaningfully strengthens dispute defense.",
  },
  threeds_auth_healthy: {
    title: "3-DS authentication on {current} of eligible card orders.",
    body:
      "Authenticated payments shift fraud-chargeback liability to the issuer under Visa's liability-shift rules. Coverage at this level is operationally strong.",
  },
  threeds_auth_info: {
    title: "3-DS authentication on {current} of eligible card orders.",
    body:
      "Visa's liability shift moves fraud-chargeback responsibility to the issuer for authenticated payments. Coverage above 25% is the operationally strong band.",
  },
  threeds_auth_consider: {
    title: "3-DS authentication on {current} of eligible card orders.",
    body:
      "Authenticated payments shift fraud-chargeback liability to the issuer. Coverage this low leaves most card-not-present fraud disputes recoverable only through evidence packs.",
  },
  protect_coverage_low_info: {
    title: "Shopify Protect coverage at {current}.",
    body:
      "Underwritten orders do not reach you as chargebacks. Lower coverage means a larger share of disputes are yours to defend with evidence packs.",
  },
  fulfillment_baseline_degraded_consider: {
    title: "Median fulfillment slowed to {current}.",
    body:
      "Up {delta} versus prior 30 days ({prior}). Faster fulfillment generally strengthens customer-service signals — and is a routinely cited dispute factor.",
  },
  fulfillment_baseline_improved_healthy: {
    title: "Median fulfillment improved to {current}.",
    body:
      "Down {delta} versus prior 30 days ({prior}). Faster fulfillment strengthens customer-service signals in non-fraud disputes.",
  },
};

function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = values[k];
    return v == null ? "" : String(v);
  });
}

export function resolveCheckpointCopy(c: Checkpoint): {
  title: string;
  body: string;
} {
  const key = c.titleKey
    .replace(/^fraudIntel\.checkpoint_/, "")
    .replace(/_title$/, "");
  const copy = CHECKPOINT_COPY[key];
  if (!copy) return { title: c.id, body: "" };
  return {
    title: interpolate(copy.title, c.values),
    body: interpolate(copy.body, c.values),
  };
}

// ─── HTML fragment builders ──────────────────────────────────────

/** Brand header — small, lives inside the white plate at the top. */
export function brandHeader(eyebrow: string): string {
  return `<table role="presentation" style="margin:0 0 24px;border-collapse:collapse">
    <tr>
      <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);text-align:center;vertical-align:middle">
        <span style="color:#fff;font-size:16px;font-weight:700;line-height:32px">D</span>
      </td>
      <td style="padding-left:10px;vertical-align:middle">
        <span style="font-size:14px;font-weight:600;color:#111827">DisputeDesk</span>
        <span style="font-size:13px;color:#9CA3AF;margin-left:8px">·</span>
        <span style="font-size:13px;color:#6B7280;margin-left:8px">${eyebrow}</span>
      </td>
    </tr>
  </table>`;
}

/** Hairline divider — clean visual section break inside the plate. */
export function hairline(): string {
  return `<div style="height:1px;background:#E5E7EB;margin:28px 0"></div>`;
}

/** Small section-header label (uppercase, muted) with an optional
 *  colored dot prefix. The dot adds gentle visual color without
 *  breaking the white-plate feel — pick a hue that matches the
 *  section's theme (blue for activity, green for healthy, amber for
 *  attention). */
export function sectionLabel(label: string, accentColor?: string): string {
  const dot = accentColor
    ? `<span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${accentColor};margin-right:8px;vertical-align:middle"></span>`
    : "";
  return `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;margin:0 0 14px">${dot}${label}</div>`;
}

/** Tinted callout block — used for the "no disputes this month"
 *  positive line, summary stats, and other accent moments. Picks a
 *  full palette from `tone`. */
export function tintedCallout({
  tone,
  title,
  body,
}: {
  tone: "blue" | "green" | "amber" | "neutral";
  title?: string;
  body: string;
}): string {
  const palettes = {
    blue: { bg: "#EFF6FF", border: "#BFDBFE", titleC: "#1E40AF", bodyC: "#1E3A8A" },
    green: { bg: "#ECFDF5", border: "#A7F3D0", titleC: "#065F46", bodyC: "#064E3B" },
    amber: { bg: "#FFFBEB", border: "#FDE68A", titleC: "#92400E", bodyC: "#78350F" },
    neutral: { bg: "#F9FAFB", border: "#E5E7EB", titleC: "#374151", bodyC: "#4B5563" },
  };
  const p = palettes[tone];
  const titleHtml = title
    ? `<div style="font-size:13px;font-weight:600;color:${p.titleC};margin:0 0 4px">${title}</div>`
    : "";
  return `<div style="background:${p.bg};border:1px solid ${p.border};border-radius:10px;padding:14px 18px;margin:0 0 20px">
    ${titleHtml}
    <div style="font-size:13px;color:${p.bodyC};line-height:1.6">${body}</div>
  </div>`;
}

/** Inline status pill — used for outcome chips (won/lost/accepted). */
export function statusPill(
  label: string,
  tone: "win" | "loss" | "neutral" | "info",
): string {
  const palettes = {
    win: { bg: "#ECFDF5", text: "#065F46" },
    loss: { bg: "#FEF2F2", text: "#991B1B" },
    neutral: { bg: "#F3F4F6", text: "#374151" },
    info: { bg: "#EFF6FF", text: "#1E40AF" },
  };
  const p = palettes[tone];
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;background:${p.bg};color:${p.text};margin-right:6px">${label}</span>`;
}

/** Primary CTA button — wide, centered. */
export function ctaButton(label: string, href: string): string {
  return `<div style="text-align:center;margin:8px 0 0">
    <a href="${href}" style="display:inline-block;padding:13px 32px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em">
      ${label}
    </a>
  </div>`;
}

/** Plate wrapper — single white container, generous padding, subtle
 *  shadow. Top has a slim brand-color accent stripe (gentle hint of
 *  color without breaking the white-plate feel). Footer text lives
 *  outside the plate, muted. */
export function plateLayout({
  innerHtml,
  footerText,
  previewText,
}: {
  innerHtml: string;
  footerText: string;
  previewText: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DisputeDesk</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#F3F4F6;color:#111827;-webkit-font-smoothing:antialiased">
  <!-- Preview text (hidden inbox preview) -->
  <div style="display:none;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;opacity:0">${previewText}</div>

  <div style="max-width:640px;margin:0 auto;padding:32px 16px">
    <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;box-shadow:0 1px 3px rgba(17,24,39,0.05);overflow:hidden">
      <!-- top accent stripe -->
      <div style="height:4px;background:linear-gradient(90deg,#1D4ED8 0%,#3B82F6 50%,#60A5FA 100%)"></div>
      <div style="padding:36px 40px">
        ${innerHtml}
      </div>
    </div>
    <p style="font-size:11px;color:#9CA3AF;text-align:center;margin:20px 0 0;line-height:1.6">
      ${footerText}
    </p>
  </div>
</body>
</html>`;
}

// ─── Checkpoint row (used in both email types) ───────────────────

/** Renders a single checkpoint as an inline row — pip + title + body.
 *  Used inside the "where you stand" section. Inline severity pip,
 *  no bordered background card. Cleaner than the previous design's
 *  full-row tinted boxes. */
export function checkpointRow(c: Checkpoint): string {
  const tone = severityColor(c.severity);
  const copy = resolveCheckpointCopy(c);
  const sourceHtml = c.source
    ? `<div style="margin-top:6px;font-size:11px;color:#9CA3AF">Source: <a href="${c.source.url}" style="color:#6B7280;text-decoration:underline">${c.source.label}</a></div>`
    : "";
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px">
    <tr>
      <td style="width:10px;padding-top:7px;vertical-align:top">
        <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${tone.pip}"></span>
      </td>
      <td style="padding-left:12px;vertical-align:top">
        <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.45">${copy.title}</div>
        <div style="font-size:13px;color:#4B5563;line-height:1.6;margin-top:4px">${copy.body}</div>
        ${sourceHtml}
      </td>
    </tr>
  </table>`;
}

// ─── KPI row (label + value + delta) ─────────────────────────────

export function kpiRow({
  label,
  value,
  trailingNote,
  deltaText,
  deltaColor,
}: {
  label: string;
  value: string;
  trailingNote?: string;
  deltaText?: string;
  deltaColor?: string;
}): string {
  const deltaCell =
    deltaText && deltaColor
      ? `<td style="padding:10px 0;font-size:12px;color:${deltaColor};text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;width:80px">${deltaText}</td>`
      : "";
  const noteRow = trailingNote
    ? `<tr><td colspan="3" style="padding:0 0 12px;font-size:12px;color:#9CA3AF;line-height:1.5">${trailingNote}</td></tr>`
    : "";
  return `<tr>
      <td style="padding:10px 0;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F6">${label}</td>
      <td style="padding:10px 0;font-size:15px;color:#111827;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #F3F4F6">${value}</td>
      ${deltaCell ? deltaCell.replace("padding:10px 0", "padding:10px 0;border-bottom:1px solid #F3F4F6") : ""}
    </tr>
    ${noteRow}`;
}

// ─── Hero number (large headline figure) ─────────────────────────

export function heroNumber({
  number,
  label,
  accentColor,
}: {
  number: string;
  label: string;
  accentColor?: string;
}): string {
  const c = accentColor ?? "#111827";
  return `<div style="margin:0 0 8px">
    <div style="font-size:42px;font-weight:700;color:${c};line-height:1.05;letter-spacing:-0.02em;font-variant-numeric:tabular-nums">${number}</div>
    <div style="font-size:13px;font-weight:500;color:#6B7280;margin-top:6px;text-transform:uppercase;letter-spacing:0.06em">${label}</div>
  </div>`;
}
