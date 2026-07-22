/**
 * Send the post-build merchant evidence email.
 *
 * Triggered after a pack build. Two modes, chosen from what the pack already
 * collected (`ctx.presentFields`):
 *  - ask mode:    the dispute type benefits from evidence DisputeDesk can't
 *                 auto-collect (e.g. digital access logs) AND it isn't already
 *                 attached → prompt the merchant to upload the missing items.
 *  - review mode: everything we can collect is already on the pack (delivery
 *                 proof, support conversations, …) → a calm "ready to review"
 *                 note with no upload ask, so we never ask for evidence we have.
 *
 * Either way, a "We've already attached" block reassures the merchant about
 * what's already in the pack, derived from the same present-fields the asks
 * are suppressed against so it can never over-claim.
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

/** Dispute reasons where digital/manual evidence strengthens the case. */
const DIGITAL_EVIDENCE_REASONS = new Set([
  "PRODUCT_UNACCEPTABLE",
  "NOT_AS_DESCRIBED",
  "SUBSCRIPTION_CANCELED",
  "CREDIT_NOT_PROCESSED",
  "FRAUDULENT",
  "GENERAL",
]);

/** Dispute reasons where carrier/shipping proof strengthens the case. */
const SHIPPING_EVIDENCE_REASONS = new Set([
  "PRODUCT_NOT_RECEIVED",
  "FRAUDULENT",
]);

/**
 * Map each manual-evidence request type to the completeness checklist field(s)
 * that, when already collected, make the request redundant. If ANY listed
 * field is present in the pack, we DON'T ask the merchant to upload it.
 *
 * `digital_access_logs` is intentionally absent — DisputeDesk has no way to
 * auto-collect digital access logs from Shopify, so it is never suppressed.
 */
const SUPPRESS_IF_PRESENT: Record<string, string[]> = {
  carrier_delivery_proof: ["delivery_proof", "shipping_tracking"],
  support_conversations: ["customer_communication"],
};

export interface EvidenceNeededContext {
  to: string;
  shopName?: string;
  shopDomain?: string | null;
  disputeId: string;
  disputeReason: string | null;
  disputeAmount?: string | null;
  packId: string;
  /** Merchant's digital proof capability from store profile */
  digitalProof?: string;
  /** Merchant's store types from store profile (used to gate shipping asks) */
  storeTypes?: string[];
  /** Link to the dispute detail page */
  disputeUrl?: string;
  /**
   * Completeness fields already collected in the pack (e.g. "delivery_proof",
   * "customer_communication"). Used to suppress asks for evidence we already
   * have and to render the "already attached" reassurance block.
   */
  presentFields?: Set<string>;
  /**
   * True when Gorgias matched support conversations to this dispute that are
   * awaiting the merchant's approve/reject decision. Swaps the generic
   * "upload support conversations" ask for a "review matched conversations"
   * prompt that deep-links to the review section.
   */
  pendingSupportReview?: boolean;
  /** Number of matched conversations awaiting review (for the prompt copy). */
  pendingSupportCount?: number;
  /** Human order identifier (e.g. "#1234") for the subject line. */
  orderName?: string | null;
}

/**
 * Options for `getNeededEvidenceTypes` beyond the core reason/profile inputs.
 */
export interface NeededEvidenceOptions {
  /**
   * Completeness fields already collected in the pack (e.g. "delivery_proof",
   * "customer_communication"). Anything already satisfied is not requested.
   */
  presentFields?: Set<string>;
  /**
   * True when Gorgias matched support conversations to this dispute that are
   * awaiting the merchant's approve/reject decision (they are NOT yet in the
   * pack, so `customer_communication` is not set). In that case we swap the
   * generic "upload support conversations" ask for a "review the matched
   * conversations" ask — the merchant approves what we already found instead
   * of digging up threads from scratch.
   */
  pendingSupportReview?: boolean;
}

/**
 * Determine what manual evidence types should be requested based on
 * the dispute reason, the merchant's stated capabilities, and what
 * DisputeDesk has ALREADY collected for this pack.
 *
 * Shipping evidence is gated on the merchant selling physical goods —
 * a digital-only store will never have carrier proof to upload, even if
 * the issuer miscodes the dispute as PRODUCT_NOT_RECEIVED.
 *
 * `opts.presentFields` (the pack's already-collected completeness fields)
 * removes anything we already have: e.g. if delivery proof is on the pack we
 * don't ask the merchant to upload carrier proof, and if support comms are
 * attached (Gorgias-approved or Shopify timeline) we don't ask for support
 * conversations.
 *
 * `opts.pendingSupportReview` handles the in-between state: Gorgias matched
 * conversations exist but aren't approved yet — we ask the merchant to review
 * and approve them rather than to upload conversations from scratch.
 */
