/**
 * Monthly Chargeback Exposure digest.
 *
 * Composes and sends a once-a-month email summarizing the merchant's
 * chargeback exposure — the same shape of intelligence that lives on
 * `/app/insights/initial-analysis`, condensed for inbox consumption.
 *
 * Design: single white plate with hairline-divided sections. Layout
 * primitives live in `lib/email/digestShared.ts` and are reused by
 * `sendOnboardingAnalysisDigest`.
 *
 * Tonally neutral: headline number is sourced (VAMP / ECM / own
 * baseline), never a peer/cohort claim. Severity uses the same
 * palette as the in-app card — red ONLY for actual network breaches.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { canonicalReasonCode } from "@/lib/rules/disputeReasons";
import { evaluateCheckpoints } from "@/lib/insights/checkpoints";
import type { Checkpoint } from "@/lib/insights/checkpoints.types";
import type { DisputeActivity } from "@/lib/email/digestDisputeActivity";
import {
  brandHeader,
  checkpointRow,
  ctaButton,
  delta,
  hairline,
  heroNumber,
  hours,
  kpiRow,
  money,
  pct,
  plateLayout,
  relativeDueLabel,
  resolveCheckpointCopy,
  sectionLabel,
  statusPill,
  tintedCallout,
} from "@/lib/email/digestShared";

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
  /** Display name for the email greeting (e.g. "Sora Svende"). */
  merchantName?: string | null;
  /** Recipient. Either a single address or a comma-separated list. */
  to: string;
  /** Month label, already formatted (e.g. "May 2026"). */
  periodLabel: string;
  /** 90-day chargeback rate, percent (e.g. 1.91). */
  chargebackRate90dPct: number | null;
  chargebackOrders90d: number;
  current30d: DigestPeriodMetrics;
  prior30d: DigestPeriodMetrics;
  /** Real dispute activity for the period — opened, closed, open
   *  queue, win-rate trend. Drives a dedicated section between the
   *  checkpoints and the MoM table. When there's no activity, the
   *  section collapses to a positive one-liner instead of showing
   *  zero rows. */
  disputeActivity: DisputeActivity;
}

interface RenderResult {
  subject: string;
  html: string;
  text: string;
}

// ─── Reason label normalizer ──────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  FRAUDULENT: "Fraudulent",
  PRODUCT_NOT_RECEIVED: "Not received",
  PRODUCT_UNACCEPTABLE: "Not as described",
  SUBSCRIPTION_CANCELLED: "Subscription",
  DUPLICATE: "Duplicate",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  GENERAL: "Other",
};
function reasonLabel(r: string): string {
  return (
    REASON_LABELS[canonicalReasonCode(r) ?? r] ??
    r.replace(/_/g, " ").toLowerCase()
  );
}

// ─── Outcome summary string ───────────────────────────────────────

function outcomeSummary(o: DisputeActivity["closedOutcomes"]): string {
  const parts: string[] = [];
  if (o.won > 0) parts.push(`${statusPill(`${o.won} won`, "win")}`);
  if (o.partiallyWon > 0)
    parts.push(`${statusPill(`${o.partiallyWon} partial`, "win")}`);
  if (o.lost > 0) parts.push(`${statusPill(`${o.lost} lost`, "loss")}`);
  if (o.accepted > 0)
    parts.push(`${statusPill(`${o.accepted} accepted`, "neutral")}`);
  if (o.refunded > 0)
    parts.push(`${statusPill(`${o.refunded} refunded`, "neutral")}`);
  if (o.other > 0)
    parts.push(`${statusPill(`${o.other} other`, "neutral")}`);
  return parts.join("");
}

// ─── Dispute activity section ─────────────────────────────────────

