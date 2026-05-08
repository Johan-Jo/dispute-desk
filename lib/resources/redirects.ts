/**
 * Canonicalization + sitemap-exclusion helpers for the resource hub.
 *
 * The page route at app/[locale]/resources/[pillar]/[slug]/page.tsx calls
 * `resolveLocalizationRedirect` to find out whether the requested article
 * should be served (return null) or 301-redirected to a canonical target
 * (return a {pathLocale, pillar, slug} record). The sitemap calls
 * `isLocalizationSitemapEligible` to filter rows out of the public XML.
 *
 * The redirect itself is one hop only — chained redirects (A → B → C) are
 * deliberately not followed, so an admin mistake can't create a loop.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import { hubLocaleToPathSegment } from "@/lib/resources/localeMap";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import type { HubContentLocale } from "./constants";

export type CanonicalizationFields = {
  redirect_to_localization_id: string | null;
  is_excluded_from_sitemap: boolean | null;
  quality_status: string | null;
};

export type RedirectTarget = {
  pathLocale: PathLocale;
  pillar: string;
  slug: string;
  /** Resolved primary_pillar of the *target* item, in case the canonical lives under a different pillar. */
  routeKind: string;
};

/**
 * One-hop redirect resolver. Returns null when the requested row is the
 * canonical version (no redirect set). Returns a RedirectTarget when the
 * row points elsewhere AND the target itself is published and not excluded.
 *
 * Edge cases handled:
 *   - target row deleted / not published → return null (route handler
 *     should treat this as if no redirect were set; admin can clean up later)
 *   - target row is itself a redirect → DO NOT chase; return null
 *     (chained redirects are a misconfiguration trap)
 *   - target row is excluded from sitemap → still redirect (exclusion is
 *     about discovery, not about whether the URL works for users)
 */
export async function resolveLocalizationRedirect(
  redirectToId: string | null | undefined,
  sb: SupabaseClient = getServiceClient()
): Promise<RedirectTarget | null> {
  if (!redirectToId) return null;

  const { data, error } = await sb
    .from("content_localizations")
    .select(
      "id, locale, slug, route_kind, redirect_to_localization_id, is_published, content_items!inner(primary_pillar, workflow_status)"
    )
    .eq("id", redirectToId)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.is_published) return null;

  // Don't chase a chain. If the target is itself a redirect, refuse the hop.
  if (data.redirect_to_localization_id) return null;

  const itemRaw = data.content_items as
    | { primary_pillar: string; workflow_status: string }
    | { primary_pillar: string; workflow_status: string }[];
  const item = Array.isArray(itemRaw) ? itemRaw[0] : itemRaw;
  if (!item || item.workflow_status !== "published") return null;

  return {
    pathLocale: hubLocaleToPathSegment(data.locale as HubContentLocale),
    pillar: item.primary_pillar,
    slug: data.slug,
    routeKind: data.route_kind,
  };
}

/**
 * Pure predicate used by app/sitemap.ts to filter rows.
 * A row is sitemap-eligible when:
 *   - no redirect target set,
 *   - not manually excluded,
 *   - quality_status is null or 'published' (every other status is hidden).
 */
export function isLocalizationSitemapEligible(fields: CanonicalizationFields): boolean {
  if (fields.redirect_to_localization_id) return false;
  if (fields.is_excluded_from_sitemap) return false;
  if (fields.quality_status && fields.quality_status !== "published") return false;
  return true;
}

/**
 * Build the absolute path (relative URL) for a redirect target so the
 * route handler can call permanentRedirect(buildRedirectPath(target)).
 */
export function buildRedirectPath(target: RedirectTarget): string {
  const localePrefix = target.pathLocale === "en" ? "" : `/${target.pathLocale}`;
  if (target.routeKind === "resources") {
    return `${localePrefix}/resources/${target.pillar}/${target.slug}`;
  }
  return `${localePrefix}/${target.routeKind}/${target.slug}`;
}
