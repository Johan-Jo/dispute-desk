/**
 * Production GraphQL registry — single source of truth for every
 * Shopify Admin GraphQL string the app sends from a server context.
 *
 * Consumed by:
 *   - `lib/shopify/queries/__tests__/schemaDriftGuard.test.ts` (static
 *     deny-list check; runs in CI for every commit)
 *   - `lib/shopify/checkQueryFieldDrift.ts` (runtime dry-run drift
 *     checker; runs daily via the check-shopify-reasons cron and the
 *     publish-content piggyback path)
 *
 * Adding a new query/mutation:
 *   1. Append an entry below.
 *   2. Mutations default to `dryRun: false` to avoid any risk of
 *      hitting a state-changing resolver during the daily check.
 *      Static deny-list is the only protection for mutations.
 *   3. Queries default to `dryRun: true`. Provide minimal stub
 *      variables that pass Shopify's schema-level validation but
 *      reference non-existent IDs (`gid://shopify/<Type>/0`). The
 *      drift checker explicitly does NOT trust the response data,
 *      only the `errors[]` envelope.
 *   4. Skip `dryRun: true` for introspection queries (e.g.
 *      REASON_ENUM_INTROSPECTION_QUERY) — they cannot drift in the
 *      same way and have their own dedicated checker.
 */

import { ORDER_DETAIL_QUERY } from "./orders";
import { CUSTOMER_ORDERS_FOR_CE30_QUERY } from "./customerOrdersForCE30";
import { ORDERS_FOR_BACKFILL_QUERY } from "./ordersForBackfill";
import { ORDER_FOR_INGEST_QUERY } from "./orderForIngest";
import { ORDERS_FOR_SNAPSHOT_QUERY } from "./ordersForSnapshot";
import { APP_CHARGE_STATUS_QUERY } from "./appChargeStatus";
import { ACTIVE_SUBSCRIPTIONS_QUERY } from "./activeSubscriptions";
import {
  DISPUTE_LIST_QUERY,
  DISPUTE_DETAIL_QUERY,
  DISPUTE_PROFILE_QUERY,
} from "./disputes";
import { REASON_ENUM_INTROSPECTION_QUERY } from "./enumIntrospection";
import { APP_SUBSCRIPTION_CREATE_MUTATION } from "../mutations/appSubscriptionCreate";
import { DISPUTE_EVIDENCE_UPDATE_MUTATION } from "../mutations/disputeEvidenceUpdate";

export interface ProductionGraphQL {
  /** Stable identifier used in audit events, emails, and test names. */
  name: string;
  type: "query" | "mutation";
  body: string;
  /** Stub variables safe to send during a runtime dry-run. Required
   *  when `dryRun: true`; ignored otherwise. Must pass schema-level
   *  validation but reference non-existent IDs to avoid touching real
   *  data. */
  stubVariables?: Record<string, unknown>;
  /** Opt into runtime drift checking. Mutations are kept off this path
   *  to eliminate any possibility of state changes during the daily
   *  check — the static deny-list test in
   *  `__tests__/schemaDriftGuard.test.ts` is their only guard. */
  dryRun: boolean;
}

/** Stub GIDs use the canonical Shopify GID format with id=0 so the
 *  schema validation step passes but no resolver call returns data.
 *  Shopify either returns `node: null` or a userErrors-style "not
 *  found", neither of which mutates state. */
const STUB = {
  disputeGid: "gid://shopify/ShopifyPaymentsDispute/0",
  orderGid: "gid://shopify/Order/0",
  customerGid: "gid://shopify/Customer/0",
  appSubscriptionGid: "gid://shopify/AppSubscription/0",
};

export const PRODUCTION_GRAPHQL: ProductionGraphQL[] = [
  // — Queries (dry-run enabled) ─────────────────────────────────
  {
    name: "DISPUTE_LIST_QUERY",
    type: "query",
    body: DISPUTE_LIST_QUERY,
    stubVariables: { first: 1, after: null },
    dryRun: true,
  },
  {
    name: "DISPUTE_DETAIL_QUERY",
    type: "query",
    body: DISPUTE_DETAIL_QUERY,
    stubVariables: { id: STUB.disputeGid },
    dryRun: true,
  },
  {
    name: "DISPUTE_PROFILE_QUERY",
    type: "query",
    body: DISPUTE_PROFILE_QUERY,
    stubVariables: { id: STUB.disputeGid },
    dryRun: true,
  },
  {
    name: "ORDER_DETAIL_QUERY",
    type: "query",
    body: ORDER_DETAIL_QUERY,
    stubVariables: { id: STUB.orderGid },
    dryRun: true,
  },
  {
    name: "CUSTOMER_ORDERS_FOR_CE30_QUERY",
    type: "query",
    body: CUSTOMER_ORDERS_FOR_CE30_QUERY,
    stubVariables: { customerId: STUB.customerGid, query: "id:0", first: 1 },
    dryRun: true,
  },
  {
    name: "ORDERS_FOR_BACKFILL_QUERY",
    type: "query",
    body: ORDERS_FOR_BACKFILL_QUERY,
    stubVariables: { first: 1, after: null, query: null },
    dryRun: true,
  },
  {
    name: "ORDER_FOR_INGEST_QUERY",
    type: "query",
    body: ORDER_FOR_INGEST_QUERY,
    stubVariables: { id: STUB.orderGid },
    dryRun: true,
  },
  {
    name: "ORDERS_FOR_SNAPSHOT_QUERY",
    type: "query",
    body: ORDERS_FOR_SNAPSHOT_QUERY,
    stubVariables: { first: 1, after: null, query: null },
    dryRun: true,
  },
  {
    name: "APP_CHARGE_STATUS_QUERY",
    type: "query",
    body: APP_CHARGE_STATUS_QUERY,
    stubVariables: { id: STUB.appSubscriptionGid },
    dryRun: true,
  },
  {
    // Billing reconciliation cron source-of-truth — schema validation
    // must catch any drift to AppSubscription / pricingDetails fields
    // before a cron tick silently leaves a shop expired.
    name: "ACTIVE_SUBSCRIPTIONS_QUERY",
    type: "query",
    body: ACTIVE_SUBSCRIPTIONS_QUERY,
    stubVariables: {},
    dryRun: true,
  },

  // — Introspection (own checker, see lib/shopify/checkReasonEnumDrift.ts) —
  {
    name: "REASON_ENUM_INTROSPECTION_QUERY",
    type: "query",
    body: REASON_ENUM_INTROSPECTION_QUERY,
    dryRun: false,
  },

  // — Mutations (static deny-list only; never dry-run) ──────────
  {
    name: "APP_SUBSCRIPTION_CREATE_MUTATION",
    type: "mutation",
    body: APP_SUBSCRIPTION_CREATE_MUTATION,
    dryRun: false,
  },
  {
    name: "DISPUTE_EVIDENCE_UPDATE_MUTATION",
    type: "mutation",
    body: DISPUTE_EVIDENCE_UPDATE_MUTATION,
    dryRun: false,
  },
];

/** Convenience accessor: the subset that should be hit by the runtime
 *  drift checker. */
export const DRY_RUN_QUERIES = PRODUCTION_GRAPHQL.filter((q) => q.dryRun);
