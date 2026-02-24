/**
 * Central Shopify GraphQL client factory.
 *
 * Every Shopify API call in the codebase MUST go through
 * `requestShopifyGraphQL()` in ./graphql.ts which uses this version constant.
 */

export const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION ?? "2026-01";

export function shopifyGraphQLEndpoint(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}
