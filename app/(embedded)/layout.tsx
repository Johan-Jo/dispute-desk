/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/layout.tsx (embedded app shell)
 * Figma Make source: src/app/pages/shopify/shopify-shell.tsx
 * Reference: top bar, sidebar, app nav (Dashboard, Disputes, Evidence Packs, Rules, Plan, Settings). Adapt nav to Polaris/App Bridge.
 */
import { headers, cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Providers } from "./providers";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";
import { getPolarisTranslations } from "@/lib/i18n/polarisLocales";
import { TawkToWidget } from "@/components/embedded/TawkToWidget";
import {
  ImpersonationBanner,
  type ImpersonationNavItem,
} from "@/components/embedded/ImpersonationBanner";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";

export default async function EmbeddedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const acceptLang = headerStore.get("accept-language");
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  // x-shopify-locale is set by middleware from the ?locale= query param on every
  // embedded app load — use it as the primary Shopify locale source so the first
  // request renders in the right language (the cookie isn't available until the
  // second request since it's set in the middleware response, not the request).
  const shopifyLocaleHeader = headerStore.get("x-shopify-locale");
  const locale = resolveLocale({
    userLocale: cookieLocale,
    shopLocale: shopifyLocaleHeader,
    shopifyLocale: acceptLang?.split(",")[0]?.split(";")[0]?.trim(),
  });
  const messages = await getMessages(locale);
  const polarisTranslations = await getPolarisTranslations(locale);
  const shopifyHost = headerStore.get("x-shopify-host")?.trim() ?? "";

  // SuperAdmin impersonation: middleware sets these headers only for a valid,
  // signed impersonation cookie. Render the banner + skip App Bridge host wiring.
  const impersonationModeHeader = headerStore.get(IMPERSONATION_MODE_HEADER);
  const impersonationMode =
    impersonationModeHeader === "read" || impersonationModeHeader === "write"
      ? impersonationModeHeader
      : null;
  const impersonationShopDomain = impersonationMode
    ? (headerStore.get("x-shop-domain")?.trim() ?? "")
    : "";

  // Under impersonation there's no Shopify Admin host, so <s-app-nav> can't
  // upgrade — provide a real fallback nav (same items as AppNavSidebar, labels
  // i18n-resolved) so the admin can navigate the merchant's app.
  let impersonationNav: ImpersonationNavItem[] = [];
  if (impersonationMode) {
    const t = await getTranslations();
    impersonationNav = [
      { href: "/app", label: t("nav.dashboard") },
      { href: "/app/disputes", label: t("nav.disputes") },
      { href: "/app/coverage", label: t("nav.coverage") },
      { href: "/app/rules", label: t("nav.automation") },
      { href: "/app/packs", label: t("nav.playbooks") },
      { href: "/app/insights/initial-analysis", label: t("nav.insights") },
      { href: "/app/policies", label: t("nav.policies") },
      { href: "/app/billing", label: t("nav.billing") },
      { href: "/app/settings", label: t("nav.settings") },
      { href: "/app/help", label: t("nav.help") },
    ];
  }

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return (
    <>
      <meta name="shopify-api-key" content={apiKey} />
      {shopifyHost ? <meta name="shopify-host" content={shopifyHost} /> : null}
      {/* Persist and restore host so App Bridge has it (required for postMessage to admin.shopify.com). Fallback: derive host from shop (base64(shop+'/admin')) when Shopify does not send it. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var u=new URL(window.location.href);var h=document.querySelector('meta[name="shopify-host"]')?.content||u.searchParams.get('host')||sessionStorage.getItem('shopify_host')||'';var shop=u.searchParams.get('shop');if(!h&&shop&&typeof btoa==='function'){try{h=btoa(shop+'/admin');}catch(e){}}if(h){sessionStorage.setItem('shopify_host',h);window.__shopify_host__=h;}if(!u.searchParams.get('host')&&h){var q=new URLSearchParams(u.search);q.set('host',h);if(shop)q.set('shop',shop);window.history.replaceState(null,'',u.pathname+'?'+q.toString());}})();`,
        }}
      />
      <Providers locale={locale} messages={messages} polarisTranslations={polarisTranslations}>
        {impersonationMode ? (
          <ImpersonationBanner
            shopDomain={impersonationShopDomain}
            mode={impersonationMode}
            navItems={impersonationNav}
          />
        ) : null}
        {children}
        <TawkToWidget />
      </Providers>
    </>
  );
}
