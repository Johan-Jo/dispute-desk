/**
 * Send the post-build merchant evidence email.
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
 * A "We've already attached" block reassures the merchant — but ONLY lists
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
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

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

const EVIDENCE_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  carrier_delivery_proof: {
    label: "Carrier delivery proof",
    hint: "Signed delivery confirmation, carrier proof-of-delivery document, or delivery photo",
  },
  // Distinct from an upload: we've already MATCHED conversations (via Gorgias)
  // and just need the merchant to approve/reject them. The hint is overridden
  // at render time with the actual pending count + deep link.
  review_matched_conversations: {
    label: "Review matched support conversations",
    hint: "We matched support conversations to this order — approve the ones that support your defence",
  },
};

/**
 * Build the "already attached" labels from what the pack ACTUALLY has —
 * real delivery proof and/or real support conversations. Each entry is gated
 * on a content-verified boolean computed by the caller, so this block can
 * never claim evidence we don't hold.
 */
function alreadyAttachedLabels(ctx: EvidenceNeededContext): string[] {
  const out: string[] = [];
  if (ctx.hasRealDeliveryProof) out.push("Delivery confirmation & tracking");
  if (ctx.hasRealSupportComms) out.push("Customer support conversations");
  return out;
}

export async function sendEvidenceNeededAlert(
  ctx: EvidenceNeededContext
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping evidence alert");
    return { ok: false, error: "Email service not configured" };
  }

  const neededTypes = getNeededEvidenceTypes(
    ctx.disputeReason,
    undefined,
    ctx.storeTypes,
    {
      hasRealDeliveryProof: ctx.hasRealDeliveryProof,
      pendingSupportReview: ctx.pendingSupportReview,
    }
  );

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
    getEmbeddedAppUrl(
      ctx.shopDomain ?? null,
      `disputes/${ctx.disputeId}?section=gorgias-comms`
    );

  // Resolve label + hint per ask, overriding the review-conversations hint with
  // the actual pending count when we have it.
  const askInfo = (t: string): { label: string; hint: string } | null => {
    const info = EVIDENCE_TYPE_LABELS[t];
    if (!info) return null;
    if (t === "review_matched_conversations") {
      const n = ctx.pendingSupportCount ?? 0;
      const countPhrase =
        n > 0
          ? `${n} matched support conversation${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} waiting for your review`
          : "Matched support conversations are waiting for your review";
      return {
        label: info.label,
        hint: `${countPhrase} — approve the ones that support your defence.`,
      };
    }
    return info;
  };

  const evidenceList = neededTypes
    .map((t) => {
      const info = askInfo(t);
      return info ? `<li><strong>${info.label}</strong><br><span style="color:#6D7175;font-size:13px">${info.hint}</span></li>` : "";
    })
    .filter(Boolean)
    .join("");

  const evidenceListText = neededTypes
    .map((t) => {
      const info = askInfo(t);
      return info ? `- ${info.label}: ${info.hint}` : "";
    })
    .filter(Boolean)
    .join("\n");

  // When the only ask is to review matched conversations, point the CTA at the
  // Gorgias review section instead of the generic dispute page.
  const primaryUrl =
    neededTypes.length === 1 && neededTypes[0] === "review_matched_conversations"
      ? gorgiasReviewUrl
      : disputeUrl;

  // "Already attached" reassurance — derived from content-verified booleans
  // (real delivery proof / real support comms), so it can never claim
  // something we don't actually have.
  const attachedLabels = alreadyAttachedLabels(ctx);
  const attachedListHtml = attachedLabels
    .map((l) => `<li>${l}</li>`)
    .join("");
  const attachedListText = attachedLabels.map((l) => `- ${l}`).join("\n");

  const amountStr = ctx.disputeAmount ? ` ($${ctx.disputeAmount})` : "";
  const shopLabel = ctx.shopName ?? "your store";
  const reasonLabel = (ctx.disputeReason ?? "dispute")
    .replace(/_/g, " ")
    .toLowerCase();
  const orderLabel = ctx.orderName ? ` for order ${ctx.orderName}` : "";

  const subject = isReviewMode
    ? `Evidence pack ready to review${orderLabel ? `: order ${ctx.orderName}` : ""} — ${reasonLabel} dispute${amountStr}`
    : `Action needed: upload evidence${orderLabel} — ${reasonLabel} dispute${amountStr}`;

  const heading = isReviewMode
    ? "Your evidence pack is ready to review"
    : "Manual evidence needed";

  const intro = isReviewMode
    ? `A <strong>${reasonLabel}</strong> dispute${amountStr}${orderLabel} for ${shopLabel} has been processed. DisputeDesk has collected all the evidence it can from Shopify${attachedLabels.length ? " and your connected tools" : ""} — no upload is needed. Review the pack when you have a moment.`
    : `A <strong>${reasonLabel}</strong> dispute${amountStr}${orderLabel} for ${shopLabel} has been processed. DisputeDesk has collected available Shopify data, but this dispute type benefits from additional evidence that must be uploaded manually.`;

  // "Already attached" block (HTML) — shown whenever we have something.
  const attachedBlockHtml = attachedLabels.length
    ? `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:#065F46;margin:0 0 10px">
          We've already attached:
        </p>
        <ul style="margin:0;padding-left:18px;color:#202223;font-size:14px;line-height:1.8">
          ${attachedListHtml}
        </ul>
      </div>`
    : "";

  // When every remaining ask is just "review the matched conversations", frame
  // the block + CTA around reviewing rather than uploading.
  const onlyReviewAsk =
    !isReviewMode &&
    neededTypes.every((t) => t === "review_matched_conversations");
  const askBlockTitle = onlyReviewAsk
    ? "Waiting for your review:"
    : "Please upload the following:";

  // Upload-ask block (HTML) — only in ask mode.
  const askBlockHtml = isReviewMode
    ? ""
    : `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 10px">
          ${askBlockTitle}
        </p>
        <ul style="margin:0;padding-left:18px;color:#202223;font-size:14px;line-height:1.8">
          ${evidenceList}
        </ul>
      </div>`;

  const ctaLabel = isReviewMode
    ? "Review dispute →"
    : onlyReviewAsk
      ? "Review matched conversations →"
      : "View dispute &amp; upload evidence →";

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
        ${heading}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${intro}
      </p>

      ${attachedBlockHtml}
      ${askBlockHtml}

      <a href="${primaryUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${ctaLabel}
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      This email was sent because you enabled evidence alerts in DisputeDesk setup.
      You can change notification preferences in Settings.
    </p>
  </div>
</body>
</html>`.trim();

  const attachedTextBlock = attachedLabels.length
    ? `\nWe've already attached:\n${attachedListText}\n`
    : "";

  const askTextBlock = isReviewMode
    ? ""
    : `\n${askBlockTitle}\n${evidenceListText}\n`;

  const ctaTextLabel = isReviewMode
    ? "Review dispute"
    : onlyReviewAsk
      ? "Review matched conversations"
      : "View dispute and upload evidence";

  const text = `${heading}

A ${reasonLabel} dispute${amountStr}${orderLabel} for ${shopLabel} has been processed.
${
    isReviewMode
      ? "DisputeDesk has collected all the evidence it can — no upload is needed."
      : "DisputeDesk has collected available Shopify data, but this dispute needs additional evidence:"
  }
${attachedTextBlock}${askTextBlock}
${ctaTextLabel}: ${primaryUrl}

---
This email was sent because you enabled evidence alerts in DisputeDesk setup.`;

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
    console.error("[email] Evidence alert send failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
