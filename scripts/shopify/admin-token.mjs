/**
 * Resolve Shopify Admin API token: from env or via client credentials grant.
 * Never logs or returns secrets.
 */

/**
 * @param {{ shop: string, env?: Record<string, string> }} options
 * @param {string} options.shop - Store domain (e.g. disputedesk.myshopify.com)
 * @param {Record<string, string>} [options.env] - Optional env map (e.g. from .env.local); used before process.env
 * @returns {Promise<string>} Admin API access token
 */
export async function getAdminToken({ shop, env = {} }) {
  const get = (key) => (env[key] != null && env[key] !== "" ? env[key] : process.env[key]);
  const token =
    get("SHOPIFY_ADMIN_TOKEN") || get("SHOPIFY_ACCESS_TOKEN") || get("SHOPIFY_ADMIN_ACCESS_TOKEN");
  if (token && typeof token === "string" && token.trim().length > 0) {
    return token.trim();
  }

  // Use main app credentials (deployed via CLI with required scopes), fall back to seed-specific ones
  const clientId =
    get("SHOPIFY_CLIENT_ID") ||
    get("SHOPIFY_API_KEY") ||
    get("SHOPIFY_SEED_CLIENT_ID") ||
    get("SHOPIFY_ADMIN_CLIENT_ID");
  const clientSecret =
    get("SHOPIFY_API_SECRET") ||
    get("SHOPIFY_SEED_CLIENT_SECRET") ||
    get("SHOPIFY_ADMIN_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Shopify Admin API credentials. Set either SHOPIFY_ADMIN_TOKEN (shpat_...) " +
        "or SHOPIFY_CLIENT_ID + SHOPIFY_API_SECRET (main app) " +
        "or SHOPIFY_SEED_CLIENT_ID + SHOPIFY_SEED_CLIENT_SECRET (store custom app). " +
        "See scripts/shopify/README.md."
    );
  }

  const domain = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${domain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Client credentials token request failed (${res.status}). ${text || res.statusText}. ` +
        "Check SHOPIFY_CLIENT_ID, SHOPIFY_API_SECRET, and that the app is installed on the store."
    );
  }

  const data = await res.json();
  const accessToken = data?.access_token;
  if (!accessToken) {
    throw new Error(
      "Client credentials response did not include access_token. Check the app's API access and store installation."
    );
  }
  return accessToken;
}
