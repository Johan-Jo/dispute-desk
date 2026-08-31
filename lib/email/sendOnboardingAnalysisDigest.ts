/**
 * Onboarding analysis digest — the first email DisputeDesk sends a
 * merchant after their historical Shopify order import completes.
 *
 * Differs from the recurring monthly digest in tone + framing:
 *   - Hero is the total volume analyzed (anchors trust)
 *   - "Where you stand" surfaces 3 sourced checkpoints — first time
 *     the merchant sees them
 *   - Last-30d snapshot is one-shot (no prior-window delta — none
 *     exists yet)
 *   - "What to expect" footer explains the monthly cadence
 *
 * Triggered by the historical-backfill job when it transitions to
 * `historical_import_status = 'complete'`. Fire-and-forget. Idempotent
 * via a `onboarding_digest_sent_at` claim column on `shops`.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { evaluateCheckpoints } from "@/lib/insights/checkpoints";
import type { Checkpoint } from "@/lib/insights/checkpoints.types";
import {
  brandHeader,
  checkpointRow,
  ctaButton,
  hairline,
  heroNumber,
  hours,
  kpiRow,
  pct,
  plateLayout,
  resolveCheckpointCopy,
  sectionLabel,
} from "@/lib/email/digestShared";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
const REPLY_TO = DEFAULT_REPLY_TO;

/** A subset of metrics — onboarding doesn't need MoM deltas. */
export interface OnboardingSnapshotMetrics {
  ordersTotal: number;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  threeDsAuthRatePct: number | null;
  signedForRatePct: number | null;
  medianFulfillmentHours: number | null;
}

export interface OnboardingDigestData {
  shopDomain: string;
  merchantName?: string | null;
  to: string;
  /** Total historical orders analyzed in the backfill. */
  ordersAnalyzedTotal: number;
  /** 90-day chargeback rate, percent. */
  chargebackRate90dPct: number | null;
  /** 90-day CHARGEBACK count (not orders). Feeds the ECM rule. */
  chargebackCount90d: number;
  /** Payment-rail context — see sendMonthlyChargebackDigest. This is the
   *  FIRST email a merchant receives, so promising them a Visa/Mastercard
   *  standing they are not measured by sets the wrong frame from day one. */
  rail?: {
    cardRatePct: number | null;
    cardDisputes: number;
    cardDisputeShare: number | null;
    cardFramingApplies: boolean;
  };
  /** Last 30d snapshot — used to populate the operational checkpoints
   *  and the at-a-glance table. */
  last30d: OnboardingSnapshotMetrics;
}

interface RenderResult {
  subject: string;
  html: string;
  text: string;
}

