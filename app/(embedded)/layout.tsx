/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/layout.tsx (embedded app shell)
 * Figma Make source: src/app/pages/shopify/shopify-shell.tsx
 * Reference: top bar, sidebar, app nav (Dashboard, Disputes, Evidence Packs, Rules, Plan, Settings). Adapt nav to Polaris/App Bridge.
 */
import { headers, cookies } from "next/headers";
import { Providers } from "./providers";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";
import { getPolarisTranslations } from "@/lib/i18n/polarisLocales";

export default async function EmbeddedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const acceptLang = headerStore.get("accept-language");
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const locale = resolveLocale({ userLocale: cookieLocale, shopifyLocale: acceptLang?.split(",")[0]?.split(";")[0]?.trim() });
  const messages = await getMessages(locale);
  const polarisTranslations = await getPolarisTranslations(locale);
  const shopifyHost = headerStore.get("x-shopify-host")?.trim() ?? "";

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
        {children}
      </Providers>
    </>
  );
}
