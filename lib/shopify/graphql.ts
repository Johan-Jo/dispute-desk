import { shopifyGraphQLEndpoint } from "./client";

interface ShopifySession {
  shopDomain: string;
  accessToken: string;
}

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

interface RequestOptions {
  session: ShopifySession;
  query: string;
  variables?: Record<string, unknown>;
  correlationId?: string;
  maxRetries?: number;
  /** Per-attempt fetch timeout in ms. Default 25s — leaves headroom under the
   *  60s Vercel function budget for retries + post-processing. */
  timeoutMs?: number;
  /** BCP-47 locale for Accept-Language header — localizes event message strings */
  locale?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 25_000;

function jitter(base: number): number {
  return base + Math.random() * base * 0.5;
}

/**
 * Central Shopify GraphQL request wrapper.
 * - Uses pinned API version from lib/shopify/client.ts
 * - Retries on 429 / throttle / transient 5xx with exponential backoff + jitter
 * - Reads cost/throttle metadata when present
 * - Never logs access tokens
 */
export async function requestShopifyGraphQL<T = unknown>(
  opts: RequestOptions
): Promise<GraphQLResponse<T>> {
  const {
    session,
    query,
    variables,
    correlationId,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    locale,
  } = opts;
  const url = shopifyGraphQLEndpoint(session.shopDomain);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
          ...(correlationId ? { "X-Request-Id": correlationId } : {}),
          ...(locale ? { "Accept-Language": locale } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        (err instanceof Error && err.name === "AbortError") ||
        (err as { code?: string })?.code === "ABORT_ERR";
      if (aborted && attempt < maxRetries) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        console.warn(
          `[shopify-gql] timeout (>${timeoutMs}ms) on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms`,
          { correlationId, shop: session.shopDomain }
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw aborted
        ? new Error(
            `[shopify-gql] Request timed out after ${timeoutMs}ms across ${attempt + 1} attempt(s) to ${session.shopDomain}`
          )
        : err;
    }
    clearTimeout(timer);

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt < maxRetries) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        console.warn(
          `[shopify-gql] ${res.status} on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms`,
          { correlationId, shop: session.shopDomain }
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }

    const rawJson = await res.json();

    // Shopify's GraphQL response sometimes returns `errors` as a string
    // (e.g. "Access denied" on scope/token failures) instead of the
    // documented array shape. Normalize it so downstream `.some()` /
    // `.map()` calls never throw on a non-array.
    if (rawJson && rawJson.errors != null && !Array.isArray(rawJson.errors)) {
      const text =
        typeof rawJson.errors === "string"
          ? rawJson.errors
          : JSON.stringify(rawJson.errors);
      rawJson.errors = [{ message: text }];
    }
    const json: GraphQLResponse<T> = rawJson;

    const throttled = json.errors?.some(
      (e) => e.extensions?.code === "THROTTLED"
    );
    if (throttled && attempt < maxRetries) {
      const available =
        json.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0;
      const restoreRate =
        json.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
      const waitSec = available < 1 ? Math.ceil(1 / restoreRate) * 2 : 1;
      const delay = jitter(waitSec * 1000);
      console.warn(
        `[shopify-gql] THROTTLED on attempt ${attempt + 1}, waiting ${Math.round(delay)}ms`,
        { correlationId, shop: session.shopDomain }
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    return json;
  }

  throw new Error(
    `[shopify-gql] Exhausted ${maxRetries + 1} attempts for ${session.shopDomain}`
  );
}
