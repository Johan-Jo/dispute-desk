/**
 * Customer-tenure enrichment for LSE-4 session ingest.
 *
 * The pixel + checkout UI extension send us `customer_id` when the
 * customer is logged in, but neither surface gives us the customer's
 * account creation date — which we need to compute
 * `customer_account_age_days` for CE 3.0 confidence scoring and FPT
 * Identity-category signals.
 *
 * This module fetches `customer(id).createdAt` from Shopify Admin
 * GraphQL via the existing offline session per shop. Results are
 * cached for an hour (customer tenure doesn't change minute-to-minute).
 * Failures are silent — tenure is a nice-to-have, not a gate.
 */

import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

const CUSTOMER_CREATED_AT_QUERY = `
  query CustomerCreatedAt($id: ID!) {
    customer(id: $id) {
      id
      createdAt
    }
  }
`;

interface CustomerCreatedAtResponse {
  customer: {
    id: string;
    createdAt: string;
  } | null;
}

interface CacheEntry {
  tenureDays: number | null;
  cachedAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CacheEntry>();

export function clearCustomerTenureCache(): void {
  cache.clear();
}

export interface ResolveCustomerTenureInput {
  shopId: string;
  /**
   * Customer ID as Shopify gives it on the storefront/pixel — either
   * a numeric "12345..." string or the full gid:// form. Normalized
   * to gid:// before the GraphQL call.
   */
  customerId: string;
}

export async function resolveCustomerTenureDays(
  input: ResolveCustomerTenureInput,
): Promise<number | null> {
  const gid = toCustomerGid(input.customerId);
  if (!gid) return null;

  const cacheKey = `${input.shopId}:${gid}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.tenureDays;
  }

  try {
    const res = await makeAuthedRequest<CustomerCreatedAtResponse>({
      shopId: input.shopId,
      query: CUSTOMER_CREATED_AT_QUERY,
      variables: { id: gid },
    });
    const createdAt = res.data?.customer?.createdAt;
    if (!createdAt) {
      cache.set(cacheKey, { tenureDays: null, cachedAt: Date.now() });
      return null;
    }
    const created = new Date(createdAt).getTime();
    if (!Number.isFinite(created)) {
      cache.set(cacheKey, { tenureDays: null, cachedAt: Date.now() });
      return null;
    }
    const tenureDays = Math.max(
      0,
      Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000)),
    );
    cache.set(cacheKey, { tenureDays, cachedAt: Date.now() });
    return tenureDays;
  } catch {
    // No offline session, transport error, GraphQL error — all silent.
    // Tenure is informational; absence doesn't break qualification.
    return null;
  }
}

/** Normalize a bare customer id ("12345...") to the gid:// form. */
function toCustomerGid(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://shopify/Customer/")) return trimmed;
  // Accept bare numeric IDs.
  if (/^\d+$/.test(trimmed)) {
    return `gid://shopify/Customer/${trimmed}`;
  }
  return null;
}
