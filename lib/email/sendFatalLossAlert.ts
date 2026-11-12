/**
 * Send "this dispute cannot be won as it stands — here is what to do about it"
 * to the merchant, at the moment the fatal-loss gate fires.
 *
 * ALL copy lives in messages/*.json under `email.fatalLoss` (CLAUDE.md rule 5); this file holds no sentence.
 * `renderFatalLossEmail` is pure (messages passed in) so every locale is testable without I/O. Until 2026-11-13
 * this email was hard-coded English and every merchant got it in English whatever their store language.
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
 *   - Lead with the ACTION, not the verdict.
 *
 * ── THE TWO-CAUSE PROBLEM (inr_no_fulfillment) ────────────────────────
 *
 * "No fulfillment on record" collapses two situations the gate cannot tell
 * apart:
 *   1. It genuinely never shipped → the customer is right; on an INQUIRY a refund can close it before it
 *      becomes a chargeback with a fee.
 *   2. It shipped but was never marked fulfilled in Shopify (3PL gap, manual
 *      process) → the case is WINNABLE and we would otherwise concede it.
 *
 * The email therefore ASKS rather than concludes: add the tracking number and we rebuild the defence
 * automatically. That is the one thing the merchant can do that we cannot.
 *
 * ── PHASE DECIDES THE "NEVER SHIPPED" BRANCH ─────────────────────────
 *
 * Shopify: "You can't issue a refund after a cardholder initiates a chargeback". Telling a chargeback merchant
 * to refund is advice they cannot follow, so the chargeback branch says there is nothing to refund. On an
 * INQUIRY the email no longer says "refund the order now": this alert is sent with no live read of the order's
 * refund state, and a refund may already be pending (it reads 0.0 for about a day), so it tells the merchant
 * to CHECK Shopify Admin first and only then that refunding the disputed amount can settle the inquiry.
 * Unknown phase is a chargeback (guessing "inquiry" would emit impossible advice).
 *
 * Fire-and-forget — never throws; callers log failures without blocking.
 */

import { Resend } from "resend";
import { createTranslator } from "next-intl";
import { getServiceClient } from "@/lib/supabase/server";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import { bodyToText, escapeHtml, inlineToHtml } from "@/lib/email/messageBody";
import { getMessages } from "@/lib/i18n/getMessages";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { toBcp47 } from "@/lib/i18n/bcp47";
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
   * is even a legal instruction: Shopify BLOCKS refunds once a chargeback is open.
   */
  phase: string | null;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

type T = (key: string, values?: Record<string, string | number>) => string;

function translator(locale: Locale, messages: Record<string, unknown>): T {
  const create = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => T;
  return create({ locale, messages, namespace: "email.fatalLoss" });
}

export interface RenderedFatalLossEmail {
  subject: string;
  html: string;
  text: string;
  locale: Locale;
}

