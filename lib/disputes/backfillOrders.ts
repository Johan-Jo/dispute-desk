/**
 * Phase 1 — historical orders backfill orchestrator.
 *
 * Walks the Shopify orders connection from the configured since-date
 * to "today" (exclusive), persisting each order to `shopify_orders`
 * with its immutable risk snapshot, and writing per-assessment rows
 * to `shopify_order_risk_assessments`. Updates `shops.historical_import_*`
 * progress fields so the dashboard onboarding banner can gate on
 * `historical_import_status = 'complete'`.
 *
 * Time budget: the orchestrator self-checkpoints every page and bails
 * out when its soft budget (default 240s) is exhausted, returning
 * `{ status: 'continue', nextCursor }`. The job handler re-enqueues
 * itself with the cursor stashed in `entity_id` so subsequent runs
 * resume cleanly. This keeps individual job runs inside the 300s
 * `maxDuration` on `/api/jobs/worker` without hard-failing large shops.
 *
 * Re-run safety:
 *   - Rows already in `shopify_orders` are not re-INSERTed. Mutable
 *     columns (fulfillment status, fraud_protection_level, cancel
 *     state) are UPDATEd in place. The immutability trigger on
 *     `risk_*_initial` blocks any attempt to rewrite the snapshot —
 *     correct by design.
 *   - `shopify_order_risk_assessments` is append-only: re-runs add
 *     fresh snapshot_at rows so the assessment history grows
 *     naturally without losing prior state.
 *
 * Scope handling (PRD §6, §7):
 *   - First run reads the offline session's `scopes` string. If it
 *     includes `read_all_orders`, the since-date is anchored to a
 *     pre-Shopify epoch (2010-01-01); otherwise it falls back to the
 *     default 60-day window. The chosen tier is persisted on
 *     `shops.historical_import_scope_granted` so the onboarding UI
 *     can disclose which window was analyzed.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  fetchOrdersBackfillPage,
  normalizeBackfillOrder,
  type ShopifyOrderRow,
  type ShopifyOrderRiskAssessmentRow,
} from "@/lib/shopify/queries/ordersForBackfill";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { enqueueJob } from "@/lib/jobs/claimJobs";

/** Default `read_orders` window when `read_all_orders` is not granted.
 *  Shopify Admin returns the trailing 60 days for unscoped order
 *  history; we anchor the since-date to that boundary so the
 *  paginated stream terminates predictably. */
export const DEFAULT_WINDOW_DAYS = 60;

/** Anchor for `read_all_orders` runs. Pre-dates Shopify (2006) so it
 *  covers any plausible historical order on any installed shop. */
export const READ_ALL_ORDERS_SINCE_ANCHOR = "2010-01-01";

/** Soft time budget per job run, in ms. Leaves ~60s headroom under
 *  the 300s `maxDuration` for the final progress write + retry math. */
export const DEFAULT_SOFT_BUDGET_MS = 240_000;

export type BackfillStatus = "complete" | "continue";

export interface BackfillResult {
  status: BackfillStatus;
  ordersProcessed: number;
  nextCursor?: string;
}

/** Pure: derive `since-date` from scope grant. ISO `YYYY-MM-DD`. */
export function deriveSinceDate(
  scopeGranted: "default_window" | "read_all_orders",
  todayUtc: Date = new Date(),
): string {
  if (scopeGranted === "read_all_orders") return READ_ALL_ORDERS_SINCE_ANCHOR;
  const d = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - DEFAULT_WINDOW_DAYS,
    ),
  );
  return d.toISOString().slice(0, 10);
}

/** Pure: classify the Shopify offline-session scopes string. */
export function classifyScopeGrant(
  scopesCsv: string | null | undefined,
): "default_window" | "read_all_orders" {
  if (!scopesCsv) return "default_window";
  const tokens = scopesCsv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return tokens.includes("read_all_orders") ? "read_all_orders" : "default_window";
}

/** Pure: tomorrow UTC (exclusive upper bound). ISO `YYYY-MM-DD`. */
export function tomorrowUtcIso(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return d.toISOString().slice(0, 10);
}

const SHOP_PRIMARY_COUNTRY_QUERY = /* GraphQL */ `
  query ShopPrimaryCountry {
    shop {
      billingAddress {
        countryCodeV2
      }
    }
  }
`;

interface ShopifySession {
  shopDomain: string;
  accessToken: string;
}

