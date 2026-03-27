import { defineRouting } from "next-intl/routing";
import {
  DEFAULT_PATH_LOCALE,
  PATH_LOCALE_LIST,
  type PathLocale,
} from "@/lib/i18n/pathLocales";

/** Two-letter segments: `/` = English, `/de`, `/es`, … */
export const marketingPathLocales = [...PATH_LOCALE_LIST] as readonly PathLocale[];

export const routing = defineRouting({
  locales: marketingPathLocales,
  defaultLocale: DEFAULT_PATH_LOCALE,
  localePrefix: "as-needed",
});
