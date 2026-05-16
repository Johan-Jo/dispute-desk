/**
 * Send "deadline auto-submit used the pack PDF fallback" email to the
 * merchant. Triggered by the defence-package deadline cron when the
 * Defence Package PDF couldn't be used (validation failed, skipped, or
 * missing) and the dispute deadline is today.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface DefenceDeadlineFallbackContext {
  shopId: string;
  disputeId: string;
  disputeGid: string | null;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string | null;
  /** Why the defence package couldn't be used. */
  fallbackReason: "validation_failed" | "skipped_no_facts" | "skipped_covered" | "missing";
}

interface SendResult {
  ok: boolean;
  error?: string;
}

function readableReason(reason: DefenceDeadlineFallbackContext["fallbackReason"]): string {
  switch (reason) {
    case "validation_failed":
      return "the generated narrative failed our grounding validator";
    case "skipped_no_facts":
      return "the dispute did not have enough bank-eligible evidence to ground a Defence Package narrative";
    case "skipped_covered":
      return "the dispute is covered by Shopify Protect";
    case "missing":
      return "no Defence Package draft existed for this dispute";
  }
}

export async function sendDefenceDeadlineFallbackAlert(
  ctx: DefenceDeadlineFallbackContext,
): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const sb = getServiceClient();

  // Look up the merchant's team email from shop_setup. Same pattern as
  // sendNewDisputeAlert / sendHighValueReviewAlert.
  const { data: setup } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", ctx.shopId)
    .maybeSingle();
  const steps = (setup?.steps ?? {}) as Record<string, { payload?: Record<string, unknown> }>;
  const teamPayload = steps.team?.payload as Record<string, unknown> | undefined;
  const to = typeof teamPayload?.teamEmail === "string" ? teamPayload.teamEmail : null;
  if (!to) {
    return { ok: false, error: "no team email configured" };
  }

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", ctx.shopId)
    .single();
  const shopDomain = shop?.shop_domain ?? null;

  const reason = readableReason(ctx.fallbackReason);
  const disputeIdShort = ctx.disputeGid
    ? ctx.disputeGid.split("/").pop()
    : ctx.disputeId.slice(0, 8);
  const amountStr =
    ctx.amount != null && ctx.currencyCode
      ? `${ctx.currencyCode} ${ctx.amount}`
      : null;

  const subject = `Action required: Defence Package fallback used on dispute ${disputeIdShort}`;

  const text = [
    `Hello,`,
    ``,
    `The chargeback dispute ${disputeIdShort}${amountStr ? ` (${amountStr})` : ""} reached its evidence deadline today.`,
    ``,
    `Because ${reason}, DisputeDesk could not auto-submit your Complete Defence Package. To avoid losing the dispute by default, we submitted the existing evidence pack PDF to Shopify in its place.`,
    ``,
    `Your evidence pack has been sent — the bank will review what was submitted. If you would like to override or supplement the submission, sign into the DisputeDesk admin in your Shopify Admin and review the dispute detail page.`,
    ``,
    `Dispute reason: ${ctx.reason ?? "—"}`,
    `Reason for fallback: ${ctx.fallbackReason}`,
    `Deadline: ${ctx.dueAt ?? "—"}`,
    ``,
    `— DisputeDesk`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;line-height:1.55;">
<p>Hello,</p>
<p>The chargeback dispute <strong>${disputeIdShort}</strong>${amountStr ? ` (${amountStr})` : ""} reached its evidence deadline today.</p>
<p>Because ${reason}, DisputeDesk could not auto-submit your Complete Defence Package. To avoid losing the dispute by default, we submitted the existing evidence pack PDF to Shopify in its place.</p>
<p>Your evidence pack has been sent — the bank will review what was submitted. If you would like to override or supplement the submission, sign into DisputeDesk in your Shopify Admin and review the dispute detail page.</p>
<table style="border-collapse:collapse;margin-top:12px;font-size:13px;">
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Dispute reason</td><td>${escapeHtml(ctx.reason ?? "—")}</td></tr>
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Reason for fallback</td><td>${escapeHtml(ctx.fallbackReason)}</td></tr>
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Deadline</td><td>${escapeHtml(ctx.dueAt ?? "—")}</td></tr>
  ${shopDomain ? `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">Shop</td><td>${escapeHtml(shopDomain)}</td></tr>` : ""}
</table>
<p style="color:#94A3B8;font-size:12px;margin-top:24px;">— DisputeDesk</p>
</body></html>`;

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      return { ok: false, error: `Resend error: ${error.message ?? "unknown"}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown send error",
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
