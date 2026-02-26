import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const acceptLang = headerStore.get("accept-language");
  const locale = resolveLocale({ userLocale: cookieLocale, shopifyLocale: acceptLang?.split(",")[0]?.split(";")[0]?.trim() });
  const messages = await getMessages(locale);

  return { locale, messages };
});
