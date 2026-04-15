/**
 * Send "manual evidence needed" email to the merchant.
 *
 * Triggered after a pack build when the dispute type requires evidence
 * that DisputeDesk cannot auto-collect from Shopify (e.g. digital access
 * logs, carrier proof, support conversations).
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
  /** Merchant's delivery proof capability from store profile */
  deliveryProof?: string;
  /** Link to the dispute detail page */
  disputeUrl?: string;
}

/**
 * Determine what manual evidence types should be requested based on
 * the dispute reason and the merchant's stated capabilities.
 */
export function getNeededEvidenceTypes(
  reason: string | null,
  digitalProof?: string,
  deliveryProof?: string
): string[] {
  const needed: string[] = [];
  const r = (reason ?? "GENERAL").toUpperCase();

  // Digital evidence: access logs, usage records, download proof
  if (
    DIGITAL_EVIDENCE_REASONS.has(r) &&
    digitalProof &&
    digitalProof !== "no"
  ) {
    needed.push("digital_access_logs");
  }

  // Shipping evidence: carrier proof of delivery, signed delivery
  if (
    SHIPPING_EVIDENCE_REASONS.has(r) &&
    deliveryProof &&
    deliveryProof !== "rarely"
  ) {
    needed.push("carrier_delivery_proof");
  }

  // Support conversations: always useful for disputed charges
  if (DIGITAL_EVIDENCE_REASONS.has(r) || SHIPPING_EVIDENCE_REASONS.has(r)) {
    needed.push("support_conversations");
  }

  return needed;
}

/**
 * Check if a dispute warrants a manual evidence alert email.
 */
export function shouldSendEvidenceAlert(
  reason: string | null,
  digitalProof?: string,
  deliveryProof?: string
): boolean {
  return getNeededEvidenceTypes(reason, digitalProof, deliveryProof).length > 0;
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
};

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
    ctx.deliveryProof
  );

  if (neededTypes.length === 0) {
    return { ok: true }; // Nothing to request
  }

  const disputeUrl =
    ctx.disputeUrl ?? getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}`);

  const evidenceList = neededTypes
    .map((t) => {
      const info = EVIDENCE_TYPE_LABELS[t];
      return info ? `<li><strong>${info.label}</strong><br><span style="color:#6D7175;font-size:13px">${info.hint}</span></li>` : "";
    })
    .filter(Boolean)
    .join("");

  const evidenceListText = neededTypes
    .map((t) => {
      const info = EVIDENCE_TYPE_LABELS[t];
      return info ? `- ${info.label}: ${info.hint}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const amountStr = ctx.disputeAmount ? ` ($${ctx.disputeAmount})` : "";
  const shopLabel = ctx.shopName ?? "your store";
  const reasonLabel = (ctx.disputeReason ?? "dispute")
    .replace(/_/g, " ")
    .toLowerCase();

  const subject = `Action needed: Upload evidence for ${reasonLabel} dispute${amountStr}`;

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
        Manual evidence needed
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        A <strong>${reasonLabel}</strong> dispute${amountStr} for ${shopLabel} has been processed.
        DisputeDesk has collected available Shopify data, but this dispute type benefits from
        additional evidence that must be uploaded manually.
      </p>

      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 10px">
          Please upload the following:
        </p>
        <ul style="margin:0;padding-left:18px;color:#202223;font-size:14px;line-height:1.8">
          ${evidenceList}
        </ul>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        View dispute &amp; upload evidence →
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      This email was sent because you enabled evidence alerts in DisputeDesk setup.
      You can change notification preferences in Settings.
    </p>
  </div>
</body>
</html>`.trim();

  const text = `Manual evidence needed

A ${reasonLabel} dispute${amountStr} for ${shopLabel} has been processed.
DisputeDesk has collected available Shopify data, but this dispute needs additional evidence:

${evidenceListText}

View dispute and upload evidence: ${disputeUrl}

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