/** Pure: the subject, HTML and text for one locale. */
export function renderFatalLossEmail(
  ctx: FatalLossAlertContext,
  opts: { locale: string | null | undefined; shopDomain: string | null },
  messages: Record<string, unknown>,
): RenderedFatalLossEmail {
  const locale: Locale = normalizeLocale(opts.locale ?? null) ?? DEFAULT_LOCALE;
  const t = translator(locale, messages);
  const bcp47 = toBcp47(locale);
  const isInquiry = (ctx.phase ?? "").toLowerCase() === "inquiry";
  const isInr = ctx.reason === "inr_no_fulfillment";
  const phase = isInquiry ? "inquiry" : "chargeback";
  const order = ctx.orderName ?? ctx.disputeId.slice(0, 8);
  const amountStr = ctx.amount != null && ctx.currencyCode ? `${ctx.currencyCode} ${ctx.amount}` : null;
  const dueStr = ctx.dueAt
    ? (() => {
        const d = new Date(ctx.dueAt);
        return Number.isFinite(d.getTime())
          ? new Intl.DateTimeFormat(bcp47, { dateStyle: "long", timeZone: "UTC" }).format(d)
          : ctx.dueAt;
      })()
    : "—";
  const disputeUrl = opts.shopDomain ? getEmbeddedAppUrl(opts.shopDomain, `/app/disputes/${ctx.disputeId}`) : null;

  const subject = t(
    isInr
      ? isInquiry ? "subjectInrInquiry" : "subjectInrChargeback"
      : isInquiry ? "subjectRefundedInquiry" : "subjectRefundedChargeback",
    { order },
  );

  const lead = t("lead", {
    phase,
    order,
    amountSuffix: amountStr ? ` (${amountStr})` : "",
    situation: t(isInr ? "situationInr" : "situationRefunded"),
  });

  const actions: string[] = isInr
    ? [
        t("actionShipped"),
        ...(isInquiry ? [t("actionNeverShippedInquiry")] : [t("actionNeverShippedChargeback"), t("actionWithdraw")]),
      ]
    : [t("actionNoAction"), t("actionRefundedBefore")];
  const notSent = t(isInr ? "notSentInr" : "notSentRefunded");

  /* The Shopify-scrape sentence is the load-bearing one: it is the difference
   * between "this case is unattended" and "this case is being argued badly on
   * your behalf, right now, unless you act". Never drop it, and never replace
   * it with "nothing has been filed" — that was the 2026-07-30 defect. */
  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;line-height:1.55;">
<p>${escapeHtml(t("greeting"))}</p>
<p>${inlineToHtml(lead)}</p>
<p><strong>${escapeHtml(t("whatToDo"))}</strong></p>
<ul style="padding-left:20px;margin-top:4px;">
${actions.map((a) => `<li style="margin-bottom:8px;">${inlineToHtml(a)}</li>`).join("\n")}
</ul>
<p>${inlineToHtml(notSent)}</p>
${disputeUrl ? `<p><a href="${escapeHtml(disputeUrl)}" style="color:#1F1F1F;">${escapeHtml(t("openDispute"))}</a></p>` : ""}
<table style="border-collapse:collapse;margin-top:12px;font-size:13px;">
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">${escapeHtml(t("reasonLabel"))}</td><td>${escapeHtml(ctx.disputeReason ?? "—")}</td></tr>
  <tr><td style="color:#64748B;padding:4px 12px 4px 0;">${escapeHtml(t("deadlineLabel"))}</td><td>${escapeHtml(dueStr)}</td></tr>
  ${opts.shopDomain ? `<tr><td style="color:#64748B;padding:4px 12px 4px 0;">${escapeHtml(t("shopLabel"))}</td><td>${escapeHtml(opts.shopDomain)}</td></tr>` : ""}
</table>
<p style="color:#94A3B8;font-size:12px;margin-top:24px;">${escapeHtml(t("signoff"))}</p>
</body></html>`;

  const text = [
    bodyToText(lead),
    "",
    `${t("whatToDo")}:`,
    ...actions.map((a) => `- ${bodyToText(a)}`),
    "",
    bodyToText(notSent),
    disputeUrl ? `\n${t("openDispute")}: ${disputeUrl}` : "",
    "",
    `${t("reasonLabel")}: ${ctx.disputeReason ?? "—"}`,
    `${t("deadlineLabel")}: ${dueStr}`,
  ].join("\n");

  return { subject, html, text, locale };
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
    .select("shop_domain, locale")
    .eq("id", ctx.shopId)
    .single();
  const shopDomain = shop?.shop_domain ?? null;
  const storeLocale = steps.store_profile?.payload?.storeLocale;
  const locale =
    (typeof storeLocale === "string" ? storeLocale : null) ??
    ((shop as { locale?: string | null } | null)?.locale ?? null);

  try {
    const messages = await getMessages(normalizeLocale(locale ?? null) ?? DEFAULT_LOCALE);
    const { subject, html, text } = renderFatalLossEmail(ctx, { locale, shopDomain }, messages);
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
