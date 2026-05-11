/**
 * Monthly Chargeback Exposure digest.
 *
 * Composes and sends a once-a-month email summarizing the merchant's
 * chargeback exposure — the same shape of intelligence that lives on
 * `/app/insights/initial-analysis`, condensed for inbox consumption.
 *
 * The digest is intentionally tonally neutral:
 *   - Headline number is sourced (VAMP / ECM / own baseline), never
 *     a peer/cohort claim.
 *   - Severity uses the same palette as the in-app card: green for
 *     healthy, grey for info, amber for "consider", red ONLY for
 *     actual network-threshold breaches.
 *   - Footer makes opt-out + how-it-was-computed visible.
 *
 * Caller assembles the `DigestData` (typically a server-side cron or
 * a one-shot script) and passes it in. This function is rendering +
 * delivery only — no DB queries here.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { evaluateCheckpoints } from "@/lib/insights/checkpoints";
import type { Checkpoint } from "@/lib/insights/checkpoints.types";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface DigestPeriodMetrics {
  ordersTotal: number;
  acceptanceRatePct: number | null;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  threeDsAuthRatePct: number | null;
  threeDsAuthOrders: number;
  threeDsAuthEligibleOrders: number;
  signedForRatePct: number | null;
  signedForOrders: number;
  confirmedDeliveryRatePct: number | null;
  confirmedDeliveryOrders: number;
  medianFulfillmentHours: number | null;
}

export interface DigestData {
  shopDomain: string;
  /** Display name for the email greeting (e.g. "Sora Svende"). Falls
   *  back to the bare domain when null. */
  merchantName?: string | null;
  /** Recipient(s). Either a single address or a comma-separated list. */
  to: string;
  /** Month label, already formatted (e.g. "April 2026"). */
  periodLabel: string;
  /** 90-day chargeback rate, percent (e.g. 1.91). */
  chargebackRate90dPct: number | null;
  chargebackOrders90d: number;
  current30d: DigestPeriodMetrics;
  prior30d: DigestPeriodMetrics;
}

function pct(v: number | null, digits = 0): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

