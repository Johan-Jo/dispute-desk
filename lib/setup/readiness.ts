/**
 * Live readiness evaluator for Step 1 (Connection & Readiness).
 * Computes readiness state on demand from session, scopes, webhooks, and store data.
 * Never persists results — readiness is operational state, not user configuration.
 */

import { loadSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { findMissingScopes } from "@/lib/shopify/scopes";
import { getServiceClient } from "@/lib/supabase/server";

export type ReadinessStatus = "ready" | "needs_action" | "syncing";

export type ReadinessRowId =
  | "shopify_connected"
  | "dispute_access"
  | "evidence_access"
  | "webhooks_active"
  | "store_data";

export interface ReadinessRow {
  id: ReadinessRowId;
  status: ReadinessStatus;
  blocking: boolean;
  actionLabel?: string;
  actionUrl?: string;
}

export interface ReadinessResult {
  rows: ReadinessRow[];
  hasBlockers: boolean;
  hasPending: boolean;
  allReady: boolean;
  shopDomain?: string;
  /** Scopes the app now requires but this shop's offline session hasn't
   *  granted yet — drives the generic re-auth banner for the installed
   *  base. Excludes `read_all_orders` (its own dedicated nudge). */
  missingScopes: string[];
  needsReauth: boolean;
}

const REQUIRED_DISPUTE_SCOPE = "read_shopify_payments_disputes";
const REQUIRED_EVIDENCE_SCOPE = "write_shopify_payments_dispute_evidences";

function hasScope(scopes: string, required: string): boolean {
  return scopes.split(",").map((s) => s.trim()).includes(required);
}

export async function evaluateReadiness(shopId: string): Promise<ReadinessResult> {
  const rows: ReadinessRow[] = [];

  // 1. Shopify connected — check for valid offline session
  const session = await loadSession(shopId, "offline");
  const sessionValid = Boolean(session?.accessToken && session?.shopDomain);

  rows.push({
    id: "shopify_connected",
    status: sessionValid ? "ready" : "needs_action",
    blocking: true,
    ...(!sessionValid && { actionLabel: "reconnect" }),
  });

  // 2. Dispute access — check session scopes
  const hasDisputeScope = sessionValid && hasScope(session!.scopes, REQUIRED_DISPUTE_SCOPE);
  rows.push({
    id: "dispute_access",
    status: hasDisputeScope ? "ready" : "needs_action",
    blocking: true,
    ...(!hasDisputeScope && { actionLabel: "grantAccess" }),
  });

  // 3. Evidence access — check session scopes
  const hasEvidenceScope = sessionValid && hasScope(session!.scopes, REQUIRED_EVIDENCE_SCOPE);
  rows.push({
    id: "evidence_access",
    status: hasEvidenceScope ? "ready" : "needs_action",
    blocking: true,
    ...(!hasEvidenceScope && { actionLabel: "grantAccess" }),
  });

  // 4. Webhooks active — non-blocking, try to register/verify
  let webhooksReady = false;
  if (sessionValid) {
    try {
      const result = await registerDisputeWebhooks({
        shopDomain: session!.shopDomain,
        accessToken: session!.accessToken,
      });
      webhooksReady = result.ok || result.created.length === 2;
    } catch {
      // Network/API failure — treat as syncing
    }
  }
  rows.push({
    id: "webhooks_active",
    status: webhooksReady ? "ready" : "syncing",
    blocking: false,
    ...(!webhooksReady && { actionLabel: "refreshStatus" }),
  });

  // 5. Store data available — non-blocking, check if the shop row exists in DB
  let storeDataReady = false;
  let shopDomain: string | undefined;
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from("shops")
      .select("id, shop_domain")
      .eq("id", shopId)
      .single();
    storeDataReady = Boolean(data?.shop_domain);
    if (data?.shop_domain) shopDomain = data.shop_domain;
  } catch {
    // DB failure — treat as syncing
  }
  rows.push({
    id: "store_data",
    status: storeDataReady ? "ready" : "syncing",
    blocking: false,
    ...(!storeDataReady && { actionLabel: "retrySync" }),
  });

  const hasBlockers = rows.some((r) => r.blocking && r.status !== "ready");
  const hasPending = rows.some((r) => !r.blocking && r.status !== "ready");
  const allReady = rows.every((r) => r.status === "ready");

  // Generic scope reconciliation for the installed base. read_all_orders
  // has its own dedicated nudge (DashboardScopeUpgradeBanner) with
  // backfill-reset semantics, so exclude it here to avoid stacked banners.
  const missingScopes = sessionValid
    ? findMissingScopes(session!.scopes).filter((s) => s !== "read_all_orders")
    : [];
  const needsReauth = missingScopes.length > 0;

  return {
    rows,
    hasBlockers,
    hasPending,
    allReady,
    shopDomain,
    missingScopes,
    needsReauth,
  };
}
