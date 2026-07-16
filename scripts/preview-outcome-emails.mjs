#!/usr/bin/env node
// Preview the outcome-posted email variants (chargeback + inquiry
// wording, won/lost/accepted each) by sending one of each to a
// hardcoded recipient. Uses Resend directly with the same HTML the
// production helper produces — no DB writes, no audit events,
// no shop_setup lookup. Safe to run repeatedly.
//
// Usage:
//   RESEND_API_KEY=<key> node scripts/preview-outcome-emails.mjs

import { Resend } from "resend";

const TO_EMAIL = "oi@johan.com.br";
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY not set");
  process.exit(1);
}

const STRINGS = {
  shared: {
    reason: "Reason",
    order: "Order",
    footer:
      "You're receiving this because outcome notifications are enabled for your DisputeDesk team. Manage your preferences in the embedded app under Team settings.",
  },
  won: {
    subject: ({ orderName }) =>
      `You won the chargeback on ${orderName ?? "dispute"}`,
    heading: "You won this chargeback",
    body: [
      "Good news — the card network accepted your defence package and ruled this dispute in your favour.",
      "The disputed amount remains with you, and any temporary debit should be reversed by your processor according to their normal payout timing.",
      "Your case record stays in DisputeDesk, including the evidence submitted, timeline, and outcome, so your team can review what worked and reuse the pattern for future disputes.",
    ],
    amountLabel: "Amount protected",
    cta: "View winning case",
    resultLine: "Result: Defence accepted · Funds retained",
  },
  lost: {
    subject: ({ orderName }) =>
      `This chargeback was lost — ${orderName ?? "dispute"}`,
    heading: "This chargeback was not won",
    body: [
      "The card network sided with the cardholder, and the disputed amount has been deducted from your payout.",
      "This decision is final for this dispute, so there is no further action to take. The case will remain in DisputeDesk with the submitted evidence, timeline, and outcome so your team can review what happened and identify ways to strengthen future defences.",
    ],
    amountLabel: "Amount lost",
    cta: "Review the case",
    resultLine: "Result: Cardholder won · Funds deducted",
  },
  accepted: {
    subject: ({ orderName }) =>
      `Chargeback closed on ${orderName ?? "dispute"}`,
    heading: "This chargeback has closed",
    body: [
      "This dispute has now closed without a submitted defence response. The disputed amount has settled with the cardholder.",
      "There is nothing further to do on this case, but DisputeDesk will keep the record available so your team can review the timeline, see what evidence was available, and improve future dispute handling.",
    ],
    amountLabel: "Amount settled with cardholder",
    cta: "View case record",
    resultLine: "Result: Closed · No defence submitted",
  },
  // Inquiry-phase wording — says "dispute", never "chargeback", and the
  // body states explicitly that the case was an inquiry.
  inquiry_won: {
    subject: ({ orderName }) =>
      `You won the dispute on ${orderName ?? "dispute"}`,
    heading: "You won this dispute",
    body: [
      "Good news — this case was an inquiry, not a chargeback: the payment provider asked for more information before deciding whether to raise a formal chargeback. Your response satisfied them, and the case has been resolved in your favour.",
      "The disputed amount remains with you, and the case closed without escalating to a chargeback.",
      "Your case record stays in DisputeDesk, including the evidence submitted, timeline, and outcome, so your team can review what worked and reuse the pattern for future disputes.",
    ],
    amountLabel: "Amount protected",
    cta: "View winning case",
    resultLine: "Result: Inquiry resolved in your favour · Funds retained",
  },
  inquiry_lost: {
    subject: ({ orderName }) =>
      `This dispute was lost — ${orderName ?? "dispute"}`,
    heading: "This dispute was not won",
    body: [
      "This case was an inquiry, not a chargeback: the payment provider asked for more information before making a decision. The case has been resolved against you, and the disputed amount has been deducted from your payout.",
      "This decision is final for this case, so there is no further action to take. The case will remain in DisputeDesk with the submitted evidence, timeline, and outcome so your team can review what happened and identify ways to strengthen future responses.",
    ],
    amountLabel: "Amount lost",
    cta: "Review the case",
    resultLine: "Result: Resolved against you · Funds deducted",
  },
  inquiry_accepted: {
    subject: ({ orderName }) => `Dispute closed on ${orderName ?? "dispute"}`,
    heading: "This dispute has closed",
    body: [
      "This case was an inquiry, not a chargeback: the payment provider asked for more information before deciding whether to escalate. The case has now closed without a submitted response, and the disputed amount has settled with the customer.",
      "There is nothing further to do on this case, but DisputeDesk will keep the record available so your team can review the timeline, see what evidence was available, and improve future dispute handling.",
    ],
    amountLabel: "Amount settled with customer",
    cta: "View case record",
    resultLine: "Result: Closed · No response submitted",
  },
};

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function renderHtml({ variant, ctx }) {
  const accent = variant.endsWith("won")
    ? "#0C5132"
    : variant.endsWith("lost")
      ? "#8B1F19"
      : "#4A4A4A";
  const v = STRINGS[variant];
  const s = STRINGS.shared;
  const amountStr = formatCurrency(ctx.amount, ctx.currency);
  const disputeUrl = "https://disputedesk.app/app/disputes/preview-30b00826";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F6F6F7">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;padding:32px;margin-bottom:16px">
      <table style="border-collapse:collapse;margin-bottom:20px" role="presentation"><tr>
        <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);text-align:center;vertical-align:middle">
          <span style="color:#fff;font-size:16px;font-weight:700;line-height:32px">D</span>
        </td>
        <td style="padding-left:10px;vertical-align:middle">
          <span style="font-size:15px;font-weight:600;color:#202223">DisputeDesk</span>
        </td>
      </tr></table>

      <h1 style="font-size:20px;font-weight:600;color:${accent};margin:0 0 12px">
        ${v.heading}
      </h1>
      ${v.body
        .map(
          (p) =>
            `<p style="font-size:14px;color:#202223;margin:0 0 12px;line-height:1.55">${p}</p>`,
        )
        .join("")}

      <table style="width:100%;border-collapse:collapse;margin:18px 0 20px;font-size:13px" role="presentation">
        <tr><td style="padding:6px 0;color:#5C5F62;width:38%">${s.order}</td><td style="padding:6px 0;color:#202223">${ctx.orderName}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${s.reason}</td><td style="padding:6px 0;color:#202223">${ctx.reason}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${v.amountLabel}</td><td style="padding:6px 0;color:#202223;font-weight:600">${amountStr}</td></tr>
      </table>

      <a href="${disputeUrl}" style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
        ${v.cta}
      </a>

      ${
        v.resultLine
          ? `<p style="font-size:12px;color:${accent};margin:16px 0 0;line-height:1.5;font-weight:500;letter-spacing:0.01em">${v.resultLine}</p>`
          : ""
      }
    </div>
    <p style="font-size:11px;color:#8A8A8A;text-align:center;margin:8px 0 0;line-height:1.5">
      ${s.footer}
    </p>
  </div>
