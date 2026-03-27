import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { cookies, headers } from "next/headers";
import { routing } from "./routing";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";
import {
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  let locale: string;

  if (requested && hasLocale(routing.locales, requested)) {
    locale = requested;
    const messages = await getMessages(
      pathLocaleToMessages[locale as PathLocale]
    );
    return { locale, messages };
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const acceptLang = headerStore.get("accept-language");
  const headerLocale = acceptLang?.split(",")[0]?.split(";")[0]?.trim();
  locale = resolveLocale({
    userLocale: cookieLocale,
    shopifyLocale: headerLocale,
  });

  const messages = await getMessages(locale);

  return { locale, messages };
});
