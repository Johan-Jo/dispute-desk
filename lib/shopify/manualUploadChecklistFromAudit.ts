import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `item_added` audit rows written by `POST /api/packs/:packId/upload` include
 * `evidenceItemId` + `checklistField`. Legacy manual uploads have neither on the
 * row nor on old audits — those headings cannot be recovered.
 */
export async function loadChecklistFieldByEvidenceItemIdFromAudit(
  sb: SupabaseClient,
  packId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await sb
    .from("audit_events")
    .select("event_payload")
    .eq("pack_id", packId)
    .eq("event_type", "item_added")
    .order("created_at", { ascending: true });

  if (error || !data?.length) return map;

  for (const row of data) {
    const p = row.event_payload as Record<string, unknown> | null;
    if (!p || p.type !== "manual_upload") continue;
    const cf = typeof p.checklistField === "string" ? p.checklistField.trim() : "";
    if (!cf) continue;
    const eid = typeof p.evidenceItemId === "string" ? p.evidenceItemId.trim() : "";
    if (eid) map.set(eid, cf);
  }
  return map;
}

/** Merge `payload.checklistField` with audit fallback (audit wins only when payload is empty). */
export function resolveChecklistFieldForManualItem(
  evidenceItemId: string,
  payload: Record<string, unknown>,
  auditByItemId: Map<string, string>,
): string | null {
  const fromPayload =
    typeof payload.checklistField === "string" ? payload.checklistField.trim() : "";
  if (fromPayload.length > 0) return fromPayload;
  return auditByItemId.get(evidenceItemId) ?? null;
}
