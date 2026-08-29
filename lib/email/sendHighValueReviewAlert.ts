/**
 * Send "high-value dispute needs review" email to the merchant.
 *
 * Triggered after a pack build when the matched automation rule is the
 * high-value safeguard (tier-0 amount rule from the wizard) AND the
 * resulting mode is "review" — i.e. the dispute amount exceeded the
 * threshold and the pack is parked instead of auto-submitting.
 *
 * Fire-and-forget — never throws; callers should log failures without blocking.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
const REPLY_TO = DEFAULT_REPLY_TO;

export interface HighValueReviewContext {
  to: string;
  shopName?: string;
  shopDomain?: string | null;
  disputeId: string;
  disputeReason: string | null;
  /** Amount of the dispute (numeric, e.g. "1250.00"). */
  disputeAmount: string;
  /** Threshold the merchant configured during onboarding. */
  threshold: number;
  packId: string;
  /** Optional override for the dispute deep link. */
  disputeUrl?: string;
}

export async function sendHighValueReviewAlert(
  ctx: HighValueReviewContext
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping high-value review alert");
    return { ok: false, error: "Email service not configured" };
  }

  const disputeUrl =
    ctx.disputeUrl ?? getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}`);

  const shopLabel = ctx.shopName ?? "your store";
  const reasonLabel = (ctx.disputeReason ?? "dispute")
    .replace(/_/g, " ")
    .toLowerCase();

  const subject = `Review needed: High-value ${reasonLabel} dispute ($${ctx.disputeAmount})`;

  const html = `
<!DOCTYPE html>
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

      <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 8px">
        High-value dispute parked for your review
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        A <strong>${reasonLabel}</strong> dispute for ${shopLabel} came in at
        <strong>$${ctx.disputeAmount}</strong>, which is above the
        <strong>$${ctx.threshold}</strong> review threshold you set during setup.
        DisputeDesk built the evidence pack automatically but is holding it for your approval
        before submitting.
      </p>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;color:#1E40AF;margin:0 0 8px;line-height:1.6">
          <strong>Open the dispute and choose what to do:</strong>
        </p>
        <ul style="font-size:13px;color:#1E40AF;margin:0;padding-left:18px;line-height:1.6">
          <li><strong>Submit on the deadline</strong> — we send the evidence automatically when the deadline arrives.</li>
          <li><strong>Hold for review</strong> — we keep watching it and remind you before the deadline.</li>
          <li><strong>Don't defend</strong> — we submit nothing and the dispute closes undefended.</li>
        </ul>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        Review this dispute →
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      You're getting this because high-value review is turned on in your Automation settings.
      To raise or lower the threshold, open DisputeDesk and visit Setup → Automation.
    </p>
  </div>
</body>
</html>`.trim();

  const text = `High-value dispute parked for your review

A ${reasonLabel} dispute for ${shopLabel} came in at $${ctx.disputeAmount}, which is above
the $${ctx.threshold} review threshold you set during setup. DisputeDesk built the evidence
pack automatically but is holding it for your approval before submitting.

Open the dispute and choose what to do:
  - Submit on the deadline — we send the evidence automatically when the deadline arrives.
  - Hold for review — we keep watching it and remind you before the deadline.
  - Don't defend — we submit nothing and the dispute closes undefended.

Review this dispute: ${disputeUrl}

---
You're getting this because high-value review is turned on in your Automation settings.`;

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: ctx.to.includes(",") ? ctx.to.split(",").map((e) => e.trim()) : ctx.to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("[email] High-value review alert send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
