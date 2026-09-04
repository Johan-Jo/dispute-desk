/**
 * Send "this dispute cannot be won as it stands — here is what to do about it"
 * to the merchant, at the moment the fatal-loss gate fires.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * The fatal-loss gate (`lib/automation/fatalLoss.ts`) detects structurally
 * unwinnable cases and stands DisputeDesk down: the package is marked
 * `skipped`, auto-submit is blocked, and the merchant sees one sentence of
 * strength-reason copy. Until 2026-09-04 that sentence explained the verdict
 * and stopped there — it told the merchant WHY we gave up and nothing about
 * what they could do instead.
 *
 * That silence is expensive, because standing down is not neutral: **Shopify
 * auto-compiles and files its own scrape of the order at the deadline whether
 * or not we send anything** (see `docs/technical.md` § the guards' framing).
 * On an unfulfilled item-not-received order that scrape says the goods never
 * shipped. So the merchant is not merely undefended — they are about to be
 * argued against on their own behalf, and the first they hear of it is the
 * loss.
 *
 * Found on blume-box #360499 (due 2026-09-11, USD 85.41): order `IN_PROGRESS`,
 * paid, never cancelled, never refunded, zero fulfillments, risk `ACCEPT`. The
 * pack rebuilt to `skipped / no_bank_eligible_facts` and nobody was told
 * anything actionable.
 *
 * ── WHAT THIS EMAIL MUST AND MUST NOT SAY ─────────────────────────────
 *
 * Inherits the honesty rules `sendDefenceDeadlineFallbackAlert` learned the
 * hard way:
 *   - NEVER imply we filed something. We did not.
 *   - NEVER say "nothing has been filed" flat out either — Shopify still files
 *     its scrape. The accurate claim is scoped to us: *we* sent nothing, and
 *     Shopify will send the bare order data.
 *   - Lead with the ACTION, not the verdict. Each reason has exactly one
 *     realistic next step, and for `inr_no_fulfillment` there are two,
 *     because the same order state has two very different causes (see below).
 *
 * ── THE TWO-CAUSE PROBLEM (inr_no_fulfillment) ────────────────────────
 *
 * "No fulfillment on record" collapses two situations the gate cannot tell
 * apart:
 *   1. It genuinely never shipped → the customer is right; refunding closes it
 *      and avoids paying the chargeback fee on top of the amount.
 *   2. It shipped but was never marked fulfilled in Shopify (3PL gap, manual
 *      process) → the case is WINNABLE and we would otherwise concede it.
 *
 * The email therefore ASKS rather than concludes: add the tracking number and
 * we rebuild the defence automatically. That is the one thing the merchant can
 * do that we cannot, which is the bar for asking them anything at all.
 *
 * Fire-and-forget — never throws; callers log failures without blocking.
 */

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import type { FatalLossReason } from "@/lib/automation/fatalLoss";

// Read lazily so a test can stub `process.env.RESEND_API_KEY` in beforeEach and
// have the new value picked up — a module-level const captures at import time
// and silently no-ops every stub.
const getResendApiKey = (): string | undefined => process.env.RESEND_API_KEY;
const getFromEmail = (): string => DEFAULT_FROM_EMAIL;
const getReplyTo = (): string => DEFAULT_REPLY_TO;

