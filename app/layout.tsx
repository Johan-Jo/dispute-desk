import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { isLocale, resolveLocale } from "@/lib/i18n/locales";

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

  // App Bridge must be a synchronous blocking script (no defer/async/type=module)
  // and must be first. React hoists <script src> from nested components and adds
  // async/defer — the only safe place is the explicit <head> in the root layout.
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return (
    <html lang={locale}>
      <head>
        {apiKey && (
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={apiKey}
          />
        )}
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