</body>
</html>`;
}

const VARIANTS = [
  {
    variant: "won",
    ctx: {
      orderName: "#1042",
      reason: "Unauthorized transaction",
      amount: 432.9,
      currency: "USD",
    },
  },
  {
    variant: "lost",
    ctx: {
      orderName: "#1043",
      reason: "Product not received",
      amount: 187.5,
      currency: "USD",
    },
  },
  {
    variant: "accepted",
    ctx: {
      orderName: "#1044",
      reason: "Duplicate charge",
      amount: 95,
      currency: "USD",
    },
  },
  {
    variant: "inquiry_won",
    ctx: {
      orderName: "#12809",
      reason: "Refund not processed",
      amount: 1747.14,
      currency: "SEK",
    },
  },
  {
    variant: "inquiry_lost",
    ctx: {
      orderName: "#12810",
      reason: "Product not received",
      amount: 289,
      currency: "SEK",
    },
  },
  {
    variant: "inquiry_accepted",
    ctx: {
      orderName: "#12811",
      reason: "Unrecognized charge",
      amount: 412.5,
      currency: "SEK",
    },
  },
];

const resend = new Resend(RESEND_API_KEY);

for (const { variant, ctx } of VARIANTS) {
  const html = renderHtml({ variant, ctx });
  const subject = `[DisputeDesk · PREVIEW] ${STRINGS[variant].subject({
    orderName: ctx.orderName,
  })}`;
  try {
    const res = await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: TO_EMAIL,
      subject,
      html,
    });
    if (res.error) {
      console.error(`[${variant}] error:`, res.error);
    } else {
      console.log(`[${variant}] sent to ${TO_EMAIL} (id: ${res.data?.id ?? "?"})`);
    }
  } catch (err) {
    console.error(`[${variant}] threw:`, err);
  }
}
