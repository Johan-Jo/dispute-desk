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
import type { PackageUnsafeReason } from "@/lib/defence/packageSafety";

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
  fallbackReason:
    | "validation_failed"
    | "skipped_no_facts"
    | "skipped_covered"
    | "missing"
    /** PR-C1: the existing package carries a claim we cannot stand behind, or
     *  content we could not inspect. Nothing is filed; the merchant must
     *  regenerate. */
    | "unsafe_address_claim";
  /**
   * The content verdict's own reasons, when the caller has them.
   *
   * Without these the message can only guess which of five outcomes it is
   * describing, and it guessed the most specific one. See `readableReason`.
   */
  unsafeReasons?: readonly PackageUnsafeReason[];
}

interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * `unsafe_address_claim` covers FIVE distinct verdicts, and this said the most
 * specific one about all of them.
 *
 * `assessPackageCandidateSafety` can refuse a candidate for: an affirmative
 * address-delivery claim, an AMBIGUOUS one (prose the detector could not
 * resolve — it fails closed), a retired delivery fact, or supporting JSON it
 * could not read at all. The copy asserted the first: "the existing Defence
 * Package **states that delivery reached a verified address**".
 *
 * On 2026-08-14 blume-box `11051073729` was refused on
 * `ambiguous_address_delivery_claim` and the merchant was told their package
 * states something it does not state — the sentence in question was the
 * `ip_location` fact naming what it compares against, and the detector simply
 * could not resolve it. On an `unreadable_*` verdict the claim is not merely
 * over-stated, it is impossible: we never parsed the package to know what it
 * says.
 *
 * Both replacements are true of every verdict in their branch. Neither asserts
 * what the package claims — only what WE could or could not stand behind,
 * which is the honest thing to put in front of a merchant and the only thing
 * this module actually knows.
 *
 * With no reasons supplied the wording branch is used: it never over-asserts,
 * so an older caller degrades to accurate-but-general rather than to a
 * statement that may be false.
 */
function readableReason(
  reason: DefenceDeadlineFallbackContext["fallbackReason"],
  unsafeReasons?: readonly PackageUnsafeReason[],
): string {
  switch (reason) {
    case "validation_failed":
      return "the generated narrative failed our grounding validator";
    case "skipped_no_facts":
      return "the dispute did not have enough bank-eligible evidence to ground a Defence Package narrative";
    case "skipped_covered":
      return "the dispute is covered by Shopify Protect";
    case "missing":
      return "no Defence Package draft existed for this dispute";
    case "unsafe_address_claim":
      return (unsafeReasons ?? []).some(
        (r) => r === "unreadable_facts_json" || r === "unreadable_narrative_json",
      )
        ? "we could not check it automatically"
        : "it used delivery wording we can no longer stand behind";
  }
}

/**
 * The failure sentence, whole.
 *
 * The template used to be fixed — "DisputeDesk could not produce a defence
 * package because {reason}" — which is true of four of the five reasons and
 * self-contradicting on the fifth: for `unsafe_address_claim` a package WAS
 * produced, it just could not be filed. Rendered, that read "could not produce
 * a defence package because the existing Defence Package used…", which invites
 * the merchant to wonder which of the two halves is true.
 */
function failureSentence(
  fallbackReason: DefenceDeadlineFallbackContext["fallbackReason"],
  reason: string,
): string {
  return fallbackReason === "unsafe_address_claim"
    ? `DisputeDesk built a defence package but could not file it: ${reason}.`
    : `DisputeDesk could not produce a defence package because ${reason}.`;
}

/** Merchant-readable, for the summary table. The enum is for our logs. */
function fallbackReasonLabel(
  fallbackReason: DefenceDeadlineFallbackContext["fallbackReason"],
): string {
  switch (fallbackReason) {
    case "validation_failed":
      return "The generated narrative did not pass our checks";
    case "skipped_no_facts":
      return "Not enough bank-eligible evidence to build on";
    case "skipped_covered":
      return "Covered by Shopify Protect";
    case "missing":
      return "No defence package had been built yet";
    case "unsafe_address_claim":
      return "The package we built could not be filed";
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

  const reason = readableReason(ctx.fallbackReason, ctx.unsafeReasons);
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
        `${failureSentence(ctx.fallbackReason, reason)} There is no fallback — the defence package is the only thing we submit. We have sent no evidence to Shopify for this dispute.`,
        ``,
        `Shopify will pass on the basic order details it holds when the deadline passes, but nothing we built and nothing you have reviewed. That rarely wins. Open the dispute in DisputeDesk to regenerate the package, or add your own evidence directly in Shopify Admin before the deadline.`,
        ``,
        `Dispute reason: ${ctx.reason ?? "—"}`,
        `Why: ${fallbackReasonLabel(ctx.fallbackReason)}`,
        `Deadline: ${ctx.dueAt ?? "—"}`,
        ``,
        `— DisputeDesk`,
      ].join("\n");

  const body = covered
    ? `<p>The chargeback dispute <strong>${disputeIdShort}</strong>${amountStr ? ` (${amountStr})` : ""} reached its evidence deadline today, and DisputeDesk did not build a response for it.</p>
<p>That is deliberate: ${reason}. Shopify absorbs this loss, so there is nothing to defend and nothing for you to do.</p>`
    : `<p style="font-size:16px;font-weight:600;">The chargeback dispute <strong>${disputeIdShort}</strong>${amountStr ? ` (${amountStr})` : ""} reaches its evidence deadline today and DisputeDesk has filed nothing.</p>
<p>${failureSentence(ctx.fallbackReason, reason)} There is no fallback — the defence package is the only thing we submit. <strong>We have sent no evidence to Shopify for this dispute.</strong></p>
<p>Shopify will pass on the basic order details it holds when the deadline passes, but nothing we built and nothing you have reviewed. That rarely wins. Open the dispute in DisputeDesk to regenerate the package, or add your own evidence directly in Shopify Admin before the deadline.</p>`;

  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;line-height:1.55;">
<p>Hello,</p>
${body}
<table style="border-collapse:collapse;margin-top:12px;font-size:13px;">
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Dispute reason</td><td>${escapeHtml(ctx.reason ?? "—")}</td></tr>
  ${covered ? "" : `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">Why</td><td>${escapeHtml(fallbackReasonLabel(ctx.fallbackReason))}</td></tr>`}
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
