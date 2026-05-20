/**
 * Send "outcome posted" email to the merchant.
 *
 * Triggered by `dispatchDisputeEffects` when an `OUTCOME_DETECTED` event
 * fires — i.e. Shopify's `finalized_on` (per the dispute webhook /
 * GraphQL) flipped from null to a timestamp and the local dispute row
 * gained a `final_outcome`.
 *
 * Three variants by outcome:
 *   - "won"      → "You won this chargeback."
 *   - "lost"     → "This chargeback was lost." (no shame copy; bank's
 *                  decision is informational, not a merchant fault)
 *   - "accepted" → "You accepted the chargeback." (or any other
 *                  terminal that isn't won/lost — collapses to "closed
 *                  without DisputeDesk response")
 *
 * Effect-level idempotency is handled by the dispatcher
 * (`withEffectDedup` on the OUTCOME_DETECTED event key). This helper
 * does NOT add a per-dispute claim guard because the dispatcher
 * already guarantees single-fire.
 *
 * Fire-and-forget — never throws. Gated by the team `outcome`
 * notification preference (new key, defaults to true).
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export type OutcomeVariant = "won" | "lost" | "accepted";

export interface OutcomePostedAlertContext {
  shopId: string;
  disputeId: string;
  /** Mapped from the raw Shopify outcome. The caller is responsible for
   *  normalising; this helper trusts the input. */
  outcome: OutcomeVariant;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
  orderName: string | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface VariantStrings {
  subject: (p: { shortId: string; orderName: string | null }) => string;
  heading: string;
  /** Body paragraphs, joined into `<p>` blocks in render. Splitting at the
   *  data layer keeps the prose readable in source and lets each variant
   *  control its own paragraphing without HTML escaping tricks. */
  body: string[];
  /** Label of the amount row — context-specific so a "won" email surfaces
   *  "Amount protected" vs. a "lost" email's "Amount lost." Aligns with
   *  the variant's emotional register. */
  amountLabel: string;
  cta: string;
  /** One-line summary rendered as a small caption inside the card,
   *  below the CTA — gives the merchant a scannable "what just
   *  happened" line they can take in at a glance. Optional. */
  resultLine?: string;
}

interface LocaleStrings {
  won: VariantStrings;
  lost: VariantStrings;
  accepted: VariantStrings;
  shared: {
    reason: string;
    order: string;
    footer: string;
  };
}

