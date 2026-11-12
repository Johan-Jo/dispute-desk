/**
 * "Refund this order to resolve the inquiry" email (docs/plans/pending-refund-advice.plan.md, PR B).
 *
 * ALL copy is in messages/*.json under `email.refundAdvice` (CLAUDE.md rule 5): this file holds no
 * sentence. `renderRefundAdviceEmail` is pure (messages passed in) so every locale is testable without
 * I/O; `sendRefundAdviceAlert` loads the catalog, renders and sends through Resend.
 *
 * WHEN to send is NOT decided here: `lib/disputes/refundAdviceDecision.ts` decides, from a live read of the
 * order's refund state. This file only renders and delivers.
 */

import { Resend } from "resend";
import { createTranslator } from "next-intl";
import { getMessages } from "@/lib/i18n/getMessages";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { toBcp47 } from "@/lib/i18n/bcp47";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import { getEmbeddedAppUrl } from "./publicSiteUrl";
import { brandHeader, ctaButton, plateLayout } from "./digestShared";
import { bodyToHtml, bodyToText, escapeHtml } from "./messageBody";

export type RefundAdviceVariant = "none" | "failed";

export interface RefundAdviceEmailContext {
  to: string | string[];
  /** Raw locale string (shop store locale); normalised, falls back to the default. */
  locale: string | null | undefined;
  variant: RefundAdviceVariant;
  shopDomain: string | null;
  disputeId: string;
  orderName: string | null;
  /** The disputed amount, in the dispute's currency. */
  amount: number;
  currencyCode: string;
  dueAt: string | null;
}

type T = (key: string, values?: Record<string, string | number>) => string;

export interface RenderedRefundAdviceEmail {
  subject: string;
  html: string;
  text: string;
  locale: Locale;
}

function translator(locale: Locale, messages: Record<string, unknown>): T {
  const create = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => T;
  return create({ locale, messages, namespace: "email.refundAdvice" });
}

function formatMoney(bcp47: string, amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(bcp47, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatDay(bcp47: string, iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47, { dateStyle: "long", timeZone: "UTC" }).format(d);
}

/** Pure: the subject, HTML and text for one locale. */
export function renderRefundAdviceEmail(
  ctx: Omit<RefundAdviceEmailContext, "to">,
  messages: Record<string, unknown>,
): RenderedRefundAdviceEmail {
  const locale: Locale = normalizeLocale(ctx.locale ?? null) ?? DEFAULT_LOCALE;
  const t = translator(locale, messages);
  const bcp47 = toBcp47(locale);
  const failed = ctx.variant === "failed";
  const values = {
    order: ctx.orderName ?? "",
    amount: formatMoney(bcp47, ctx.amount, ctx.currencyCode),
    dueDate: formatDay(bcp47, ctx.dueAt),
  };

  const subject = t(failed ? "subjectFailed" : "subject", values);
  const title = t(failed ? "titleFailed" : "title", values);
  const body = t(failed ? "bodyFailed" : "body", values);
  const preheader = t(failed ? "preheaderFailed" : "preheader", values);
  const cta = t("cta");
  const url = getEmbeddedAppUrl(ctx.shopDomain, `disputes/${ctx.disputeId}`);

  const innerHtml = `${brandHeader(escapeHtml(t("eyebrow")))}
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em">${escapeHtml(title)}</h1>
    <div style="font-size:15px;color:#374151;line-height:1.6">${bodyToHtml(body)}</div>
    <div style="margin:28px 0 0">${ctaButton(escapeHtml(cta), url)}</div>`;

  const html = plateLayout({ innerHtml, previewText: escapeHtml(preheader), footerText: escapeHtml(t("footer")) });
  const text = `${title}\n\n${bodyToText(body)}\n\n${cta}: ${url}`;
  return { subject, html, text, locale };
}

export async function sendRefundAdviceAlert(
  ctx: RefundAdviceEmailContext,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const locale: Locale = normalizeLocale(ctx.locale ?? null) ?? DEFAULT_LOCALE;
    const messages = await getMessages(locale);
    const { subject, html, text } = renderRefundAdviceEmail(ctx, messages);
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      replyTo: DEFAULT_REPLY_TO,
      to: ctx.to,
      subject,
      html,
      text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
