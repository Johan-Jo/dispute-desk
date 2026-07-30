/**
 * Send "we could not build a defence package and your deadline is today" to
 * the merchant. Triggered by the defence-package deadline cron when the
 * Defence Package PDF can't be used (validation failed, skipped, or missing)
 * and the dispute deadline is today.
 *
 * THERE IS NO FALLBACK SUBMISSION. The file name is historical: the pack-PDF
 * fallback was retired, and the cron that calls this inserts no job. So this
 * email is the merchant's only warning that DisputeDesk has filed nothing, and
 * it must never imply otherwise — it used to say "we submitted the existing
 * evidence pack PDF in its place", which was the opposite of the truth on the
 * one morning it mattered.
 *
 * It must not overcorrect either. Until 2026-07-30 it said "nothing has been
 * filed" flat out. Shopify auto-compiles the order data it holds and files THAT
 * when no evidence is submitted, so the accurate claim is scoped to us: we sent
 * nothing. Naming what Shopify still does is what tells the merchant the case
 * is not merely unattended but about to be argued badly on their behalf.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";

// Read lazily so a test can stub `process.env.RESEND_API_KEY` in beforeEach and
// have the new value picked up. A module-level `const` captures the value at
// import time, which silently no-ops every stub — the same trap already
// documented in sendNewDisputeAlert.ts.
const getResendApiKey = (): string | undefined => process.env.RESEND_API_KEY;
const getFromEmail = (): string =>
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const getReplyTo = (): string =>
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

/**
 * Shopify Protect is the one reason on this list that is NOT a problem.
 * Shopify absorbs the loss, DisputeDesk deliberately builds nothing, and there
 * is no deadline to miss — so the "act today or forfeit" framing that the other
 * reasons need would be alarming and wrong.
 */
function isCovered(reason: DefenceDeadlineFallbackContext["fallbackReason"]): boolean {
  return reason === "skipped_covered";
}

export async function sendDefenceDeadlineFallbackAlert(
  ctx: DefenceDeadlineFallbackContext,
): Promise<SendResult> {
  if (!getResendApiKey()) {
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

  /**
   * NOTHING WAS SUBMITTED. This email used to say the opposite — "we submitted
   * the existing evidence pack PDF in its place", "your evidence pack has been
   * sent, the bank will review what was submitted" — while the cron that sends
   * it inserts no job at all (its own comment: "Post-retirement: no pack-PDF
   * fallback… The merchant must regenerate manually"). So the one email a
   * merchant receives on the morning their deadline expires told them they were
   * covered. Whatever else this message does, it has to say the opposite of
   * that, in the first sentence, unmistakably.
   */
  const covered = isCovered(ctx.fallbackReason);

  const subject = covered
    ? `No response needed: dispute ${disputeIdShort} is covered by Shopify Protect`
    : `Action required today: dispute ${disputeIdShort} has no response filed`;

  const text = covered
    ? [
        `Hello,`,
        ``,
        `The chargeback dispute ${disputeIdShort}${amountStr ? ` (${amountStr})` : ""} reached its evidence deadline today, and DisputeDesk did not build a response for it.`,
        ``,
        `That is deliberate: ${reason}. Shopify absorbs this loss, so there is nothing to defend and nothing for you to do.`,
        ``,
        `Dispute reason: ${ctx.reason ?? "—"}`,
        `Deadline: ${ctx.dueAt ?? "—"}`,
        ``,
        `— DisputeDesk`,
      ].join("\n")
    : [
        `Hello,`,
        ``,
        `The chargeback dispute ${disputeIdShort}${amountStr ? ` (${amountStr})` : ""} reaches its evidence deadline today and DISPUTEDESK HAS FILED NOTHING.`,
        ``,
        `DisputeDesk could not produce a defence package because ${reason}, and there is no fallback — the defence package is the only thing we submit. We have sent no evidence to Shopify for this dispute.`,
        ``,
        `Shopify will pass on the basic order details it holds when the deadline passes, but nothing we built and nothing you have reviewed. That rarely wins. Open the dispute in DisputeDesk to regenerate the package, or add your own evidence directly in Shopify Admin before the deadline.`,
        ``,
        `Dispute reason: ${ctx.reason ?? "—"}`,
        `Why we could not build it: ${ctx.fallbackReason}`,
        `Deadline: ${ctx.dueAt ?? "—"}`,
        ``,
        `— DisputeDesk`,
      ].join("\n");

  const body = covered
    ? `<p>The chargeback dispute <strong>${disputeIdShort}</strong>${amountStr ? ` (${amountStr})` : ""} reached its evidence deadline today, and DisputeDesk did not build a response for it.</p>
<p>That is deliberate: ${reason}. Shopify absorbs this loss, so there is nothing to defend and nothing for you to do.</p>`
    : `<p style="font-size:16px;font-weight:600;">The chargeback dispute <strong>${disputeIdShort}</strong>${amountStr ? ` (${amountStr})` : ""} reaches its evidence deadline today and DisputeDesk has filed nothing.</p>
<p>DisputeDesk could not produce a defence package because ${reason}, and there is no fallback — the defence package is the only thing we submit. <strong>We have sent no evidence to Shopify for this dispute.</strong></p>
<p>Shopify will pass on the basic order details it holds when the deadline passes, but nothing we built and nothing you have reviewed. That rarely wins. Open the dispute in DisputeDesk to regenerate the package, or add your own evidence directly in Shopify Admin before the deadline.</p>`;

  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;line-height:1.55;">
<p>Hello,</p>
${body}
<table style="border-collapse:collapse;margin-top:12px;font-size:13px;">
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Dispute reason</td><td>${escapeHtml(ctx.reason ?? "—")}</td></tr>
  ${covered ? "" : `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">Why we could not build it</td><td>${escapeHtml(ctx.fallbackReason)}</td></tr>`}
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Deadline</td><td>${escapeHtml(ctx.dueAt ?? "—")}</td></tr>
  ${shopDomain ? `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">Shop</td><td>${escapeHtml(shopDomain)}</td></tr>` : ""}
</table>
<p style="color:#94A3B8;font-size:12px;margin-top:24px;">— DisputeDesk</p>
</body></html>`;

  try {
    const resend = new Resend(getResendApiKey());
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      replyTo: getReplyTo(),
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
