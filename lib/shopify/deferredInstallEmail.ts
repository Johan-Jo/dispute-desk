/**
 * The merchant install email, sent LATE — once the no-orders gate has a real
 * answer (docs/plans/no-orders-install-gate.plan.md).
 *
 * ## Why
 *
 * `onNewShopCreated` decides between the normal welcome ("we're already going
 * through your orders") and the no-orders email by asking Shopify whether the
 * store has orders. On the OAuth-callback path that probe fails: the token
 * stored at that moment is non-expiring and the Admin API rejects it
 * ("Non-expiring access tokens are no longer accepted"). The probe answers
 * "unknown", and the old code fell through to the WELCOME — so a store with no
 * orders (sharpdesk, dev, 2026-10-15) was told we were reading its order
 * history, then shown the lock screen.
 *
 * Now an "unknown" verdict at install sends nothing, and the email goes out on
 * the first definitive gate verdict instead (`resolveOrdersGate`, on the
 * merchant's first embedded load, where the token works):
 *   - locked  → the no-orders email
 *   - orders found → the normal welcome
 *
 * Idempotency is `sendInstallWelcomeEmail`'s own `welcome_email_sent_at` claim:
 * a shop gets exactly one install email, whichever path sends it. The cheap
 * pre-read below only avoids a Shopify round-trip for the (normal) case where
 * it was already sent.
 *
 * Never throws.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, normalizeLocale } from "@/lib/i18n/locales";
import { sendInstallWelcomeEmail } from "@/lib/email/sendInstallWelcome";
import { fetchShopDetails } from "./shopDetails";

export async function sendDeferredInstallEmail(
  shopInternalId: string,
  variant: "welcome" | "no_orders",
): Promise<void> {
  try {
    const { data: shop } = await getServiceClient()
      .from("shops")
      .select("shop_domain, shop_name, locale, welcome_email_sent_at")
      .eq("id", shopInternalId)
      .maybeSingle();
    if (!shop || shop.welcome_email_sent_at) return;

    const details = await fetchShopDetails(shopInternalId).catch(() => null);
    await sendInstallWelcomeEmail({
      shopInternalId,
      shopDomain: shop.shop_domain as string,
      to: details?.email,
      shopName: details?.name || (shop.shop_name as string | null),
      locale: normalizeLocale((shop.locale as string | null) ?? null) ?? DEFAULT_LOCALE,
      variant,
    });
  } catch (err) {
    console.warn(
      "[email:install-welcome] deferred send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
