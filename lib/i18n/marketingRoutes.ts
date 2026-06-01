import { isPathLocale } from "@/lib/i18n/pathLocales";

const HUB_PREFIXES = [
  "resources",
  "templates",
  "case-studies",
  "glossary",
  "blog",
] as const;

/**
 * Public marketing routes that use next-intl (`/`, `/de`, `/resources`, …).
 * Excludes portal, embedded app, admin, and auth.
 */
export function isMarketingIntlRoute(pathname: string): boolean {
  if (
    pathname.startsWith("/portal") ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth")
  ) {
    return false;
  }
  if (pathname.startsWith("/api")) return false;
  if (pathname === "/") return true;
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return true;
  if (seg === "privacy") return true;
  // `/playbook`, `/playbook/read`, `/playbook/sequence` — the inbound GTM
  // lead funnel (localized chrome). Without this the language switcher can't
  // navigate from the English page to a localized variant: it falls back to
  // router.refresh() and the page stays in English.
  if (seg === "playbook") return true;
  if (isPathLocale(seg)) return true;
  return (HUB_PREFIXES as readonly string[]).includes(seg);
}
