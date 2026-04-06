/** Canonical production origin — never changes. */
export const PRODUCTION_ORIGIN = "https://disputedesk.app";

export function getPublicBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SHOPIFY_APP_URL;
  if (raw) {
    try {
      return new URL(raw.startsWith("http") ? raw : `https://${raw}`).origin;
    } catch {
      // fall through
    }
  }
  if (process.env.VERCEL_URL) {
    try {
      const url = new URL(`https://${process.env.VERCEL_URL}`).origin;
      // Vercel preview URLs (*.vercel.app) should not override the canonical
      // origin — keep the production origin for canonical tags, use the
      // preview URL only for OG/twitter.
      return url.includes("vercel.app") ? PRODUCTION_ORIGIN : url;
    } catch {
      // fall through
    }
  }
  return PRODUCTION_ORIGIN;
}