function renderDisputeActivitySection(
  da: DisputeActivity,
  periodLabel: string,
): string {
  const heading = sectionLabel("Dispute activity this month", "#3B82F6");

  // No-activity short-circuit. Positive one-liner, green tint —
  // never a table of zeros.
  if (
    da.openedCount === 0 &&
    da.closedCount === 0 &&
    da.openNowCount === 0
  ) {
    return `${heading}${tintedCallout({
      tone: "green",
      title: `No new disputes in ${periodLabel}.`,
      body:
        "Your defense surface stayed clean. We'll keep monitoring, and the next digest will surface any change.",
    })}`;
  }

  const sections: string[] = [];

  // Opened — top line, blue tinted summary callout (most signal-rich
  // single number per the user's mental model: "what landed on me").
  if (da.openedCount > 0) {
    const reasonsHtml = da.openedTopReasons
      .slice(0, 3)
      .map((r) => statusPill(`${reasonLabel(r.reason)} × ${r.count}`, "info"))
      .join("");
    sections.push(
      tintedCallout({
        tone: "blue",
        title: `${da.openedCount} ${da.openedCount === 1 ? "dispute" : "disputes"} opened · ${money(da.openedAmountTotal, da.openedCurrency)} at stake`,
        body: reasonsHtml,
      }),
    );
  }

  // Closed — outcome pills row.
  if (da.closedCount > 0) {
    sections.push(
      `<div style="margin:0 0 16px">
        <div style="font-size:13px;color:#374151;margin:0 0 8px">
          <strong style="color:#111827">${da.closedCount} closed in ${periodLabel}</strong>
          ${
            da.closedAmountRecovered > 0
              ? ` · <span style="color:#065F46">${money(da.closedAmountRecovered, da.closedCurrency)} recovered</span>`
              : ""
          }
        </div>
        <div>${outcomeSummary(da.closedOutcomes)}</div>
      </div>`,
    );
  }

  // Open right now — current liability.
  if (da.openNowCount > 0) {
    const dueLabel = relativeDueLabel(da.openNowNearestDueAt);
    const dueIsOverdue = dueLabel?.includes("overdue") ?? false;
    sections.push(
      `<div style="margin:0 0 16px">
        <div style="font-size:13px;color:#374151;margin:0 0 6px">
          <strong style="color:#111827">${da.openNowCount} open right now</strong>
          · ${money(da.openNowAmountAtStake, da.openNowCurrency)} at stake
        </div>
        ${
          dueLabel
            ? `<div style="font-size:12px;color:${dueIsOverdue ? "#991B1B" : "#6B7280"}">
              Nearest deadline ${dueLabel}
            </div>`
            : ""
        }
      </div>`,
    );
  }

  // Win rate trend — only when statistically meaningful (>=3 decided
  // disputes in the current 90d). Below that, comparing rates is
  // noise.
  if (da.winRate90dPct != null) {
    const trend = delta(da.winRate90dPct, da.winRatePrior90dPct, "pp", false);
    sections.push(
      `<table style="width:100%;border-collapse:collapse;margin-top:6px">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6B7280">Win rate (last 90d)</td>
          <td style="padding:8px 0;font-size:15px;color:#111827;font-weight:600;text-align:right;font-variant-numeric:tabular-nums">${pct(da.winRate90dPct)}</td>
          <td style="padding:8px 0;font-size:12px;color:${trend.color};text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;width:80px">${trend.text}</td>
        </tr>
        <tr>
          <td colspan="3" style="padding:0 0 4px;font-size:11px;color:#9CA3AF">
            Across ${da.decidedCount90d} decided disputes
          </td>
        </tr>
      </table>`,
    );
  }

  return `${heading}${sections.join("")}`;
}

