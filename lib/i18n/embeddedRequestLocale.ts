import { cache } from "react";
import { cookies, headers } from "next/headers";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";
import { getServiceClient } from "@/lib/supabase/server";
import { resolveEmbeddedLocale, type Locale } from "./locales";

/**
 * Locale of the current embedded-app request, or null when the request
 * carries no embedded signal (so non-embedded surfaces keep their own
 * resolution).
 *
 * The one place both `app/(embedded)/layout.tsx` (client provider messages)
 * and `i18n/request.ts` (server `getTranslations()`) read it from — they
 * used to resolve separately, and the server side ignored Shopify's locale
 * altogether.
 *
 *   - `x-shopify-locale`: middleware's copy of Shopify's `?locale=`, the
 *     language the merchant selected in Shopify Admin.
 *   - SuperAdmin impersonation has no Shopify in the loop, so the store's
 *     persisted `shops.locale` stands in for it.
 */
export const getEmbeddedRequestLocale = cache(async (): Promise<Locale | null> => {
  const headerStore = await headers();
  const shopifyLocale = headerStore.get("x-shopify-locale");
  const impersonationMode = headerStore.get(IMPERSONATION_MODE_HEADER);
  const impersonating = impersonationMode === "read" || impersonationMode === "write";
  if (!shopifyLocale && !impersonating) return null;

  let storeLocale: string | null = null;
  const shopId = impersonating ? (headerStore.get("x-shop-id")?.trim() ?? "") : "";
  if (shopId && !shopifyLocale) {
    const { data } = await getServiceClient()
      .from("shops")
      .select("locale")
      .eq("id", shopId)
      .maybeSingle();
    storeLocale = (data?.locale as string | null) ?? null;
  }

  const cookieStore = await cookies();
  return resolveEmbeddedLocale({
    shopifyLocale,
    storeLocale,
    cookieLocale: cookieStore.get("dd_locale")?.value ?? null,
    browserLocale: headerStore.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim(),
  });
});
