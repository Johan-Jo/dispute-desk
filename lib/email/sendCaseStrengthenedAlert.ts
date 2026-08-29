/**
 * Send "your case just got stronger" email to the merchant.
 *
 * Fired when a pack rebuild RAISES the case strength after the initial
 * build — e.g. a PostNord parcel is finally delivered and an
 * item-not-received case moves weak → moderate. This is the proactive
 * counterpart to the in-app improvement banner: the merchant learns a
 * previously-weak case is now defensible without having to re-open it.
 *
 * Fire-and-forget — never throws; callers log failures without blocking.
 * Gating (notification preference, historicalImport suppression, per-level
 * dedupe) lives at the call site (buildPackJob), NOT here.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
const REPLY_TO = DEFAULT_REPLY_TO;

export type StrengthLevel = "insufficient" | "weak" | "moderate" | "strong";

export interface CaseStrengthenedContext {
  to: string;
  shopName?: string;
  shopDomain?: string | null;
  disputeId: string;
  disputeReason: string | null;
  disputeAmount?: string | null;
  priorStrength: StrengthLevel;
  newStrength: StrengthLevel;
  /** One-line, merchant-safe reason for the lift (e.g. "carrier confirmed
   *  delivery on 2026-07-06"). Optional — omitted when unknown. */
  reasonSummary?: string | null;
  disputeUrl?: string;
}

const LEVEL_LABEL: Record<StrengthLevel, string> = {
  insufficient: "Weak",
  weak: "Weak",
  moderate: "Moderate",
  strong: "Strong",
};

export async function sendCaseStrengthenedAlert(
  ctx: CaseStrengthenedContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping case-strengthened alert");
    return { ok: false, error: "Email service not configured" };
  }

  const disputeUrl =
    ctx.disputeUrl ?? getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}`);

  const amountStr = ctx.disputeAmount ? ` (${ctx.disputeAmount})` : "";
  const shopLabel = ctx.shopName ?? "your store";
  const reasonLabel = (ctx.disputeReason ?? "dispute").replace(/_/g, " ").toLowerCase();
  const priorLabel = LEVEL_LABEL[ctx.priorStrength];
  const newLabel = LEVEL_LABEL[ctx.newStrength];
  const reasonLine = ctx.reasonSummary
    ? `New evidence landed: <strong>${ctx.reasonSummary}</strong>.`
    : `New evidence was added to this case.`;
  const reasonLineText = ctx.reasonSummary
    ? `New evidence landed: ${ctx.reasonSummary}.`
    : `New evidence was added to this case.`;

  const subject = `Good news: your ${reasonLabel} case is now ${newLabel}${amountStr}`;

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
        Your case just got stronger
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        The <strong>${reasonLabel}</strong> dispute${amountStr} for ${shopLabel} was refreshed.
        ${reasonLine} Its strength moved from
        <strong>${priorLabel}</strong> to <strong>${newLabel}</strong>.
      </p>

      <div style="background:#ECFDF5;border:1px solid #6EE7B7;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;color:#065F46;margin:0;line-height:1.6">
          DisputeDesk automatically updated the defence package with the new evidence.
          Review it before your deadline. On Auto-pilot it goes to Shopify on the due date;
          in review mode it waits for your approval.
        </p>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        Review the updated case →
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      This email was sent because you enabled dispute notifications in DisputeDesk.
      You can change notification preferences in Settings.
    </p>
  </div>
</body>
</html>`.trim();

  const text = `Your case just got stronger

The ${reasonLabel} dispute${amountStr} for ${shopLabel} was refreshed.
${reasonLineText} Its strength moved from ${priorLabel} to ${newLabel}.

DisputeDesk automatically updated the defence package with the new evidence.
Review it before your deadline: ${disputeUrl}

---
This email was sent because you enabled dispute notifications in DisputeDesk.`;

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
    console.error("[email] Case-strengthened alert send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
