import { headers, cookies } from "next/headers";
import { Providers } from "./providers";
import { resolveLocale } from "@/lib/i18n/config";
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
  const locale = resolveLocale(cookieLocale, acceptLang);
  const messages = await getMessages(locale);
  const polarisTranslations = await getPolarisTranslations(locale);

  return (
    <>
      <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
      <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      <Providers locale={locale} messages={messages} polarisTranslations={polarisTranslations}>
        {children}
      </Providers>
    </>
  );
}
