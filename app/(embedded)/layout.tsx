import { headers } from "next/headers";
import { Providers } from "./providers";
import { resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/getMessages";

export default async function EmbeddedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const acceptLang = headerStore.get("accept-language");
  const locale = resolveLocale(null, acceptLang);
  const messages = await getMessages(locale);

  return (
    <>
      <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
      <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      <Providers locale={locale} messages={messages}>
        {children}
      </Providers>
    </>
  );
}
