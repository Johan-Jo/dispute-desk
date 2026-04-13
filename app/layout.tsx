import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { isLocale, resolveLocale } from "@/lib/i18n/locales";
import { gtagConsentBootstrapScript } from "@/lib/consent/ga-bootstrap";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "DisputeDesk",
  description: "Shopify chargeback evidence governance",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const acceptLang = headerStore.get("accept-language");
  const headerLocale = acceptLang?.split(",")[0]?.split(";")[0]?.trim();
  const intlHeaderLocale = headerStore.get("x-next-intl-locale");
  const locale =
    (intlHeaderLocale && isLocale(intlHeaderLocale) ? intlHeaderLocale : null) ??
    resolveLocale({ userLocale: cookieLocale, shopifyLocale: headerLocale });

  // App Bridge only on `/app/*` (see middleware `x-dd-load-app-bridge`). Loading it on
  // marketing pages breaks App Bridge Next (missing `shop`) and can crash React (#185).
  const loadAppBridge = headerStore.get("x-dd-load-app-bridge") === "1";

  // App Bridge must be a synchronous blocking script (no defer/async/type=module)
  // and must be first. React hoists <script src> from nested components and adds
  // async/defer — the only safe place is the explicit <head> in the root layout.
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  // Match GA property Measurement ID; empty env must not override (Vercel sometimes sets "").
  const gaId = (process.env.NEXT_PUBLIC_GA_ID ?? "").trim() || "G-MN5KDFQMMX";
  return (
    <html lang={locale}>
      <head>
        {apiKey && loadAppBridge && (
          // App Bridge must load synchronously in <head> for embedded Shopify; next/script is deferred.
          // eslint-disable-next-line @next/next/no-sync-scripts -- required by Shopify App Bridge
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={apiKey}
          />
        )}
      </head>
      <body className={inter.className}>
        {children}
        {!loadAppBridge && (
          <Script
            id="tawk-to"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src="https://embed.tawk.to/69dc1d426161b11c33210737/1jm1t4isv";s1.charset="UTF-8";s1.setAttribute("crossorigin","*");s0.parentNode.insertBefore(s1,s0)})();`,
            }}
          />
        )}
        <Script
          id="ga-consent-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: gtagConsentBootstrapScript(gaId) }}
        />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