function hours(v: number | null): string {
  if (v == null) return "—";
  return v < 24 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`;
}

/** Delta unit pill — pp (percentage points) or h (hours). */
function delta(
  cur: number | null,
  prior: number | null,
  unit: "pp" | "h" = "pp",
  /** When true, an UP movement is bad (red); when false, an UP is
   *  good (green). Most rates are `inverse: false`; chargeback rate,
   *  fraud rate, high-risk rate, fulfillment hours are `inverse: true`. */
  inverse = false,
): { color: string; text: string } {
  if (cur == null || prior == null) {
    return { color: "#9CA3AF", text: "—" };
  }
  const d = cur - prior;
  const flat = unit === "h" ? 0.5 : 0.1;
  if (Math.abs(d) < flat) return { color: "#6D7175", text: "→ stable" };
  const up = d > 0;
  const bad = inverse ? up : !up;
  const color = bad ? "#D97706" : "#10B981";
  const arrow = up ? "↑" : "↓";
  const unitLabel = unit === "h" ? " h" : " pp";
  return {
    color,
    text: `${arrow} ${Math.abs(d).toFixed(1)}${unitLabel} vs prior`,
  };
}

/** Severity → palette. Same logic as the in-app `OperationalCheckpoints` row. */
function severityColor(s: Checkpoint["severity"]): {
  pip: string;
  bg: string;
  border: string;
} {
  switch (s) {
    case "breach":
      return { pip: "#DC2626", bg: "#FEF2F2", border: "#FECACA" };
    case "consider":
      return { pip: "#D97706", bg: "#FFFBEB", border: "#FDE68A" };
    case "healthy":
      return { pip: "#10B981", bg: "#ECFDF5", border: "#BBF7D0" };
    case "info":
    default:
      return { pip: "#6B7280", bg: "#F9FAFB", border: "#E5E7EB" };
  }
}

/** Hand-rolled interpolation: replaces {key} with values. Keeps the
 *  email script self-contained (no next-intl on the server-script
 *  side). Mirrors how next-intl formats the same keys in the embedded
 *  UI, so the email and the in-app card read the same wording. */
function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = values[k];
    return v == null ? "" : String(v);
  });
}

/** English copy for each checkpoint id+severity. Mirrors the
 *  `fraudIntel.checkpoint_*_*_title|body` keys in messages/en.json. */
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

function resolveCheckpointCopy(c: Checkpoint): { title: string; body: string } {
  // Title/body keys look like `fraudIntel.checkpoint_<id>_<severity>_title`
  // — strip the namespace prefix and the `_title`/`_body` suffix to get
  // the lookup key into CHECKPOINT_COPY.
  const key = c.titleKey
    .replace(/^fraudIntel\.checkpoint_/, "")
    .replace(/_title$/, "");
  const copy = CHECKPOINT_COPY[key];
  if (!copy) {
    return {
      title: c.id,
      body: "",
    };
  }
  return {
    title: interpolate(copy.title, c.values),
    body: interpolate(copy.body, c.values),
  };
}

interface RenderResult {
  subject: string;
  html: string;
  text: string;
}

export function renderMonthlyChargebackDigest(d: DigestData): RenderResult {
  const merchantDisplay =
    d.merchantName ?? d.shopDomain.replace(/\.myshopify\.com$/i, "");
  const dashboardUrl = getEmbeddedAppUrl(
    d.shopDomain,
    "insights/initial-analysis",
  );

  // Build the headline KPIs.
  const cb = d.chargebackRate90dPct;
  const cur = d.current30d;
  const prior = d.prior30d;

  // Operational checkpoints — top 3 only for inbox brevity.
  const checkpoints = evaluateCheckpoints(
    {
      chargebackRate90d: cb,
      chargebackOrders90d: d.chargebackOrders90d,
      fraudDisputeRatePct: cur.fraudDisputeRatePct,
      fulfilledHighRiskPct: cur.fulfilledHighRiskPct,
      threeDsAuthRatePct: cur.threeDsAuthRatePct,
      signedForRatePct: cur.signedForRatePct,
      shopifyProtectCoveragePct: cur.shopifyProtectCoveragePct,
      medianFulfillmentHoursCurrent: cur.medianFulfillmentHours,
      medianFulfillmentHoursPrior: prior.medianFulfillmentHours,
    },
    3,
  );

  // Severity tone for the headline number — drives the hero accent.
  const headlineSeverity: Checkpoint["severity"] =
    cb == null
      ? "info"
      : cb >= 1.5
        ? "breach"
        : cb >= 0.9
          ? "consider"
          : "healthy";
  const headlineColor = severityColor(headlineSeverity);

  const subject = `Your ${d.periodLabel} chargeback exposure · DisputeDesk`;

  // ── KPI tiles row (3-up) ────────────────────────────────────────
  const tileChargebackRate = `${pct(cb, 2)}`;
  const threeDsCur = cur.threeDsAuthRatePct;
  const signedCur = cur.signedForRatePct;
  const dChargeback = delta(
    cb,
    null, // 90d window has no prior — we use 30d for trends
    "pp",
    true,
  );
  const dThreeDs = delta(threeDsCur, prior.threeDsAuthRatePct, "pp", false);
  const dSigned = delta(signedCur, prior.signedForRatePct, "pp", false);

  function tile(label: string, value: string, deltaText: string, deltaColor: string): string {
    return `<td style="width:33%;padding:14px 12px;border:1px solid #E1E3E5;border-radius:10px;vertical-align:top;background:#FFFFFF">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6D7175;margin:0 0 4px">${label}</div>
      <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.1;letter-spacing:-0.01em;margin:0 0 6px;font-variant-numeric:tabular-nums">${value}</div>
      <div style="font-size:11px;font-weight:600;color:${deltaColor};font-variant-numeric:tabular-nums">${deltaText}</div>
    </td>`;
  }

  const tilesHtml = `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px">
    <tr>
      ${tile("90-day chargeback rate", tileChargebackRate, dChargeback.text, dChargeback.color)}
      ${tile("3-DS auth (30d)", pct(threeDsCur), dThreeDs.text, dThreeDs.color)}
      ${tile("Signed delivery (30d)", pct(signedCur), dSigned.text, dSigned.color)}
    </tr>
  </table>`;

  // ── Month-over-month trend table ──────────────────────────────
  const dHigh = delta(cur.highRiskPct, prior.highRiskPct, "pp", true);
  const dFulfilledHigh = delta(
    cur.fulfilledHighRiskPct,
    prior.fulfilledHighRiskPct,
    "pp",
    true,
  );
  const dFraud = delta(
    cur.fraudDisputeRatePct,
    prior.fraudDisputeRatePct,
    "pp",
    true,
  );
  const dProtect = delta(
    cur.shopifyProtectCoveragePct,
    prior.shopifyProtectCoveragePct,
    "pp",
    false,
  );
  const dMedian = delta(
    cur.medianFulfillmentHours,
    prior.medianFulfillmentHours,
    "h",
    true,
  );

  function trendRow(
    label: string,
    curVal: string,
    priorVal: string,
    deltaText: string,
    deltaColor: string,
  ): string {
    return `<tr>
      <td style="padding:8px 0;font-size:13px;color:#6D7175;border-bottom:1px solid #F4F6F8">${label}</td>
      <td style="padding:8px 0;font-size:14px;color:#202223;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #F4F6F8">${curVal}</td>
      <td style="padding:8px 0;font-size:13px;color:#6D7175;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #F4F6F8">${priorVal}</td>
      <td style="padding:8px 0;font-size:11px;color:${deltaColor};text-align:right;font-weight:600;font-variant-numeric:tabular-nums;border-bottom:1px solid #F4F6F8">${deltaText}</td>
    </tr>`;
  }

  const trendsHtml = `<table style="width:100%;border-collapse:collapse;margin-top:8px">
    <thead>
      <tr>
        <th style="text-align:left;padding:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6D7175;border-bottom:1px solid #E1E3E5">Metric</th>
        <th style="text-align:right;padding:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6D7175;border-bottom:1px solid #E1E3E5">Current 30d</th>
        <th style="text-align:right;padding:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6D7175;border-bottom:1px solid #E1E3E5">Prior 30d</th>
        <th style="text-align:right;padding:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6D7175;border-bottom:1px solid #E1E3E5">Δ</th>
      </tr>
    </thead>
    <tbody>
      ${trendRow("HIGH-risk orders", pct(cur.highRiskPct), pct(prior.highRiskPct), dHigh.text, dHigh.color)}
      ${trendRow("HIGH-risk fulfilled", pct(cur.fulfilledHighRiskPct), pct(prior.fulfilledHighRiskPct), dFulfilledHigh.text, dFulfilledHigh.color)}
      ${trendRow("Fraud dispute rate", pct(cur.fraudDisputeRatePct, 1), pct(prior.fraudDisputeRatePct, 1), dFraud.text, dFraud.color)}
      ${trendRow("Shopify Protect coverage", pct(cur.shopifyProtectCoveragePct), pct(prior.shopifyProtectCoveragePct), dProtect.text, dProtect.color)}
      ${trendRow("Median fulfill time", hours(cur.medianFulfillmentHours), hours(prior.medianFulfillmentHours), dMedian.text, dMedian.color)}
    </tbody>
  </table>`;

  // ── Operational Checkpoints (top 3) ───────────────────────────
  const checkpointsHtml = checkpoints
    .map((c) => {
      const copy = resolveCheckpointCopy(c);
      const tone = severityColor(c.severity);
      const sourceHtml = c.source
        ? `<div style="margin-top:6px;font-size:11px;color:#6D7175">Source: <a href="${c.source.url}" style="color:#6D7175;text-decoration:underline">${c.source.label}</a></div>`
        : "";
      return `<div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${tone.pip};margin-top:6px;flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.4">${copy.title}</div>
            <div style="font-size:13px;color:#374151;line-height:1.5;margin-top:4px">${copy.body}</div>
            ${sourceHtml}
          </div>
        </div>
      </div>`;
    })
    .join("");

  // ── HTML body ─────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F6F6F7;color:#202223">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px">

    <!-- Brand header -->
    <table role="presentation" style="margin-bottom:24px;border-collapse:collapse">
      <tr>
        <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);text-align:center;vertical-align:middle">
          <span style="color:#fff;font-size:16px;font-weight:700;line-height:32px">D</span>
        </td>
        <td style="padding-left:10px;vertical-align:middle">
          <span style="font-size:15px;font-weight:600;color:#111827">DisputeDesk</span>
          <span style="font-size:13px;color:#6D7175;margin-left:8px">Chargeback Exposure · ${d.periodLabel}</span>
        </td>
      </tr>
    </table>

    <!-- Hero card -->
    <div style="background:#FFFFFF;border:1px solid #E1E3E5;border-radius:12px;padding:28px 32px;margin-bottom:16px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;bottom:0;width:4px;background:${headlineColor.pip}"></div>
      <div style="padding-left:8px">
        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6D7175;margin:0 0 8px">${merchantDisplay}</div>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.25">Your ${d.periodLabel} chargeback exposure</h1>
        <p style="font-size:14px;color:#6D7175;margin:0 0 4px;line-height:1.55">
          Across <strong style="color:#202223">${cur.ordersTotal.toLocaleString()}</strong> orders in the last 30 days. The headline below is your 90-day chargeback rate, compared against the published thresholds at Visa and Mastercard.
        </p>
      </div>
    </div>

    <!-- KPI tiles -->
    <div style="margin-bottom:16px">
      ${tilesHtml}
    </div>

    <!-- Operational checkpoints -->
    <div style="background:#FFFFFF;border:1px solid #E1E3E5;border-radius:12px;padding:24px;margin-bottom:16px">
      <h2 style="font-size:15px;font-weight:600;color:#111827;margin:0 0 4px">Operational checkpoints</h2>
      <p style="font-size:12px;color:#6D7175;margin:0 0 16px;line-height:1.5">
        Sourced from published card-network rules and your own 30-day baseline. The full list is in DisputeDesk; here are the top 3.
      </p>
      ${checkpointsHtml}
    </div>

    <!-- MoM trends -->
    <div style="background:#FFFFFF;border:1px solid #E1E3E5;border-radius:12px;padding:24px;margin-bottom:16px">
      <h2 style="font-size:15px;font-weight:600;color:#111827;margin:0 0 4px">Month-over-month trends</h2>
      <p style="font-size:12px;color:#6D7175;margin:0 0 12px;line-height:1.5">
        Δ shows the change from the prior 30-day window. Amber means "consider"; green means improving.
      </p>
      ${trendsHtml}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin:24px 0 32px">
      <a href="${dashboardUrl}" style="display:inline-block;padding:13px 28px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
        Open Chargeback Exposure →
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:16px 8px;border-top:1px solid #E1E3E5">
      <p style="font-size:11px;color:#6D7175;margin:0 0 6px;line-height:1.5">
        This digest pulls from your historical Shopify orders and disputes. Thresholds verified against published Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11.
      </p>
      <p style="font-size:11px;color:#9CA3AF;margin:0;line-height:1.5">
        You received this because monthly digests are enabled in your DisputeDesk notification settings.
      </p>
    </div>

  </div>
</body>
</html>`;

  // ── Plain text fallback ───────────────────────────────────────
  const text = `${merchantDisplay} — Your ${d.periodLabel} chargeback exposure

Across ${cur.ordersTotal.toLocaleString()} orders in the last 30 days.

Headline:
  90-day chargeback rate: ${pct(cb, 2)}
  3-DS auth (30d): ${pct(threeDsCur)} (${dThreeDs.text})
  Signed delivery (30d): ${pct(signedCur)} (${dSigned.text})

Operational checkpoints (top 3):
${checkpoints
  .map((c, i) => {
    const copy = resolveCheckpointCopy(c);
    const src = c.source ? `\n     Source: ${c.source.url}` : "";
    return `  ${i + 1}. [${c.severity.toUpperCase()}] ${copy.title}\n     ${copy.body}${src}`;
  })
  .join("\n")}

Month-over-month trends (current → prior · Δ):
  HIGH-risk orders:       ${pct(cur.highRiskPct)} → ${pct(prior.highRiskPct)} · ${dHigh.text}
  HIGH-risk fulfilled:    ${pct(cur.fulfilledHighRiskPct)} → ${pct(prior.fulfilledHighRiskPct)} · ${dFulfilledHigh.text}
  Fraud dispute rate:     ${pct(cur.fraudDisputeRatePct, 1)} → ${pct(prior.fraudDisputeRatePct, 1)} · ${dFraud.text}
  Protect coverage:       ${pct(cur.shopifyProtectCoveragePct)} → ${pct(prior.shopifyProtectCoveragePct)} · ${dProtect.text}
  Median fulfill time:    ${hours(cur.medianFulfillmentHours)} → ${hours(prior.medianFulfillmentHours)} · ${dMedian.text}

Open Chargeback Exposure: ${dashboardUrl}

---
This digest pulls from your historical Shopify orders and disputes.
Thresholds verified against published Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11.
`;

  return { subject, html, text };
}

/**
 * Render and deliver the monthly chargeback digest. Safe to call
 * unguarded — returns silently when `RESEND_API_KEY` is unset.
 */
export async function sendMonthlyChargebackDigest(
  d: DigestData,
): Promise<{ delivered: boolean; subject: string }> {
  const rendered = renderMonthlyChargebackDigest(d);
  if (!RESEND_API_KEY) {
    return { delivered: false, subject: rendered.subject };
  }
  try {
    const resend = new Resend(RESEND_API_KEY);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: d.to.includes(",") ? d.to.split(",").map((e) => e.trim()) : d.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    // Resend SDK returns `{data, error}`; the send is not throw-on-
    // failure, so we have to inspect `result.error` ourselves.
    if (result.error) {
      console.error(
        "[email] Monthly digest send failed:",
        result.error.message ?? JSON.stringify(result.error),
      );
      return { delivered: false, subject: rendered.subject };
    }
    return { delivered: true, subject: rendered.subject };
  } catch (err) {
    console.error(
      "[email] Monthly digest send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, subject: rendered.subject };
  }
}
