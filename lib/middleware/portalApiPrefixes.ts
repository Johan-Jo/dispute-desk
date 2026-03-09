/**
 * API path prefixes that allow portal auth (Supabase Auth + active_shop)
 * instead of Shopify session cookies. Used by middleware.
 *
 * When adding a new portal page that calls an API, add its prefix here
 * and add it to the test in tests/unit/portalApiPrefixes.test.ts.
 */
export const PORTAL_API_PREFIXES = [
  "/api/portal/",
  "/api/setup/",
  "/api/integrations/",
  "/api/files/samples",
  "/api/disputes",
  "/api/packs",
  "/api/policies",
  "/api/policy-templates",
  "/api/templates",
  "/api/billing",
  "/api/rules",
] as const;

export function isPortalApiPath(pathname: string): boolean {
  return PORTAL_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
