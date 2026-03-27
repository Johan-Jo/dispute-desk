export function getPublicBaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SHOPIFY_APP_URL;
  if (raw) {
    try {
      return new URL(raw.startsWith("http") ? raw : `https://${raw}`).origin;
    } catch {
      return undefined;
    }
  }
  if (process.env.VERCEL_URL) {
    try {
      return new URL(`https://${process.env.VERCEL_URL}`).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
