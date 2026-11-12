/**
 * Send the post-build merchant evidence email.
 *
 * ALL copy lives in messages/*.json under `email.evidenceNeeded` (CLAUDE.md rule 5); this file holds no
 * sentence. `renderEvidenceNeededEmail` is pure (messages passed in) so every locale is testable without I/O.
 * Until 2026-11-13 this email was hard-coded English, and showed the disputed amount with a "$" whatever the
 * dispute currency.
 *
 * Triggered after a pack build. Two modes, chosen from what DisputeDesk
 * ACTUALLY has for the dispute (real, verified content — not mere checklist
 * presence):
 *  - ask mode:    something genuinely manual is missing — carrier delivery
 *                 proof we couldn't auto-find (physical shipping disputes), or
 *                 Gorgias-matched conversations awaiting the merchant's
 *                 approve/reject decision → a targeted prompt.
 *  - review mode: nothing manual is genuinely needed → a calm "ready to
 *                 review" note, no ask.
 *
 * An "already attached" block reassures the merchant — but ONLY lists
 * evidence we actually have (real delivery confirmation, real support
 * conversations), never something we merely have a structural checklist row
 * for. This email must never claim to have attached evidence it doesn't have.
 *
 * IMPORTANT — do not reintroduce a "digital access logs / usage records" ask.
 * That maps to nothing manual: the equivalent (`activity_log` →
 * `accessActivityLog`) is auto-collected for every order, so it's neither
 * uploadable by the merchant nor missing. It was removed 2026-07-22.
 *
 * Fire-and-forget — never throws; callers should log failures without blocking.
 */

import { Resend } from "resend";
import { createTranslator } from "next-intl";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import { bodyToText, escapeHtml, inlineToHtml } from "@/lib/email/messageBody";
import { getMessages } from "@/lib/i18n/getMessages";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { toBcp47 } from "@/lib/i18n/bcp47";
import { resolveDisputeTypeLabel } from "@/lib/disputes/reasonLabel";

/**
 * Dispute reasons where carrier/shipping delivery proof is a relevant manual
 * ask (only when we couldn't auto-collect it and the store ships physical
 * goods). These are the only reasons where "upload delivery proof" makes
 * sense as a merchant action.
 */
const SHIPPING_EVIDENCE_REASONS = new Set([
  "PRODUCT_NOT_RECEIVED",
  "FRAUDULENT",
]);

export interface EvidenceNeededContext {
  to: string;
  shopName?: string;
  shopDomain?: string | null;
  disputeId: string;
  disputeReason: string | null;
  disputeAmount?: string | null;
  /** ISO currency of the dispute; with it the amount is formatted in the merchant's locale. */
  disputeCurrency?: string | null;
  /** The merchant's store locale (`shop_setup.store_profile.storeLocale`); unknown falls back to English. */
  locale?: string | null;
  packId: string;
  /** Merchant's store types from store profile (gates the shipping ask). */
  storeTypes?: string[];
  /** Link to the dispute detail page */
  disputeUrl?: string;
  /**
   * True when the pack has REAL delivery proof (a fulfillment section whose
   * proofType is delivered_confirmed / signature_confirmed — categorized
   * moderate/strong, not a bare label). Drives both ask-suppression and the
   * "already attached" line. Computed by the caller from actual section data,
   * NOT from checklist field-presence.
   */
  hasRealDeliveryProof?: boolean;
  /**
   * True when the pack has REAL support conversations — a Gorgias section with
   * approved messages, or a Shopify-timeline comms section with genuine human
   * authorship (staff note / customer note / merchant comment). Marketing-app
   * buyer attributes and system timeline events do NOT count. Computed by the
   * caller from actual section data, NOT from checklist field-presence.
   */
  hasRealSupportComms?: boolean;
  /**
   * True when Gorgias matched support conversations to this dispute that are
   * awaiting the merchant's approve/reject decision. Surfaces a "review matched
   * conversations" prompt that deep-links to the review section.
   */
  pendingSupportReview?: boolean;
  /** Number of matched conversations awaiting review (for the prompt copy). */
  pendingSupportCount?: number;
  /** Human order identifier (e.g. "#1234") for the subject line. */
  orderName?: string | null;
}

/**
 * Options for `getNeededEvidenceTypes` — the REAL, content-verified state of
 * the pack (not checklist field-presence).
 */
export interface NeededEvidenceOptions {
  /** Pack has real delivery proof (moderate/strong), so don't ask for it. */
  hasRealDeliveryProof?: boolean;
  /**
   * Gorgias matched conversations exist but aren't approved yet → ask the
   * merchant to review/approve them (not upload from scratch).
   */
  pendingSupportReview?: boolean;
}

