/**
 * Gathers the inputs `resolveDecidedResponse` needs for one decided dispute.
 *
 * Shared by the workspace API (Overview) and the outcome email, so both read
 * the same rows. Failure-tolerant: returns null on any read error, and callers
 * then render nothing rather than a guess.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DECIDED_AUDIT_EVENT_TYPES,
  resolveDecidedResponse,
  type DecidedAuditEvent,
  type DecidedResponse,
} from "@/lib/disputes/decidedResponse";

export interface DecidedDisputeRow {
  id: string;
  shop_id: string;
  closed_at: string | null;
  due_at: string | null;
  /** Shopify's `evidenceSentOn` (see syncDisputes.ts). */
  submitted_at: string | null;
  evidence_saved_to_shopify_at: string | null;
  review_state: string | null;
}

function earliest(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestT = Infinity;
  for (const v of values) {
    if (!v) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t) && t < bestT) {
      best = v;
      bestT = t;
    }
  }
  return best;
}

export async function loadDecidedResponse(
  sb: SupabaseClient,
  row: DecidedDisputeRow,
): Promise<DecidedResponse | null> {
  try {
    const [shopRes, packsRes, pkgRes, eventsRes] = await Promise.all([
      sb.from("shops").select("created_at, installed_at").eq("id", row.shop_id).maybeSingle(),
      sb.from("evidence_packs").select("saved_to_shopify_at").eq("dispute_id", row.id),
      sb
        .from("defence_packages")
        .select("submitted_at")
        .eq("dispute_id", row.id)
        .eq("status", "submitted"),
      sb
        .from("audit_events")
        .select("event_type, event_payload, created_at")
        .eq("dispute_id", row.id)
        .in("event_type", [...DECIDED_AUDIT_EVENT_TYPES])
        .order("created_at", { ascending: true }),
    ]);
    if (shopRes.error || packsRes.error || pkgRes.error || eventsRes.error) return null;

    const shop = shopRes.data as { created_at?: string | null; installed_at?: string | null } | null;
    // `installed_at` moves forward on a reinstall; `created_at` is the first
    // install. The earlier of the two is when DisputeDesk first saw the shop.
    const installedAt = earliest([shop?.created_at, shop?.installed_at]);

    const packs = (packsRes.data ?? []) as Array<{ saved_to_shopify_at: string | null }>;
    const pkgs = (pkgRes.data ?? []) as Array<{ submitted_at: string | null }>;
    const weFiledAt = earliest([
      row.evidence_saved_to_shopify_at,
      ...packs.map((p) => p.saved_to_shopify_at),
      ...pkgs.map((p) => p.submitted_at),
    ]);

    return resolveDecidedResponse({
      closedAt: row.closed_at,
      dueAt: row.due_at,
      evidenceSentOn: row.submitted_at,
      installedAt,
      weFiledAt,
      hasPack: packs.length > 0,
      reviewState: row.review_state,
      events: (eventsRes.data ?? []) as DecidedAuditEvent[],
    });
  } catch {
    return null;
  }
}
