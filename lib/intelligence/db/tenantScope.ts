/**
 * Tenant-scoped data-access layer for the Intelligence Engine (design §4.1).
 *
 * The service role BYPASSES RLS, so `.eq("shop_id", …)` is application-level
 * enforcement, not a DB boundary. This module is the ONLY code path allowed to
 * touch `intel_*` views / `intelligence_*` tables and the audit RPC. Every
 * function REQUIRES a non-empty shopId and fails closed. A CI grep forbids
 * `from("intel_...")` / the audit RPC outside this file
 * (scripts/verify-intelligence-tenant-scope.mjs).
 *
 * Before merchant exposure a DB-enforced boundary is required (§14.7) — this
 * app-level discipline is acceptable ONLY for the internal admin phase.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { DataQualityFacts } from "../types";

export interface SegmentFilters {
  minValueDecimal?: number | null;
  riskLevels?: string[] | null;
  countries?: string[] | null;
  gateways?: string[] | null;
  crossBorder?: boolean | null;
  reasons?: string[] | null;
}

export interface SegmentFacts {
  orders_affected: number;
  revenue_affected: string; // numeric as string
  disputes_in_segment: number;
  disputed_value: string;
  net_loss_in_segment: string;
  legit_orders_affected: number;
}

/** Policy-simulator segment aggregates — computed server-side (design §16). */
export async function runSegmentSimulation(
  shopId: string,
  filters: SegmentFilters,
): Promise<SegmentFacts> {
  assertShopId(shopId);
  const db = getServiceClient();
  const { data, error } = await db.rpc("intel_simulate_segment", {
    p_shop_id: shopId,
    p_min_value: filters.minValueDecimal ?? null,
    p_risk_levels: filters.riskLevels ?? null,
    p_countries: filters.countries ?? null,
    p_gateways: filters.gateways ?? null,
    p_cross_border: filters.crossBorder ?? null,
    p_reasons: filters.reasons ?? null,
  });
  if (error) throw new Error(`[intelligence/tenantScope] simulate RPC failed: ${error.message}`);
  return data as SegmentFacts;
}

const INTEL_VIEWS = new Set([
  "intel_order_records",
  "intel_dispute_records",
  "intel_evidence_records",
  "intel_event_records",
]);

const DB_PAGE_SIZE = 1000; // PostgREST caps un-ranged selects at 1000.

export function assertShopId(shopId: unknown): asserts shopId is string {
  if (typeof shopId !== "string" || shopId.trim() === "") {
    throw new Error("[intelligence/tenantScope] shopId is required and must be non-empty");
  }
}

/**
 * Run the deterministic data-quality audit RPC for one shop. All aggregation
 * is server-side (single row back), so no pagination needed here.
 */
export async function runDataQualityAudit(shopId: string): Promise<DataQualityFacts> {
  assertShopId(shopId);
  const db = getServiceClient();
  const { data, error } = await db.rpc("intel_data_quality_audit", { p_shop_id: shopId });
  if (error) {
    throw new Error(`[intelligence/tenantScope] audit RPC failed: ${error.message}`);
  }
  return data as DataQualityFacts;
}

/**
 * Paginated, shop-scoped select over an intel_* view. Always applies
 * `.eq("shop_id", shopId)` and a stable order; converges long scans at 1000
 * rows/page (design §1.3). Used by Phase B+ record readers.
 */
export async function scopedSelectAll<T = Record<string, unknown>>(
  view: string,
  shopId: string,
  columns = "*",
  orderColumn = "order_id",
): Promise<T[]> {
  assertShopId(shopId);
  if (!INTEL_VIEWS.has(view)) {
    throw new Error(`[intelligence/tenantScope] unknown intel view: ${view}`);
  }
  const db = getServiceClient();
  const rows: T[] = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await db
      .from(view)
      .select(columns)
      .eq("shop_id", shopId)
      .order(orderColumn, { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (error) {
      throw new Error(`[intelligence/tenantScope] select ${view} failed: ${error.message}`);
    }
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < DB_PAGE_SIZE) break;
  }
  return rows;
}