export function renderMonthlyChargebackDigest(d: DigestData): RenderResult {
  const merchantDisplay =
    d.merchantName ?? d.shopDomain.replace(/\.myshopify\.com$/i, "");
  const dashboardUrl = getEmbeddedAppUrl(
    d.shopDomain,
    "insights/initial-analysis",
  );

  const cb = d.chargebackRate90dPct;
  const cur = d.current30d;
  const prior = d.prior30d;

  // Operational checkpoints — top 3 for inbox brevity.
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

  // Headline severity drives the chargeback-rate accent color.
  const headlineSeverity: Checkpoint["severity"] =
    cb == null
      ? "info"
      : cb >= 1.5
        ? "breach"
        : cb >= 0.9
          ? "consider"
          : "healthy";
  const headlineColor =
    headlineSeverity === "breach"
      ? "#DC2626"
      : headlineSeverity === "consider"
        ? "#D97706"
        : headlineSeverity === "healthy"
          ? "#10B981"
          : "#111827";

  const subject = `Your ${d.periodLabel} chargeback exposure · DisputeDesk`;
  const previewText = `${cur.ordersTotal.toLocaleString()} orders this month · 90-day chargeback rate ${pct(cb, 2)} · view your operational checkpoints`;

  // ── 30d snapshot rows ─────────────────────────────────────────
  const dHigh = delta(cur.highRiskPct, prior.highRiskPct, "pp", true);
  const dFulfilledHigh = delta(
    cur.fulfilledHighRiskPct,
    prior.fulfilledHighRiskPct,
    "pp",
    true,
  );
  const dThreeDs = delta(cur.threeDsAuthRatePct, prior.threeDsAuthRatePct, "pp", false);
  const dProtect = delta(
    cur.shopifyProtectCoveragePct,
    prior.shopifyProtectCoveragePct,
    "pp",
    false,
  );
  const dSigned = delta(cur.signedForRatePct, prior.signedForRatePct, "pp", false);
  const dMedian = delta(
    cur.medianFulfillmentHours,
    prior.medianFulfillmentHours,
    "h",
    true,
  );

  const trendsTable = `<table style="width:100%;border-collapse:collapse">
    ${kpiRow({ label: "HIGH-risk orders", value: pct(cur.highRiskPct), deltaText: dHigh.text, deltaColor: dHigh.color })}
    ${kpiRow({ label: "HIGH-risk fulfilled", value: pct(cur.fulfilledHighRiskPct), deltaText: dFulfilledHigh.text, deltaColor: dFulfilledHigh.color })}
    ${kpiRow({ label: "3-DS authentication", value: pct(cur.threeDsAuthRatePct), deltaText: dThreeDs.text, deltaColor: dThreeDs.color })}
    ${kpiRow({ label: "Shopify Protect coverage", value: pct(cur.shopifyProtectCoveragePct), deltaText: dProtect.text, deltaColor: dProtect.color })}
    ${kpiRow({ label: "Signed delivery", value: pct(cur.signedForRatePct), deltaText: dSigned.text, deltaColor: dSigned.color })}
    ${kpiRow({ label: "Median fulfill time", value: hours(cur.medianFulfillmentHours), deltaText: dMedian.text, deltaColor: dMedian.color })}
  </table>`;

  // ── Inner plate content ───────────────────────────────────────
  const inner = `
    ${brandHeader(d.periodLabel + " digest")}

    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;margin:0 0 8px">${merchantDisplay}</div>
    <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.25;letter-spacing:-0.01em">Your ${d.periodLabel} chargeback exposure</h1>
    <p style="font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.6">
      Across <strong style="color:#111827">${cur.ordersTotal.toLocaleString()}</strong> orders in the last 30 days. The headline below is your 90-day chargeback rate, compared against the published thresholds at Visa and Mastercard.
    </p>

    ${heroNumber({
      number: pct(cb, 2),
      label: "90-day chargeback rate",
      accentColor: headlineColor,
    })}

    ${hairline()}

    ${sectionLabel("Where you stand", "#1D4ED8")}
    ${checkpoints.map(checkpointRow).join("")}

    ${hairline()}

    ${renderDisputeActivitySection(d.disputeActivity, d.periodLabel)}

    ${hairline()}

    ${sectionLabel("Month over month", "#6B7280")}
    ${trendsTable}

    ${hairline()}

    ${ctaButton("Open Chargeback Exposure →", dashboardUrl)}
  `;

  const html = plateLayout({
    innerHtml: inner,
    previewText,
    footerText:
      "Pulled from your historical Shopify orders and disputes. Thresholds verified against published Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11. You received this because monthly digests are enabled in your DisputeDesk notification settings.",
  });

  // ── Plain text fallback ───────────────────────────────────────
  const da = d.disputeActivity;
  const disputeText =
    da.openedCount === 0 && da.closedCount === 0 && da.openNowCount === 0
      ? `No new disputes in ${d.periodLabel}. Your defense surface stayed clean.`
      : [
          da.openedCount > 0
            ? `Opened: ${da.openedCount} (${money(da.openedAmountTotal, da.openedCurrency)} at stake) — ${da.openedTopReasons
                .slice(0, 3)
                .map((r) => `${reasonLabel(r.reason)} ×${r.count}`)
                .join(", ")}`
            : null,
          da.closedCount > 0
            ? `Closed: ${da.closedCount}${da.closedAmountRecovered > 0 ? `, ${money(da.closedAmountRecovered, da.closedCurrency)} recovered` : ""} (${da.closedOutcomes.won}W / ${da.closedOutcomes.lost}L / ${da.closedOutcomes.partiallyWon}P / ${da.closedOutcomes.accepted}A)`
            : null,
          da.openNowCount > 0
            ? `Open right now: ${da.openNowCount} · ${money(da.openNowAmountAtStake, da.openNowCurrency)} at stake${relativeDueLabel(da.openNowNearestDueAt) ? ` · nearest deadline ${relativeDueLabel(da.openNowNearestDueAt)}` : ""}`
            : null,
          da.winRate90dPct != null
            ? `Win rate (90d): ${pct(da.winRate90dPct)} across ${da.decidedCount90d} decided`
            : null,
        ]
          .filter(Boolean)
          .join("\n");

  const text = `${merchantDisplay} — Your ${d.periodLabel} chargeback exposure

${cur.ordersTotal.toLocaleString()} orders this month.

90-day chargeback rate: ${pct(cb, 2)}

Where you stand:
${checkpoints
  .map((c, i) => {
    const copy = resolveCheckpointCopy(c);
    const src = c.source ? `\n   Source: ${c.source.url}` : "";
    return `${i + 1}. [${c.severity.toUpperCase()}] ${copy.title}\n   ${copy.body}${src}`;
  })
  .join("\n\n")}

Dispute activity this month:
${disputeText}

Month over month (current · Δ vs prior 30d):
  HIGH-risk orders         ${pct(cur.highRiskPct)}   ${dHigh.text}
  HIGH-risk fulfilled      ${pct(cur.fulfilledHighRiskPct)}   ${dFulfilledHigh.text}
  3-DS authentication      ${pct(cur.threeDsAuthRatePct)}   ${dThreeDs.text}
  Shopify Protect coverage ${pct(cur.shopifyProtectCoveragePct)}   ${dProtect.text}
  Signed delivery          ${pct(cur.signedForRatePct)}   ${dSigned.text}
  Median fulfill time      ${hours(cur.medianFulfillmentHours)}   ${dMedian.text}

Open Chargeback Exposure: ${dashboardUrl}

---
Pulled from your historical Shopify orders and disputes. Thresholds verified against Visa VAMP and Mastercard ECP rules. Last verified 2026-05-11.
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
    // Resend SDK returns `{data, error}`; sends are not throw-on-failure.
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
