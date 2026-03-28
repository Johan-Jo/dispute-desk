/**
 * Base URL for customer-facing links in transactional emails.
 *
 * Do not fall back to `VERCEL_URL`: on preview deployments it is a branch-specific
 * hostname, so links in emails would point at the wrong deployment.
 *
 * Matches `app/robots.ts` / `app/sitemap.ts`: prefer `NEXT_PUBLIC_APP_URL`, else
 * the public marketing origin.
 */
export function getPublicSiteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_CANONICAL_URL;
  if (raw?.trim()) {
    return raw.trim().replace(/\/$/, "");
  }
  return "https://disputedesk.app";
}
