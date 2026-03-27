import { PATH_LOCALE_PREFIX_PATTERN } from "@/lib/i18n/pathLocales";

/** Unprefixed public paths for the marketing content hub (next-intl handles locale). */
export const hubPublicPathRegex =
  /^\/(resources|templates|case-studies|glossary|blog)(\/.*)?$/;

const localePrefixedHubPathRegex = new RegExp(
  `^\\/(${PATH_LOCALE_PREFIX_PATTERN})\\/(resources|templates|case-studies|glossary|blog)(\\/.*)?$`,
);

export function isMarketingHubPath(pathname: string): boolean {
  return (
    hubPublicPathRegex.test(pathname) ||
    localePrefixedHubPathRegex.test(pathname)
  );
}
