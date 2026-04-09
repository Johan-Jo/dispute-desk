/**
 * Live readiness evaluator for Step 1 (Connection & Readiness).
 * Computes readiness state on demand from session, scopes, webhooks, and store data.
 * Never persists results — readiness is operational state, not user configuration.
 */

import { loadSession } from "@/lib/shopify/sessionStorage";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";

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

  // 5. Store data available — non-blocking, check if we can fetch shop details
  let storeDataReady = false;
  if (sessionValid) {
    try {
      const details = await fetchShopDetails(shopId);
      storeDataReady = Boolean(details?.name);
    } catch {
      // API failure — treat as syncing
    }
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

  return { rows, hasBlockers, hasPending, allReady };
}
