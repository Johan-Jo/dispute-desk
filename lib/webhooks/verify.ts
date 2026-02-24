import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Shopify webhook HMAC-SHA256 signature.
 * Returns true if the signature is valid.
 */
export function verifyShopifyWebhook(
  rawBody: string | Buffer,
  hmacHeader: string
): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[webhook] SHOPIFY_API_SECRET not set");
    return false;
  }

  const digest = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  try {
    return timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
  } catch {
    return false;
  }
}