export interface FatalLossAlertContext {
  shopId: string;
  disputeId: string;
  disputeGid: string | null;
  /** Which fatal-loss trigger fired. Decides the entire action block. */
  reason: FatalLossReason;
  /** Shopify dispute reason code, for the detail table. */
  disputeReason: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string | null;
  orderName: string | null;
  /**
   * `disputes.phase` — `inquiry` or `chargeback`. Decides whether "refund it"
   * is even a legal instruction: Shopify BLOCKS refunds once a chargeback is
   * open, so telling a merchant to refund one is advice they cannot follow.
   * See `actionsFor`.
   */
  phase: string | null;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * The dispute's own noun. An INQUIRY is not a chargeback — no money has moved
 * and calling it one both misstates the facts and contradicts the body, which
 * tells an inquiry merchant that "no money has been taken yet".
 */
function disputeNoun(phase: string | null): string {
  return (phase ?? "").toLowerCase() === "inquiry" ? "inquiry" : "chargeback";
}

/** Subject line — names the order and the fact that action is needed. */
function subjectFor(
  reason: FatalLossReason,
  orderName: string | null,
  phase: string | null,
): string {
  const order = orderName ? ` for ${orderName}` : "";
  const noun = disputeNoun(phase);
  return reason === "inr_no_fulfillment"
    ? `Action needed: ${noun}${order} can't be defended without tracking`
    : `No action needed: ${noun}${order} was already refunded`;
}

/** One-line summary of the situation, in plain terms. */
function situationFor(reason: FatalLossReason): string {
  return reason === "inr_no_fulfillment"
    ? "The customer says the item never arrived, and this order has no shipment on record."
    : "A refund covering this charge was already issued.";
}

/**
 * The action block — the point of the email. Returns HTML list items,
 * most-likely-useful first.
 *
 * ── WHY PHASE DECIDES THE SECOND BRANCH ───────────────────────────────
 *
 * The first version of this email told a merchant whose order never shipped
 * to "refund the order". **That is advice they cannot follow, and it was
 * wrong.** Shopify: *"You can't issue a refund after a cardholder initiates a
 * chargeback"* — the refund control is blocked once the dispute is open, the
 * disputed amount and fee are already debited, and a refund forced through by
 * other means pays the customer twice.
 *
 * The correct instruction depends on `phase`, which the dispute row already
 * carries:
 *
 *   - `chargeback` — the money is ALREADY gone. There is nothing to refund and
 *     no action that returns it. Either let it close (the bank keeps the funds
 *     with the customer), or, if the customer agrees they were wrong, have
 *     them ask their bank to WITHDRAW the dispute and send the withdrawal
 *     letter — the one route Shopify documents for making it go away.
 *   - `inquiry` — no money has moved yet and refunding is still possible. Here
 *     a refund genuinely IS the cheap resolution: it settles the case before
 *     it escalates into a chargeback and its fee.
 *
 * Never collapse these two. Telling a chargeback merchant to refund is an
 * instruction Shopify's own UI refuses, and it reads as though we do not know
 * how the product works.
 */
function actionsFor(reason: FatalLossReason, phase: string | null): string[] {
  const isInquiry = (phase ?? "").toLowerCase() === "inquiry";

  if (reason === "inr_no_fulfillment") {
    const shipped =
      "<strong>If it did ship:</strong> add the tracking number to the order in Shopify. DisputeDesk rebuilds the defence automatically once the shipment appears, and the case becomes defensible.";
    return isInquiry
      ? [
          shipped,
          "<strong>If it never shipped:</strong> refund the order now. This is still an inquiry, so no money has been taken yet and refunding settles it before it becomes a chargeback with a fee attached.",
        ]
      : [
          shipped,
          "<strong>If it never shipped:</strong> there is nothing to do — and nothing to refund. The disputed amount and the chargeback fee have already been debited, and Shopify blocks refunds while a chargeback is open. Let it close.",
          "<strong>Only if the customer agrees they were mistaken:</strong> ask them to contact their bank and withdraw the dispute, then send us the bank's withdrawal letter. That is the one route that reverses a chargeback.",
        ];
  }

  return [
    "<strong>No action needed</strong> — let this one close. Arguing it would tell the bank the money is owed.",
    "<strong>If you refunded BEFORE the customer disputed</strong>, tell us. A pre-dispute credit is one of the strongest arguments available, and we will rebuild the defence around it.",
  ];
}

export async function sendFatalLossAlert(
  ctx: FatalLossAlertContext,
): Promise<SendResult> {
  if (!getResendApiKey()) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const sb = getServiceClient();

  // Merchant's team email — same lookup as the other dispute alerts.
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

  const amountStr =
    ctx.amount != null && ctx.currencyCode
      ? `${ctx.currencyCode} ${ctx.amount}`
      : null;
  // `getEmbeddedAppUrl` builds the admin.shopify.com redirect form itself —
  // hand it the in-app path, never concatenate onto its return value.
  const disputeUrl = shopDomain
    ? getEmbeddedAppUrl(shopDomain, `/app/disputes/${ctx.disputeId}`)
    : null;

  const subject = subjectFor(ctx.reason, ctx.orderName, ctx.phase);
  const actions = actionsFor(ctx.reason, ctx.phase);
  const isInr = ctx.reason === "inr_no_fulfillment";

  const actionHtml = actions
    .map((a) => `<li style="margin-bottom:8px;">${a}</li>`)
    .join("\n");

  /* The Shopify-scrape sentence is the load-bearing one: it is the difference
   * between "this case is unattended" and "this case is being argued badly on
   * your behalf, right now, unless you act". Never drop it, and never replace
   * it with "nothing has been filed" — that was the 2026-07-30 defect. */
  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;line-height:1.55;">
<p>Hello,</p>
<p>The ${escapeHtml(disputeNoun(ctx.phase))} on <strong>${escapeHtml(ctx.orderName ?? ctx.disputeId.slice(0, 8))}</strong>${amountStr ? ` (${escapeHtml(amountStr)})` : ""} cannot be won as it stands. ${escapeHtml(situationFor(ctx.reason))}</p>
<p><strong>What to do</strong></p>
<ul style="padding-left:20px;margin-top:4px;">
${actionHtml}
</ul>
<p>DisputeDesk has <strong>not</strong> sent a defence for this dispute${isInr ? " — there is nothing factual to argue with yet" : ""}. When the deadline passes, Shopify will pass on the basic order details it holds. That rarely wins${isInr ? ", and on an order with no shipment on record it argues against you" : ""}.</p>
${disputeUrl ? `<p><a href="${escapeHtml(disputeUrl)}" style="color:#1F1F1F;">Open this dispute in DisputeDesk</a></p>` : ""}
<table style="border-collapse:collapse;margin-top:12px;font-size:13px;">
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Dispute reason</td><td>${escapeHtml(ctx.disputeReason ?? "—")}</td></tr>
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">Deadline</td><td>${escapeHtml(ctx.dueAt ?? "—")}</td></tr>
  ${shopDomain ? `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">Shop</td><td>${escapeHtml(shopDomain)}</td></tr>` : ""}
</table>
<p style="color:#94A3B8;font-size:12px;margin-top:24px;">— DisputeDesk</p>
</body></html>`;

  const text = [
    `The ${disputeNoun(ctx.phase)} on ${ctx.orderName ?? ctx.disputeId.slice(0, 8)}${amountStr ? ` (${amountStr})` : ""} cannot be won as it stands.`,
    situationFor(ctx.reason),
    "",
    "What to do:",
    ...actions.map((a) => `- ${a.replace(/<[^>]+>/g, "")}`),
    "",
    `DisputeDesk has NOT sent a defence for this dispute. When the deadline passes, Shopify will pass on the basic order details it holds. That rarely wins${isInr ? ", and on an order with no shipment on record it argues against you" : ""}.`,
    disputeUrl ? `\nOpen this dispute: ${disputeUrl}` : "",
    "",
    `Dispute reason: ${ctx.disputeReason ?? "—"}`,
    `Deadline: ${ctx.dueAt ?? "—"}`,
  ].join("\n");

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