/**
 * Determine what GENUINELY-MANUAL, GENUINELY-MISSING evidence to ask for.
 *
 * The app auto-collects nearly everything (order/transaction record, AVS/CVV,
 * IP, activity log, fraud screening, tracking, delivery, policies). The only
 * things worth asking a merchant for are:
 *  - carrier delivery proof, when we couldn't auto-find delivery/tracking AND
 *    the store ships physical goods AND the reason is a shipping reason; and
 *  - reviewing Gorgias-matched conversations that are awaiting approval.
 *
 * There is deliberately NO "digital access logs / usage records" ask — that
 * maps to nothing manual and is auto-collected (see module header).
 */
export function getNeededEvidenceTypes(
  reason: string | null,
  _digitalProof?: string,
  storeTypes?: string[],
  opts?: NeededEvidenceOptions
): string[] {
  const hasRealDeliveryProof = opts?.hasRealDeliveryProof ?? false;
  const pendingSupportReview = opts?.pendingSupportReview ?? false;

  const needed: string[] = [];
  const r = (reason ?? "GENERAL").toUpperCase();
  const sellsPhysical = !!storeTypes?.includes("physical");

  // Carrier delivery proof — only when we DON'T already have real delivery
  // proof, the store ships physical goods, and the reason is shipping-related.
  if (
    SHIPPING_EVIDENCE_REASONS.has(r) &&
    sellsPhysical &&
    !hasRealDeliveryProof
  ) {
    needed.push("carrier_delivery_proof");
  }

  // Gorgias matched conversations awaiting the merchant's approve/reject
  // decision — the one legitimate manual comms action.
  if (pendingSupportReview) {
    needed.push("review_matched_conversations");
  }

  return needed;
}

/**
 * Check if a dispute warrants an evidence email at all.
 *
 * The email is a per-dispute touchpoint after a successful build; we always
 * send it (subject to the notification pref + dedupe in the caller) so the
 * merchant gets either a targeted ask or a calm "ready to review" note. The
 * caller owns those gates; this remains true so the touchpoint is never
 * silently dropped.
 */
export function shouldSendEvidenceAlert(
  _reason: string | null,
  _digitalProof?: string,
  _storeTypes?: string[]
): boolean {
  return true;
}

type T = (key: string, values?: Record<string, string | number>) => string;

function create(locale: Locale, messages: Record<string, unknown>, namespace: string): T {
  const make = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => T;
  return make({ locale, messages, namespace });
}

export interface RenderedEvidenceNeededEmail {
  subject: string;
  html: string;
  text: string;
  locale: Locale;
}

