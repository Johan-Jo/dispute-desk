/**
 * Authed Shopify GraphQL helper (Phase 2.5).
 *
 * Hides the load-session + decrypt-token + construct-session-shape
 * dance that was duplicated across 13 call sites. Reuse this when the
 * only thing the caller needs is to send one or more GraphQL requests
 * for a known shop.
 *
 * When the caller already has a `StoredSession` in hand for other
 * reasons (e.g. expiry checks, scope validation), call
 * `requestShopifyGraphQL` directly — this helper would issue a
 * second redundant DB read.
 *
 * Auth-error normalization stays centralized in
 * `lib/shopify/sessions/getShopBackgroundSession.ts:assertNotAuthInvalid`;
 * callers can wire that detector in around their own response handling.
 */

import {
  requestShopifyGraphQL,
  type GraphQLResponse,
} from "./graphql";
import { getShopBackgroundSession } from "./sessions/getShopBackgroundSession";

interface MakeAuthedRequestOpts {
  /** Internal shop ID (shops.id). The helper loads the offline session
   *  for this shop and uses its decrypted token. */
  shopId: string;
  query: string;
  variables?: Record<string, unknown>;
  correlationId?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** BCP-47 locale for Accept-Language. */
  locale?: string;
}

/**
 * Send one Shopify Admin GraphQL request for the given shop. Throws
 * `NoBackgroundSessionError` when the shop has no offline session
 * (merchant must reinstall) — all other error shapes (transport,
 * GraphQL `errors[]`, throttle) come back inside the
 * `GraphQLResponse<T>` envelope, same contract as
 * `requestShopifyGraphQL`.
 */
export async function makeAuthedRequest<T = unknown>(
  opts: MakeAuthedRequestOpts,
): Promise<GraphQLResponse<T>> {
  const session = await getShopBackgroundSession(opts.shopId);
  return requestShopifyGraphQL<T>({
    session: {
      shopDomain: session.shopDomain,
      accessToken: session.accessToken,
    },
    query: opts.query,
    variables: opts.variables,
    correlationId: opts.correlationId,
    maxRetries: opts.maxRetries,
    timeoutMs: opts.timeoutMs,
    locale: opts.locale,
  });
}
