/**
 * Server-side gathering of the objective facts the presentation
 * resolvers need, for a batch of dispute rows — shared by
 * GET /api/disputes (list) and GET /api/dashboard/stats so the two
 * surfaces can never diverge (plan §3, §12V item 4).
 *
 * Batched queries only (no per-row N+1):
 *   - latest evidence pack per dispute (status + approved_for_save_at),
 *   - checklist_v2 + gorgiasEvidenceStale for those latest packs
 *     (optional — only when the caller renders optional attention),
 *   - shop rules once (per-dispute automation mode in memory),
 *   - the shop's Gorgias integration reconnect flag once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickAutomationAction } from "@/lib/rules/pickAutomationAction";
import type { Rule } from "@/lib/rules/types";
import {
  deriveConcreteContribution,
  type ChecklistRowFacts,
} from "./concreteContribution";
import {
  resolvePresentation,
  type PresentationInput,
} from "./resolvePresentation";
import type { DisputePresentation } from "./types";

/** The dispute-row columns the gatherer reads (all present on
 *  `select("*")` rows from the `disputes` table). */
export interface DisputeRowFacts {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | string | null;
  phase: string | null;
  final_outcome: string | null;
  closed_at: string | null;
  submission_state: string | null;
  normalized_status: string | null;
  needs_attention: boolean | null;
  attention_reason: string | null;
  attention_payload: Record<string, unknown> | null;
}

interface LatestPackFacts {
  id: string;
  status: string | null;
  approvedForSaveAt: string | null;
  checklist: ChecklistRowFacts[] | null;
  gorgiasEvidenceStale: boolean;
}

export interface GatherOptions {
  /** Fetch checklist_v2 for the latest packs so `recommended`/
   *  `opportunity` resolve. Skippable for bucket counting — neither
   *  value affects buckets or merchantActionCount (plan §4). */
  includeConcreteContribution?: boolean;
  /** Case-strength `overall` per dispute id, when the caller already
   *  computed it (the list route's Stage A/B). Missing → not_assessed. */
  strengthOverallByDispute?: Map<string, string>;
}

export async function gatherPresentations(
  sb: SupabaseClient,
  shopId: string,
  rows: DisputeRowFacts[],
  opts: GatherOptions = {},
): Promise<Map<string, DisputePresentation>> {
  const out = new Map<string, DisputePresentation>();
  if (rows.length === 0) return out;
  const disputeIds = rows.map((r) => r.id);

  // ── Latest pack per dispute (any status — lifecycle needs the truth,
  // including queued/building/failed) ──────────────────────────────────
  const { data: packRows } = await sb
    .from("evidence_packs")
    .select("id, dispute_id, status, approved_for_save_at, created_at")
    .in("dispute_id", disputeIds)
    .order("created_at", { ascending: false });

  const latestByDispute = new Map<string, LatestPackFacts>();
  for (const p of packRows ?? []) {
    if (!p.dispute_id || latestByDispute.has(p.dispute_id)) continue;
    latestByDispute.set(p.dispute_id, {
      id: p.id,
      status: (p.status as string | null) ?? null,
      approvedForSaveAt: (p.approved_for_save_at as string | null) ?? null,
      checklist: null,
      gorgiasEvidenceStale: false,
    });
  }

  // ── Checklist + stale flag for the latest packs (optional) ──────────
  if (opts.includeConcreteContribution && latestByDispute.size > 0) {
    const latestIds = Array.from(latestByDispute.values()).map((p) => p.id);
    const { data: heavy } = await sb
      .from("evidence_packs")
      .select("id, dispute_id, checklist_v2, pack_json->gorgiasEvidenceStale")
      .in("id", latestIds);
    for (const h of heavy ?? []) {
      const entry = h.dispute_id ? latestByDispute.get(h.dispute_id) : null;
      if (!entry || entry.id !== h.id) continue;
      entry.checklist = (h.checklist_v2 ?? null) as ChecklistRowFacts[] | null;
      entry.gorgiasEvidenceStale =
        (h as { gorgiasEvidenceStale?: unknown }).gorgiasEvidenceStale === true;
    }
  }

  // ── Shop rules once → per-dispute automation mode in memory ─────────
  const { data: ruleRows } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", shopId)
    .eq("enabled", true)
    .order("priority", { ascending: true });
  const rules = (ruleRows ?? []) as Rule[];

  // ── Gorgias integration reconnect flag (merchant-resolvable) ────────
  // integrations.status='needs_attention' + meta.error_code =
  // 'reconnect_required' (set on Gorgias 401/403 —
  // enrichGorgiasCommsJob.markReconnectRequired). Shop-level: applies to
  // every non-terminal dispute of the shop.
  const { data: integration } = await sb
    .from("integrations")
    .select("status, meta")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .maybeSingle();
  const integrationReconnectRequired =
    integration?.status === "needs_attention" &&
    (integration?.meta as Record<string, unknown> | null)?.["error_code"] ===
      "reconnect_required";

  // ── Compose per row ─────────────────────────────────────────────────
  for (const row of rows) {
    const pack = latestByDispute.get(row.id) ?? null;
    const mode = pickAutomationAction(rules, {
      id: row.id,
      shop_id: row.shop_id,
      reason: row.reason,
      status: row.status,
      amount: row.amount == null ? null : Number(row.amount),
      phase:
        row.phase === "inquiry" || row.phase === "chargeback"
          ? row.phase
          : null,
    }).action.mode;

    const proposalCount =
      row.attention_reason === "gorgias_evidence_ready" &&
      typeof row.attention_payload?.["proposal_count"] === "number"
        ? (row.attention_payload["proposal_count"] as number)
        : 0;

    const input: PresentationInput = {
      finalOutcome: row.final_outcome,
      closedAt: row.closed_at,
      submissionState: row.submission_state,
      normalizedStatus: row.normalized_status,
      packStatus: pack?.status ?? null,
      strengthOverall: opts.strengthOverallByDispute?.get(row.id) ?? null,
      attentionReason: row.attention_reason,
      needsAttention: row.needs_attention === true,
      integrationReconnectRequired,
      gorgiasActionableCount: proposalCount,
      automationMode: mode,
      approvedForSaveAt: pack?.approvedForSaveAt ?? null,
      concreteContribution: deriveConcreteContribution(pack?.checklist),
      gorgiasEvidenceStale: pack?.gorgiasEvidenceStale ?? false,
    };
    out.set(row.id, resolvePresentation(input));
  }
  return out;
}