/** Pure: the subject, HTML and text for one locale. */
export function renderEvidenceNeededEmail(
  ctx: Omit<EvidenceNeededContext, "to">,
  messages: Record<string, unknown>,
): RenderedEvidenceNeededEmail {
  const locale: Locale = normalizeLocale(ctx.locale ?? null) ?? DEFAULT_LOCALE;
  const t = create(locale, messages, "email.evidenceNeeded");
  const tPacks = create(locale, messages, "packs");
  const bcp47 = toBcp47(locale);

  const neededTypes = getNeededEvidenceTypes(ctx.disputeReason, undefined, ctx.storeTypes, {
    hasRealDeliveryProof: ctx.hasRealDeliveryProof,
    pendingSupportReview: ctx.pendingSupportReview,
  });

  // Two modes:
  //  - ask mode:    at least one item is genuinely missing → prompt an upload
  //                 (or, for matched-but-pending comms, a review).
  //  - review mode: everything DisputeDesk can collect is already attached →
  //                 a calm "your evidence pack is ready to review" note, no ask.
  const isReviewMode = neededTypes.length === 0;

  const disputeUrl =
    ctx.disputeUrl ?? getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}`);
  // Deep link that spotlights the Gorgias review section (matches the CTA in
  // sendGorgiasEvidenceReadyAlert), used for the "review matched conversations"
  // ask so the merchant lands directly on the approve/reject UI.
  const gorgiasReviewUrl =
    ctx.disputeUrl ??
    getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}?section=gorgias-comms`);

  // When the only ask is to review matched conversations, point the CTA at the
  // Gorgias review section instead of the generic dispute page.
  const primaryUrl =
    neededTypes.length === 1 && neededTypes[0] === "review_matched_conversations"
      ? gorgiasReviewUrl
      : disputeUrl;

  // Resolve label + hint per ask, with the actual pending count when we have it.
  const askInfo = (type: string): { label: string; hint: string } | null => {
    if (type === "carrier_delivery_proof") {
      return { label: t("typeCarrierLabel"), hint: t("typeCarrierHint") };
    }
    if (type === "review_matched_conversations") {
      const n = ctx.pendingSupportCount ?? 0;
      return {
        label: t("typeReviewLabel"),
        hint: n > 0 ? t("typeReviewHintCount", { count: n }) : t("typeReviewHintNone"),
      };
    }
    return null;
  };
  const asks = neededTypes.map(askInfo).filter((a): a is { label: string; hint: string } => a !== null);

  // "Already attached" reassurance — derived from content-verified booleans
  // (real delivery proof / real support comms), so it can never claim
  // something we don't actually have.
  const attachedLabels: string[] = [];
  if (ctx.hasRealDeliveryProof) attachedLabels.push(t("attachedDelivery"));
  if (ctx.hasRealSupportComms) attachedLabels.push(t("attachedComms"));

  const amountPart = (() => {
    if (!ctx.disputeAmount) return "";
    const n = Number(ctx.disputeAmount);
    if (ctx.disputeCurrency && Number.isFinite(n)) {
      try {
        return ` (${new Intl.NumberFormat(bcp47, { style: "currency", currency: ctx.disputeCurrency }).format(n)})`;
      } catch {
        /* unknown currency code: fall through to the plain amount */
      }
    }
    return ` (${ctx.disputeAmount}${ctx.disputeCurrency ? ` ${ctx.disputeCurrency}` : ""})`;
  })();
  const values = {
    hasOrder: ctx.orderName ? "yes" : "no",
    order: ctx.orderName ?? "",
    reason: resolveDisputeTypeLabel((k) => tPacks(k), ctx.disputeReason),
    amountPart,
    shop: ctx.shopName ?? t("shopFallback"),
    withTools: attachedLabels.length ? "yes" : "no",
  };

  const subject = t(isReviewMode ? "subjectReview" : "subjectAsk", values);
  const heading = t(isReviewMode ? "headingReview" : "headingAsk");
  const intro = t(isReviewMode ? "introReview" : "introAsk", values);

  // When every remaining ask is just "review the matched conversations", frame
  // the block + CTA around reviewing rather than uploading.
  const onlyReviewAsk = !isReviewMode && neededTypes.every((x) => x === "review_matched_conversations");
  const askBlockTitle = t(onlyReviewAsk ? "askTitleReview" : "askTitleUpload");
  const ctaLabel = t(isReviewMode ? "ctaReview" : onlyReviewAsk ? "ctaReviewConversations" : "ctaUpload");

  const attachedBlockHtml = attachedLabels.length
    ? `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:#065F46;margin:0 0 10px">
          ${escapeHtml(t("attachedTitle"))}
        </p>
        <ul style="margin:0;padding-left:18px;color:#202223;font-size:14px;line-height:1.8">
          ${attachedLabels.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const askBlockHtml = isReviewMode
    ? ""
    : `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 10px">
          ${escapeHtml(askBlockTitle)}
        </p>
        <ul style="margin:0;padding-left:18px;color:#202223;font-size:14px;line-height:1.8">
          ${asks
            .map((a) => `<li><strong>${escapeHtml(a.label)}</strong><br><span style="color:#6D7175;font-size:13px">${escapeHtml(a.hint)}</span></li>`)
            .join("")}
        </ul>
      </div>`;

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
        ${escapeHtml(heading)}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${inlineToHtml(intro)}
      </p>

      ${attachedBlockHtml}
      ${askBlockHtml}

      <a href="${escapeHtml(primaryUrl)}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${escapeHtml(ctaLabel)}
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      ${escapeHtml(t("footer"))}
    </p>
  </div>
</body>
</html>`.trim();

  const text = [
    heading,
    "",
    bodyToText(intro),
    attachedLabels.length ? `\n${t("attachedTitle")}\n${attachedLabels.map((l) => `- ${l}`).join("\n")}` : "",
    isReviewMode ? "" : `\n${askBlockTitle}\n${asks.map((a) => `- ${a.label}: ${a.hint}`).join("\n")}`,
    "",
    `${ctaLabel}: ${primaryUrl}`,
    "",
    "---",
    t("footer"),
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  return { subject, html, text, locale };
}

export async function sendEvidenceNeededAlert(
  ctx: EvidenceNeededContext
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping evidence alert");
    return { ok: false, error: "Email service not configured" };
  }

  try {
    const locale: Locale = normalizeLocale(ctx.locale ?? null) ?? DEFAULT_LOCALE;
    const messages = await getMessages(locale);
    const { subject, html, text } = renderEvidenceNeededEmail(ctx, messages);
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      replyTo: DEFAULT_REPLY_TO,
      to: ctx.to.includes(",") ? ctx.to.split(",").map((e) => e.trim()) : ctx.to,
      subject,
      html,
      text,
    });
    if (error) {
      console.error("[email] Evidence alert send failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] Evidence alert render/send failed:", message);
    return { ok: false, error: message };
  }
}