export function renderOnboardingAnalysisDigest(
  d: OnboardingDigestData,
): RenderResult {
  const merchantDisplay =
    d.merchantName ?? d.shopDomain.replace(/\.myshopify\.com$/i, "");
  const dashboardUrl = getEmbeddedAppUrl(
    d.shopDomain,
    "insights/initial-analysis",
  );

  const cb = d.chargebackRate90dPct;
  const m = d.last30d;

  // Undefined means the caller predates rail awareness — keep the old
  // behaviour rather than downgrading a real card breach.
  const cardFraming = d.rail?.cardFramingApplies !== false;

  // Operational checkpoints — top 3. Onboarding doesn't have a prior
  // window to compare fulfillment hours against, so we pass `null`
  // for the prior — the fulfillment-baseline rule self-suppresses.
  const checkpoints = evaluateCheckpoints(
    {
      chargebackRate90d: cb,
      chargebackCount90d: d.chargebackCount90d,
      cardChargebackRate90d: d.rail?.cardRatePct,
      cardChargebackCount90d: d.rail?.cardDisputes,
      cardDisputeShare: d.rail?.cardDisputeShare,
      cardFramingApplies: d.rail?.cardFramingApplies,
      fraudDisputeRatePct: m.fraudDisputeRatePct,
      fulfilledHighRiskPct: m.fulfilledHighRiskPct,
      threeDsAuthRatePct: m.threeDsAuthRatePct,
      signedForRatePct: m.signedForRatePct,
      shopifyProtectCoveragePct: m.shopifyProtectCoveragePct,
      medianFulfillmentHoursCurrent: m.medianFulfillmentHours,
      medianFulfillmentHoursPrior: null,
    },
    3,
  );

  // Pick a hero accent based on the most-severe checkpoint that fires.
  // (Not the chargeback rate alone — for a brand-new merchant the
  // checkpoints carry the actionable signal.)
  const severityRank: Record<Checkpoint["severity"], number> = {
    breach: 0,
    consider: 1,
    info: 2,
    healthy: 3,
  };
  const topSeverity =
    checkpoints[0]?.severity ??
    (cb == null
      ? "info"
      : cb >= 1.5
        ? "breach"
        : cb >= 0.9
          ? "consider"
          : "healthy");
  const accentColor =
    severityRank[topSeverity] <= 1
      ? topSeverity === "breach"
        ? "#DC2626"
        : "#D97706"
      : "#1D4ED8";

  const subject = `Your DisputeDesk analysis is ready · ${d.ordersAnalyzedTotal.toLocaleString()} orders analyzed`;
  const previewText = `${d.ordersAnalyzedTotal.toLocaleString()} historical orders analyzed · ${cardFraming ? "here's where you stand on the chargeback rules at Visa and Mastercard" : "here's what your dispute activity looks like"}`;

  // ── Last-30d snapshot table (no deltas — this is first analysis) ─
  const snapshotTable = `<table style="width:100%;border-collapse:collapse">
    ${kpiRow({ label: "Orders (last 30d)", value: m.ordersTotal.toLocaleString() })}
    ${kpiRow({ label: "HIGH-risk orders", value: pct(m.highRiskPct) })}
    ${kpiRow({ label: "HIGH-risk fulfilled", value: pct(m.fulfilledHighRiskPct) })}
    ${kpiRow({ label: "3-DS authentication", value: pct(m.threeDsAuthRatePct) })}
    ${kpiRow({ label: "Shopify Protect coverage", value: pct(m.shopifyProtectCoveragePct) })}
    ${kpiRow({ label: "Signed delivery", value: pct(m.signedForRatePct) })}
    ${kpiRow({ label: "Median fulfill time", value: hours(m.medianFulfillmentHours) })}
  </table>`;

  const inner = `
    ${brandHeader("Welcome · First analysis complete")}

    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;margin:0 0 8px">${merchantDisplay}</div>
    <h1 style="font-size:26px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.2;letter-spacing:-0.01em">Your DisputeDesk analysis is ready</h1>
    <p style="font-size:14px;color:#6B7280;margin:0 0 28px;line-height:1.6">
      We finished analyzing your historical Shopify orders. Below is a snapshot of where your store sits today on the operational signals that drive disputes${cardFraming ? " — and where you stand on the published rules at Visa and Mastercard" : ". Most of your disputes are settled by the payment provider that handled them rather than by a card network, so the Visa and Mastercard programmes do not measure them"}.
    </p>

    ${heroNumber({
      number: d.ordersAnalyzedTotal.toLocaleString(),
      label: "Historical orders analyzed",
      accentColor,
    })}

    ${hairline()}

    ${sectionLabel("Where you stand")}
    ${checkpoints.map(checkpointRow).join("")}

    ${hairline()}

    ${sectionLabel("Last 30 days at a glance")}
    ${snapshotTable}

    ${hairline()}

    ${sectionLabel("What's next")}
    <p style="font-size:14px;color:#374151;margin:0 0 12px;line-height:1.65">
      The Chargeback Exposure page in DisputeDesk has the full picture: monthly trends, the risk-to-dispute correlation chart, your chargeback health gauge, and the complete classification breakdown.
    </p>
    <p style="font-size:14px;color:#374151;margin:0 0 24px;line-height:1.65">
      We'll send you a similar digest at the start of every month so you can see what changed. You can opt out anytime from your notification settings.
    </p>

    ${ctaButton("Open Chargeback Exposure →", dashboardUrl)}
  `;

  const html = plateLayout({
    innerHtml: inner,
    previewText,
    footerText:
      cardFraming
        ? "Pulled from your historical Shopify orders and disputes. Thresholds verified against published Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11. You received this because the historical analysis on your store just completed."
        : "Pulled from your historical Shopify orders and disputes. Card-network thresholds are shown for reference only — most of your disputes are not settled on a card network. You received this because the historical analysis on your store just completed.",
  });

  // ── Plain text fallback ───────────────────────────────────────
  const text = `${merchantDisplay} — Your DisputeDesk analysis is ready

We finished analyzing your historical Shopify orders.

${d.ordersAnalyzedTotal.toLocaleString()} historical orders analyzed

Where you stand:
${checkpoints
  .map((c, i) => {
    const copy = resolveCheckpointCopy(c);
    const src = c.source ? `\n   Source: ${c.source.url}` : "";
    return `${i + 1}. [${c.severity.toUpperCase()}] ${copy.title}\n   ${copy.body}${src}`;
  })
  .join("\n\n")}

Last 30 days at a glance:
  Orders                   ${m.ordersTotal.toLocaleString()}
  HIGH-risk orders         ${pct(m.highRiskPct)}
  HIGH-risk fulfilled      ${pct(m.fulfilledHighRiskPct)}
  3-DS authentication      ${pct(m.threeDsAuthRatePct)}
  Shopify Protect coverage ${pct(m.shopifyProtectCoveragePct)}
  Signed delivery          ${pct(m.signedForRatePct)}
  Median fulfill time      ${hours(m.medianFulfillmentHours)}

What's next:
The Chargeback Exposure page has the full picture — monthly trends, risk-to-dispute correlation, chargeback health gauge, classification breakdown. We'll send a similar digest at the start of every month.

Open Chargeback Exposure: ${dashboardUrl}

---
Pulled from your historical Shopify orders and disputes. ${cardFraming ? "Thresholds verified against Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11." : "Card-network thresholds are shown for reference only - most of your disputes are not settled on a card network."}
`;

  return { subject, html, text };
}

export async function sendOnboardingAnalysisDigest(
  d: OnboardingDigestData,
): Promise<{ delivered: boolean; subject: string }> {
  const rendered = renderOnboardingAnalysisDigest(d);
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
    if (result.error) {
      console.error(
        "[email] Onboarding digest send failed:",
        result.error.message ?? JSON.stringify(result.error),
      );
      return { delivered: false, subject: rendered.subject };
    }
    return { delivered: true, subject: rendered.subject };
  } catch (err) {
    console.error(
      "[email] Onboarding digest send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, subject: rendered.subject };
  }
}
