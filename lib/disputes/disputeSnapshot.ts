/**
 * Shared normalized shape for a dispute observation.
 *
 * Both Shopify REST webhook payloads (disputes/create, disputes/update) and
 * GraphQL `dispute` / `disputes.edges.node` shapes are normalized into the
 * same `DisputeSnapshot`. Downstream code — the diff engine
 * (`applyDisputeSnapshot`) and the dispatcher (`dispatchDisputeEffects`) —
 * is source-agnostic.
 *
 * Unknown fields are dropped silently. Malformed input returns null; the
 * caller marks the webhook with outcome `error_schema_validation` and the
 * hourly cron picks the dispute up.
 */

import { z } from "zod";
import { sanitizeDueAt } from "@/lib/disputes/dueDate";

export interface DisputeSnapshot {
  /** GraphQL Admin id, e.g. "gid://shopify/ShopifyPaymentsDispute/12345". */
  disputeGid: string;
  /** Numeric REST id from the webhook payload (string or number). */
  numericDisputeId?: string | number | null;
  orderGid?: string | null;
  orderId?: string | number | null;
  /**
   * Order display name (e.g. "#7079"). Only populated from the GraphQL path
   * today — the REST webhook payload doesn't carry it. The webhook path
   * backfills via fetchDisputeDetail; the diff engine writes it into
   * `disputes.order_name` so the UI + new-dispute email show a real value
   * instead of an em-dash.
   */
  orderName?: string | null;
  /**
   * Denormalized customer name (first + last) and email. Same situation as
   * `orderName`: the REST webhook payload doesn't carry them, the GraphQL
   * path does (via `disputeEvidence.customerFirstName/LastName/EmailAddress`).
   * The webhook backfill resolves them on brand-new inserts so the embedded
   * card doesn't show "Customer: —" until the hourly cron tick patches the
   * row. The 2026-05-25 #5DF25744 incident pinned this regression.
   */
  customerDisplayName?: string | null;
  customerEmail?: string | null;
  /** Raw Shopify status, lowercased: needs_response, under_review, won, lost, ... */
  status?: string | null;
  /** Raw reason text Shopify returned, e.g. "fraudulent". */
  reason?: string | null;
  networkReasonCode?: string | null;
  initiatedAt?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
  finalizedOn?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  /** "inquiry" | "chargeback" (lowercased). */
  type?: string | null;
  disputeEvidenceGid?: string | null;
  /** Shopify updated_at if present — used by the stale-snapshot monotonic guard. */
  shopifyUpdatedAt?: string | null;
  source: "webhook" | "cron";
  rawSourceType: "rest_dispute_webhook" | "graphql_dispute";
}

/**
 * Shopify REST webhook payload schema. Fields that can come through as
 * either string or number are kept as a union; the diff engine normalises
 * further when comparing.
 */
const restAmountSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

const restWebhookSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    admin_graphql_api_id: z.string().optional(),
    order_id: z.union([z.string(), z.number()]).nullable().optional(),
    order_admin_graphql_api_id: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    network_reason_code: z.string().nullable().optional(),
    initiated_at: z.string().nullable().optional(),
    evidence_due_by: z.string().nullable().optional(),
    evidence_sent_on: z.string().nullable().optional(),
    finalized_on: z.string().nullable().optional(),
    amount: restAmountSchema,
    currency: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * GraphQL `Dispute` node schema. Mirrors the shape used by
 * `DISPUTE_LIST_QUERY` / `DISPUTE_DETAIL_QUERY`.
 */
