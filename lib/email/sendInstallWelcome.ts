/**
 * Send the App Store install welcome email to a newly installed merchant.
 *
 * Fires from `onNewShopCreated`, so it covers BOTH install paths (OAuth
 * callback and Session Token Exchange) and is held to that by the
 * `newShopSideEffects` CI invariant.
 *
 * ## Recipient
 *
 * The Shopify shop-owner address (`Shop.contactEmail ?? Shop.email`), because
 * this fires at install time and the merchant-configured alert address
 * (`shop_setup.steps.team.payload.teamEmail`, the Settings page field) does not
 * exist yet — `ensureShopSetup` seeds only the `permissions` step. Measured on
 * real installs, `teamEmail` lands 2.5 minutes (Mein Maison) to 24 minutes
 * (isj-153) after the shops row is created. Waiting for it would mean not
 * sending at install; using it here would mean sending to nobody.
 *
 * ## Idempotency
 *
 * Claimed with a conditional `UPDATE ... WHERE welcome_email_sent_at IS NULL`
 * that returns the row only if THIS call won the claim. Two concurrent installs
 * therefore cannot both send, and a reinstall on a reused `shops` row never
 * re-sends. The claim is written BEFORE the send: a lost email is better than a
 * duplicate one, and the failure is logged either way.
 *
 * Never throws — a welcome-email failure must not break an install.
 */

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import type { Locale } from "@/lib/i18n/locales";
import {
  generateInstallWelcomeEmailHTML,
  generateInstallWelcomeEmailText,
  getInstallWelcomeSubject,
} from "./installWelcomeTemplate";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
/** Reply-To is a real inbox: the copy tells merchants replying reaches a person. */
const REPLY_TO = DEFAULT_REPLY_TO;

export interface SendInstallWelcomeOptions {
  /** Internal `shops.id` — used for the idempotency claim. */
  shopInternalId: string;
  /** The merchant's myshopify domain, for the embedded-app deep link. */
  shopDomain: string;
  /** Shop-owner email from Shopify. When absent we cannot send. */
  to?: string | null;
  /** Merchant-facing store name; greeting degrades gracefully when absent. */
  shopName?: string | null;
  locale?: Locale;
}

type SendResult =
  | { ok: true }
  | { ok: false; reason: "no_api_key" | "no_recipient" | "already_sent" | "send_failed"; error?: string };

export async function sendInstallWelcomeEmail(
  options: SendInstallWelcomeOptions,
): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn("[email:install-welcome] RESEND_API_KEY not set — skipping");
    return { ok: false, reason: "no_api_key" };
  }

  const to = options.to?.trim();
  if (!to) {
    // Shopify gave us no owner address (commonly the enrichment 401 on a
    // fresh install). Guessing one would be worse than not sending.
    console.warn(
      "[email:install-welcome] no shop-owner email available — skipping",
      { shopDomain: options.shopDomain },
    );
    return { ok: false, reason: "no_recipient" };
  }

  // Atomically claim the send. `.select()` returns the updated rows, so an
  // empty result means another call already claimed it.
  const db = getServiceClient();
  const { data: claimed, error: claimError } = await db
    .from("shops")
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq("id", options.shopInternalId)
    .is("welcome_email_sent_at", null)
    .select("id");

  if (claimError) {
    console.warn(
      "[email:install-welcome] claim failed:",
      claimError.message,
    );
    return { ok: false, reason: "send_failed", error: claimError.message };
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, reason: "already_sent" };
  }

  const appUrl = getEmbeddedAppUrl(options.shopDomain, "/");
  const variables = {
    shopName: options.shopName,
    appUrl,
    locale: options.locale,
  };

  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to,
      subject: getInstallWelcomeSubject(options.locale),
      html: generateInstallWelcomeEmailHTML(variables),
      text: generateInstallWelcomeEmailText(variables),
    },
    { idempotencyKey: `install-welcome/${options.shopInternalId}` },
  );

  // The Resend SDK does NOT throw on API-level rejections (rate limit,
  // unverified domain, invalid recipient) — it returns them in `error`.
  // Without this branch a miss is completely silent.
  if (error) {
    console.error("[email:install-welcome] send rejected by Resend:", error);
    return { ok: false, reason: "send_failed", error: error.message };
  }

  console.info(
    `[email:install-welcome] sent to ${to} (id: ${data?.id ?? "unknown"})`,
  );
  return { ok: true };
}