export function getNeededEvidenceTypes(
  reason: string | null,
  digitalProof?: string,
  storeTypes?: string[],
  opts?: NeededEvidenceOptions
): string[] {
  const presentFields = opts?.presentFields;
  const pendingSupportReview = opts?.pendingSupportReview ?? false;

  const needed: string[] = [];
  const r = (reason ?? "GENERAL").toUpperCase();
  const sellsPhysical = !!storeTypes?.includes("physical");

  // Digital evidence: access logs, usage records, download proof
  if (
    DIGITAL_EVIDENCE_REASONS.has(r) &&
    digitalProof &&
    digitalProof !== "no"
  ) {
    needed.push("digital_access_logs");
  }

  // Shipping evidence: carrier proof of delivery, signed delivery.
  // Only ask physical-goods merchants — digital/services/subscriptions
  // stores have nothing to upload here.
  if (SHIPPING_EVIDENCE_REASONS.has(r) && sellsPhysical) {
    needed.push("carrier_delivery_proof");
  }

  // Support conversations: always useful for disputed charges. When Gorgias
  // has already matched conversations awaiting approval, ask the merchant to
  // REVIEW those (approve/reject) rather than upload from scratch.
  if (DIGITAL_EVIDENCE_REASONS.has(r) || SHIPPING_EVIDENCE_REASONS.has(r)) {
    needed.push(
      pendingSupportReview ? "review_matched_conversations" : "support_conversations"
    );
  }

  // Drop anything we've already collected — don't ask a merchant to upload
  // evidence that is already in the pack. `review_matched_conversations` is
  // NOT suppressed by `customer_communication`: the whole point is that the
  // matched comms are pending approval and thus not yet a present field.
  if (!presentFields || presentFields.size === 0) return needed;
  return needed.filter((type) => {
    const satisfiers = SUPPRESS_IF_PRESENT[type];
    if (!satisfiers) return true; // no auto-collected equivalent
    return !satisfiers.some((f) => presentFields.has(f));
  });
}

/**
 * Check if a dispute warrants a manual evidence alert email at all.
 *
 * NOTE: This intentionally does NOT take `presentFields`. It answers "did this
 * dispute type ever warrant an evidence touchpoint?" — the caller still sends
 * a calm "ready to review" email when every ask has been auto-satisfied, so
 * the gate must not go silent just because nothing is left to upload.
 */
export function shouldSendEvidenceAlert(
  reason: string | null,
  digitalProof?: string,
  storeTypes?: string[]
): boolean {
  return getNeededEvidenceTypes(reason, digitalProof, storeTypes).length > 0;
}

const EVIDENCE_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  digital_access_logs: {
    label: "Digital access logs or usage records",
    hint: "Screenshots or exports of customer access logs, download records, or account activity",
  },
  carrier_delivery_proof: {
    label: "Carrier delivery proof",
    hint: "Signed delivery confirmation, carrier proof-of-delivery document, or delivery photo",
  },
  support_conversations: {
    label: "Customer support conversations",
    hint: "Email threads, chat logs, or support tickets related to this order",
  },
  // Distinct from support_conversations: we've already MATCHED conversations
  // (via Gorgias) and just need the merchant to approve/reject them. The hint
  // is overridden at render time with the actual pending count + deep link.
  review_matched_conversations: {
    label: "Review matched support conversations",
    hint: "We matched support conversations to this order — approve the ones that support your defence",
  },
};

/**
 * Human labels for completeness fields DisputeDesk has already collected —
 * used in the "We've already attached" reassurance block. Keyed by the same
 * canonical field keys the completeness engine emits. Multiple fields can map
 * to one label (delivery_proof + shipping_tracking both mean "delivery
 * confirmation"); we de-duplicate by label when rendering.
 */
const PRESENT_FIELD_LABELS: Record<string, string> = {
  delivery_proof: "Delivery confirmation & tracking",
  shipping_tracking: "Delivery confirmation & tracking",
  customer_communication: "Customer support conversations",
};

/**
 * Build the de-duplicated list of "already attached" evidence labels from the
 * pack's present fields, in a stable order.
 */
function alreadyAttachedLabels(presentFields?: Set<string>): string[] {
  if (!presentFields || presentFields.size === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const field of Object.keys(PRESENT_FIELD_LABELS)) {
    if (!presentFields.has(field)) continue;
    const label = PRESENT_FIELD_LABELS[field];
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
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
    ctx.digitalProof,
    ctx.storeTypes,
    {
      presentFields: ctx.presentFields,
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

  // "Already attached" reassurance — derived from the SAME present-fields the
  // asks were suppressed against, so it can never claim something we don't have.
  const attachedLabels = alreadyAttachedLabels(ctx.presentFields);
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