const graphqlDisputeSchema = z
  .object({
    id: z.string(),
    type: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    reasonDetails: z
      .object({ reason: z.string().nullable().optional() })
      .nullable()
      .optional(),
    amount: z
      .object({
        amount: z.string().nullable().optional(),
        currencyCode: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    initiatedAt: z.string().nullable().optional(),
    evidenceDueBy: z.string().nullable().optional(),
    evidenceSentOn: z.string().nullable().optional(),
    finalizedOn: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    order: z
      .object({
        id: z.string().nullable().optional(),
        legacyResourceId: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    disputeEvidence: z
      .object({
        id: z.string().nullable().optional(),
        customerFirstName: z.string().nullable().optional(),
        customerLastName: z.string().nullable().optional(),
        customerEmailAddress: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

/**
 * Normalize a Shopify REST dispute webhook payload (the body of
 * disputes/create or disputes/update) into a `DisputeSnapshot`.
 *
 * The webhook payload does NOT carry a Shopify GID for the dispute itself —
 * Shopify ships `admin_graphql_api_id` only sporadically. When absent, the
 * caller MUST resolve the GID via the targeted GraphQL fallback in the diff
 * engine (`getDisputeById`) before applying. We surface the numeric id here
 * so the diff engine can perform that fallback.
 */
export function normalizeDisputeWebhookPayload(
  payload: unknown,
): DisputeSnapshot | null {
  const parsed = restWebhookSchema.safeParse(payload);
  if (!parsed.success) return null;

  const p = parsed.data;
  const numericId = p.id ?? null;
  const adminGid = p.admin_graphql_api_id ?? null;

  // We need SOMETHING that identifies the dispute. Without either, we can't
  // route the snapshot to a row, so this counts as schema drift.
  if (!numericId && !adminGid) return null;

  // Shopify omits admin_graphql_api_id on the dispute webhook payload, so we
  // synthesize the GID from the numeric id. The canonical entity is
  // `ShopifyPaymentsDispute` (matches the cron / GraphQL path). `DisputeEvidence`
  // is a different sub-object — using it here splits the (shop_id, dispute_gid)
  // unique key and creates phantom dispute rows that can't be reconciled with
  // the cron-inserted ones.
  const disputeGid =
    adminGid ??
    (numericId !== null
      ? `gid://shopify/ShopifyPaymentsDispute/${String(numericId)}`
      : null);
  if (!disputeGid) return null;

  return {
    disputeGid,
    numericDisputeId: numericId,
    orderGid: p.order_admin_graphql_api_id ?? null,
    orderId: p.order_id ?? null,
    // REST webhook payload never carries order.name; webhook path resolves it
    // via fetchDisputeDetail (GraphQL).
    orderName: null,
    // Same story for customer name + email — REST never carries them.
    customerDisplayName: null,
    customerEmail: null,
    status: lowerOrNull(p.status),
    reason: p.reason ?? null,
    networkReasonCode: p.network_reason_code ?? null,
    initiatedAt: p.initiated_at ?? null,
    // Shopify sometimes returns an epoch `evidenceDueBy` (1970-01-01) for
    // disputes with no real deadline — sanitize to null so it never persists
    // as a bogus deadline. See lib/disputes/dueDate.ts.
    evidenceDueBy: sanitizeDueAt(p.evidence_due_by),
    evidenceSentOn: p.evidence_sent_on ?? null,
    finalizedOn: p.finalized_on ?? null,
    amount: p.amount ?? null,
    currency: p.currency ?? null,
    type: lowerOrNull(p.type),
    // The webhook payload does NOT include the dispute-evidence GID separately.
    // The diff engine resolves it via targeted GraphQL fallback on insert.
    disputeEvidenceGid: null,
    shopifyUpdatedAt: p.updated_at ?? null,
    source: "webhook",
    rawSourceType: "rest_dispute_webhook",
  };
}

/**
 * Normalize a Shopify GraphQL `Dispute` node into a `DisputeSnapshot`.
 *
 * Used by the cron path so the diff engine sees the same shape as the
 * webhook path. The cron caller passes nodes from `DISPUTE_LIST_QUERY` or
 * `DISPUTE_DETAIL_QUERY`.
 */
export function normalizeGraphQLDispute(
  dispute: unknown,
): DisputeSnapshot | null {
  const parsed = graphqlDisputeSchema.safeParse(dispute);
  if (!parsed.success) return null;
  const d = parsed.data;

  const ev = d.disputeEvidence;
  const customerDisplayName = ev
    ? [ev.customerFirstName, ev.customerLastName].filter(Boolean).join(" ") ||
      null
    : null;
  const customerEmail = ev?.customerEmailAddress ?? null;

  return {
    disputeGid: d.id,
    numericDisputeId: extractNumericIdFromGid(d.id),
    orderGid: d.order?.id ?? null,
    orderId: d.order?.legacyResourceId ?? null,
    orderName: d.order?.name ?? null,
    customerDisplayName,
    customerEmail,
    status: lowerOrNull(d.status),
    reason: d.reasonDetails?.reason ?? null,
    networkReasonCode: null,
    initiatedAt: d.initiatedAt ?? null,
    // Shopify sometimes returns an epoch `evidenceDueBy` (1970-01-01) for
    // disputes with no real deadline — sanitize to null (see above).
    evidenceDueBy: sanitizeDueAt(d.evidenceDueBy),
    evidenceSentOn: d.evidenceSentOn ?? null,
    finalizedOn: d.finalizedOn ?? null,
    amount: d.amount?.amount ?? null,
    currency: d.amount?.currencyCode ?? null,
    type: lowerOrNull(d.type),
    disputeEvidenceGid: d.disputeEvidence?.id ?? null,
    shopifyUpdatedAt: d.updatedAt ?? null,
    source: "cron",
    rawSourceType: "graphql_dispute",
  };
}

function lowerOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toLowerCase();
}

function extractNumericIdFromGid(gid: string): string | null {
  // gid://shopify/DisputeEvidence/12345 → "12345"
  const match = /\/(\d+)$/.exec(gid);
  return match ? match[1] : null;
}