async function fetchShopPrimaryCountry(
  session: ShopifySession,
  correlationId?: string,
): Promise<string | null> {
  try {
    const resp = await requestShopifyGraphQL<{
      shop?: { billingAddress?: { countryCodeV2?: string | null } | null } | null;
    }>({
      session,
      query: SHOP_PRIMARY_COUNTRY_QUERY,
      correlationId: correlationId ?? "shop-primary-country",
    });
    return resp.data?.shop?.billingAddress?.countryCodeV2 ?? null;
  } catch (e) {
    // Cross-border classification is best-effort. A failed country
    // lookup leaves `is_cross_border` null for the run, which is
    // exactly the contract documented in normalizeBackfillOrder.
    console.warn(
      `[backfill-orders] shop primary country lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * One execution slice of the backfill. Returns `{ status: 'complete' }`
 * when the full historical window has been walked; returns
 * `{ status: 'continue', nextCursor }` when the soft time budget was
 * hit before the stream ended.
 */
export async function backfillShopOrders(
  shopId: string,
  opts: {
    cursor?: string | null;
    correlationId?: string;
    softBudgetMs?: number;
  } = {},
): Promise<BackfillResult> {
  const t0 = Date.now();
  const budget = opts.softBudgetMs ?? DEFAULT_SOFT_BUDGET_MS;
  const sb = getServiceClient();

  const session = await getShopBackgroundSession(shopId);
  const accessSession = {
    shopDomain: session.shopDomain,
    accessToken: session.accessToken,
  };

  // ── First-run bookkeeping ──────────────────────────────────────
  // When the job is starting from scratch (no cursor), record the
  // scope-grant tier and since-date so the UI can disclose the
  // window being analyzed. Idempotent: subsequent runs see the
  // cursor and skip this branch.
  if (!opts.cursor) {
    const scopeGranted = classifyScopeGrant(session.scopes);
    const sinceDate = deriveSinceDate(scopeGranted);
    const { error } = await sb
      .from("shops")
      .update({
        historical_import_status: "in_progress",
        historical_import_scope_granted: scopeGranted,
        historical_import_since_date: sinceDate,
        historical_import_orders_processed: 0,
        historical_import_progress_pct: 0,
      })
      .eq("id", shopId);
    if (error) {
      throw new Error(`shops historical_import init failed: ${error.message}`);
    }
  }

  // ── Resolve window + counters from shops row ───────────────────
  const { data: shopRow, error: shopErr } = await sb
    .from("shops")
    .select(
      "historical_import_since_date, historical_import_orders_processed",
    )
    .eq("id", shopId)
    .single();
  if (shopErr || !shopRow) {
    throw new Error(
      `shops row lookup failed for ${shopId}: ${shopErr?.message ?? "no row"}`,
    );
  }
  const sinceDate = shopRow.historical_import_since_date as string;
  const toExclusive = tomorrowUtcIso();
  let processed: number = shopRow.historical_import_orders_processed ?? 0;

  // Store-country lookup is one Shopify call per job run. Cached for
  // the slice; subsequent re-enqueues pay it again (cheap — one
  // query, no rate-budget concern).
  const storeCountry = await fetchShopPrimaryCountry(
    accessSession,
    opts.correlationId,
  );

  // ── Page loop ──────────────────────────────────────────────────
  let cursor: string | null = opts.cursor ?? null;
  while (true) {
    if (Date.now() - t0 > budget) {
      // Soft timeout — checkpoint and ask the handler to re-enqueue.
      return {
        status: "continue",
        ordersProcessed: processed,
        nextCursor: cursor ?? undefined,
      };
    }

    const page = await fetchOrdersBackfillPage(accessSession, {
      fromDateIso: sinceDate,
      toExclusiveDateIso: toExclusive,
      after: cursor,
      correlationId: opts.correlationId
        ? `${opts.correlationId}-p${processed}`
        : `backfill-orders-p${processed}`,
    });

    if (page.orders.length > 0) {
      const normalized = page.orders.map((o) =>
        normalizeBackfillOrder(shopId, o, { storeCountryCode: storeCountry }),
      );
      await persistOrders(
        shopId,
        normalized.map((n) => n.order),
        normalized.flatMap((n) => n.assessments),
      );
      processed += page.orders.length;
      const { error: progErr } = await sb
        .from("shops")
        .update({ historical_import_orders_processed: processed })
        .eq("id", shopId);
      if (progErr) {
        // Progress write failure is non-fatal — the next slice will
        // re-fetch the counter from the shops row and continue. Log
        // it but don't abort.
        console.warn(
          `[backfill-orders] progress write failed for ${shopId}: ${progErr.message}`,
        );
      }
    }

    if (!page.hasNextPage || !page.endCursor) {
      // Walked the entire window.
      await sb
        .from("shops")
        .update({
          historical_import_status: "complete",
          historical_import_progress_pct: 100,
          historical_import_orders_total: processed,
          historical_import_completed_at: new Date().toISOString(),
        })
        .eq("id", shopId);
      // Chain: enqueue the fraud-rollup backfill so the embedded
      // dashboard's window selectors have data the moment the banner
      // unlocks. Skipped silently when a job is already queued — the
      // worker's per-shop concurrency cap (1) prevents racing.
      const { data: existingChain } = await sb
        .from("jobs")
        .select("id")
        .eq("shop_id", shopId)
        .eq("job_type", "backfill_fraud_daily_metrics")
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle();
      if (!existingChain) {
        await enqueueJob({
          shopId,
          jobType: "backfill_fraud_daily_metrics",
          priority: 70,
        });
      }
      return { status: "complete", ordersProcessed: processed };
    }
    cursor = page.endCursor;
  }
}

async function persistOrders(
  shopId: string,
  orders: ShopifyOrderRow[],
  assessments: ShopifyOrderRiskAssessmentRow[],
): Promise<void> {
  if (orders.length === 0 && assessments.length === 0) return;
  const sb = getServiceClient();

  // Partition incoming orders into inserts (new) vs updates
  // (existing). We can't use Supabase's bulk upsert here because the
  // immutability trigger would reject any (legal-but-redundant) write
  // to risk_*_initial on existing rows once we ever revise the
  // assessment elsewhere — staying explicit avoids that hazard
  // entirely.
  const ids = orders.map((o) => o.shopify_order_id);
  let existingSet = new Set<string>();
  if (ids.length > 0) {
    const { data: existing, error } = await sb
      .from("shopify_orders")
      .select("shopify_order_id")
      .eq("shop_id", shopId)
      .in("shopify_order_id", ids);
    if (error) {
      throw new Error(`shopify_orders existence lookup failed: ${error.message}`);
    }
    existingSet = new Set((existing ?? []).map((r) => r.shopify_order_id));
  }

  const inserts = orders.filter((o) => !existingSet.has(o.shopify_order_id));
  const updates = orders.filter((o) => existingSet.has(o.shopify_order_id));

  if (inserts.length > 0) {
    const { error } = await sb.from("shopify_orders").insert(inserts);
    if (error) {
      throw new Error(`shopify_orders insert failed: ${error.message}`);
    }
  }

  // Mutable-column UPDATE for existing rows. risk_*_initial is
  // intentionally excluded — the trigger would reject any attempt to
  // change it, and re-asserting the same value is wasted work.
  const nowIso = new Date().toISOString();
  for (const o of updates) {
    const { error } = await sb
      .from("shopify_orders")
      .update({
        processed_at: o.processed_at,
        cancelled_at: o.cancelled_at,
        fulfilled_at: o.fulfilled_at,
        country: o.country,
        is_cross_border: o.is_cross_border,
        payment_gateway: o.payment_gateway,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        cancel_reason: o.cancel_reason,
        fraud_protection_level: o.fraud_protection_level,
        updated_at: nowIso,
      })
      .eq("shop_id", shopId)
      .eq("shopify_order_id", o.shopify_order_id);
    if (error) {
      throw new Error(
        `shopify_orders update failed for ${o.shopify_order_id}: ${error.message}`,
      );
    }
  }

  if (assessments.length > 0) {
    // Append-only history: every page's assessments insert with a
    // fresh snapshot_at default. The unique constraint on
    // (shop, order, provider, snapshot_at) protects against
    // duplicates within the same millisecond.
    const { error } = await sb
      .from("shopify_order_risk_assessments")
      .insert(assessments);
    if (error) {
      throw new Error(
        `shopify_order_risk_assessments insert failed: ${error.message}`,
      );
    }
  }
}

/**
 * Enqueue a backfill for a shop. Idempotent:
 *   - Skips when a backfill is already `queued`/`running`.
 *   - Skips when the shop's `historical_import_status` is already
 *     `complete` (use the admin re-run path to force a refresh).
 *
 * Returns the job ID, or null when skipped.
 */
export async function enqueueShopOrdersBackfill(
  shopId: string,
): Promise<string | null> {
  const sb = getServiceClient();

  const { data: existingJob } = await sb
    .from("jobs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("job_type", "backfill_shop_orders")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (existingJob) return null;

  const { data: shop } = await sb
    .from("shops")
    .select("historical_import_status")
    .eq("id", shopId)
    .maybeSingle();
  if (shop?.historical_import_status === "complete") return null;

  return enqueueJob({
    shopId,
    jobType: "backfill_shop_orders",
    priority: 80,
  });
}
