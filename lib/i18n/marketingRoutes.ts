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
  if (isPathLocale(seg)) return true;
  return (HUB_PREFIXES as readonly string[]).includes(seg);
}