// English is the primary; other locales fall back here per the same
// rule the new-dispute alert uses. Translations can land in a follow-up
// (the message bundle is structurally identical to the new-dispute
// alert, so a future copy run can pick them up together).
const STRINGS: Record<Locale, LocaleStrings> = {
  en: {
    shared: {
      reason: "Reason",
      order: "Order",
      footer:
        "You're receiving this because outcome notifications are enabled for your DisputeDesk team. Manage your preferences in the embedded app under Team settings.",
    },
    // Three emotional registers, deliberately distinct:
    //   - won: celebratory + confident
    //   - lost: calm + factual, no blame language
    //   - accepted: operational + neutral; no jargon
    won: {
      subject: ({ shortId, orderName }) =>
        `You won the chargeback on ${orderName ?? `dispute ${shortId}`}`,
      heading: "You won this chargeback",
      body: [
        "Good news — the card network accepted your defence package and ruled this dispute in your favour.",
        "The disputed amount remains with you, and any temporary debit should be reversed by your processor according to their normal payout timing.",
        "Your case record stays in DisputeDesk, including the evidence submitted, timeline, and outcome, so your team can review what worked and reuse the pattern for future disputes.",
      ],
      amountLabel: "Amount protected",
      cta: "View winning case",
      resultLine: "Result: Defence accepted · Funds retained",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `This chargeback was lost — ${orderName ?? `dispute ${shortId}`}`,
      heading: "This chargeback was not won",
      body: [
        "The card network sided with the cardholder, and the disputed amount has been deducted from your payout.",
        "This decision is final for this dispute, so there is no further action to take. The case will remain in DisputeDesk with the submitted evidence, timeline, and outcome so your team can review what happened and identify ways to strengthen future defences.",
      ],
      amountLabel: "Amount lost",
      cta: "Review the case",
      resultLine: "Result: Cardholder won · Funds deducted",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Chargeback closed on ${orderName ?? `dispute ${shortId}`}`,
      heading: "This chargeback has closed",
      body: [
        "This dispute has now closed without a submitted defence response. The disputed amount has settled with the cardholder.",
        "There is nothing further to do on this case, but DisputeDesk will keep the record available so your team can review the timeline, see what evidence was available, and improve future dispute handling.",
      ],
      amountLabel: "Amount settled with cardholder",
      cta: "View case record",
      resultLine: "Result: Closed · No defence submitted",
    },
  },
  // Non-English locales fall back to English copy for now. Locale keys
  // present so resolveLocale never hits undefined.
  es: null as unknown as LocaleStrings,
  pt: null as unknown as LocaleStrings,
  fr: null as unknown as LocaleStrings,
  de: null as unknown as LocaleStrings,
  sv: null as unknown as LocaleStrings,
};
// Backfill non-en locales with en strings until proper translations land.
for (const k of ["es", "pt", "fr", "de", "sv"] as const) {
  STRINGS[k] = STRINGS.en;
}

function resolveLocale(storeLocale: string | null): Locale {
  if (!storeLocale) return "en";
  const lower = storeLocale.toLowerCase();
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("sv")) return "sv";
  return "en";
}

function formatCurrency(
  amount: number | null,
  currencyCode: string | null,
): string {
  if (amount === null) return "—";
  const code = currencyCode ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function shortDisputeId(disputeId: string): string {
  return disputeId.slice(0, 8).toUpperCase();
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  // Map a few common Shopify reason codes to friendlier labels. Falls
  // back to a Title-Case rendering for everything else.
  const known: Record<string, string> = {
    FRAUDULENT: "Unauthorized transaction",
    UNRECOGNIZED: "Unrecognized charge",
    PRODUCT_NOT_RECEIVED: "Product not received",
    DUPLICATE: "Duplicate charge",
    CREDIT_NOT_PROCESSED: "Refund not processed",
    SUBSCRIPTION_CANCELED: "Subscription canceled",
  };
  if (known[reason]) return known[reason];
  return reason
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function sendOutcomePostedAlert(
  ctx: OutcomePostedAlertContext,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn(
      "[outcomePosted] RESEND_API_KEY not set — skipping outcome email",
    );
    return;
  }

  try {
    const sb = getServiceClient();

    const { data: setup } = await sb
      .from("shop_setup")
      .select("steps")
      .eq("shop_id", ctx.shopId)
      .single();

    const steps = setup?.steps as Record<
      string,
      { payload?: Record<string, unknown> }
    > | null;

    const teamPayload = steps?.team?.payload;
    // New notification preference key. Default-on so existing shops
    // start receiving outcome emails without opt-in friction. Merchants
    // can turn it off in Team settings (see Phase 5 follow-up — the
    // setting UI may not exist yet, but the data path is ready).
    const notifications = teamPayload?.notifications as {
      newDispute?: boolean;
      outcome?: boolean;
    } | null;
    if (notifications?.outcome === false) return;

    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) return;

    const storeLocale =
      (steps?.store_profile?.payload?.storeLocale as string | undefined) ?? null;
    const locale = resolveLocale(storeLocale);
    const s = STRINGS[locale];
    const variant = s[ctx.outcome];

    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", ctx.shopId)
      .single();

    const disputeUrl = getEmbeddedAppUrl(
      shop?.shop_domain ?? null,
      `disputes/${ctx.disputeId}`,
    );

    const shortId = shortDisputeId(ctx.disputeId);
    const subject = `[DisputeDesk] ${variant.subject({
      shortId,
      orderName: ctx.orderName,
    })}`;

    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const orderNameDisplay = ctx.orderName ?? "—";

    // Outcome-tinted accent. Won = green; lost = muted red; accepted =
    // neutral grey. Subtle — the email is informational, not
    // celebratory or scolding.
    const accent =
      ctx.outcome === "won"
        ? "#0C5132"
        : ctx.outcome === "lost"
          ? "#8B1F19"
          : "#4A4A4A";

    const html = `<!DOCTYPE html>
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

      <h1 style="font-size:20px;font-weight:600;color:${accent};margin:0 0 12px">
        ${variant.heading}
      </h1>
      ${variant.body
        .map(
          (p) =>
            `<p style="font-size:14px;color:#202223;margin:0 0 12px;line-height:1.55">${p}</p>`,
        )
        .join("")}

      <table style="width:100%;border-collapse:collapse;margin:18px 0 20px;font-size:13px" role="presentation">
        <tr><td style="padding:6px 0;color:#5C5F62;width:38%">${s.shared.order}</td><td style="padding:6px 0;color:#202223">${orderNameDisplay}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${s.shared.reason}</td><td style="padding:6px 0;color:#202223">${reason}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${variant.amountLabel}</td><td style="padding:6px 0;color:#202223;font-weight:600">${amountStr}</td></tr>
      </table>

      <a href="${disputeUrl}" style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
        ${variant.cta}
      </a>

      ${
        variant.resultLine
          ? `<p style="font-size:12px;color:${accent};margin:16px 0 0;line-height:1.5;font-weight:500;letter-spacing:0.01em">${variant.resultLine}</p>`
          : ""
      }
    </div>
    <p style="font-size:11px;color:#8A8A8A;text-align:center;margin:8px 0 0;line-height:1.5">
      ${s.shared.footer}
    </p>
  </div>
</body>
</html>`;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: teamEmail.includes(",")
        ? teamEmail.split(",").map((s) => s.trim()).filter(Boolean)
        : teamEmail,
      subject,
      html,
    });
  } catch (err) {
    console.warn(
      `[outcomePosted] failed to send: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
