/**
 * Reconcile a v2 checklist against the fields actually carried by the
 * pack's collected sections.
 *
 * Why: when the pack-template path produces a checklist that doesn't
 * include every canonical field, or when a collector emits a section
 * whose fields aren't in the active template, the persisted
 * `checklist_v2.status` can read `missing` for a field that is, in
 * fact, present in `pack_json.sections[*].fieldsProvided` (or
 * `evidence_items[*].payload.fieldsProvided`). The Overview surfaces —
 * Evidence coverage buckets, Evidence collected — should reflect what
 * was actually collected, not the stale template-driven status.
 *
 * Rules:
 *  - Only `missing` rows are flipped to `available`. Intentional states
 *    (`unavailable`, `waived`, `available`) are preserved.
 *  - Applies to every canonical field, supporting items included.
 *  - Pure: no DB I/O. Used both at build time (to persist) and on read
 *    (to normalize older packs without rebuild).
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

interface SectionLike {
  fieldsProvided?: string[] | null;
}

interface EvidenceItemLike {
  payload?: {
    fieldsProvided?: string[] | null;
    /** Set by `POST /api/packs/:id/upload` when a merchant uploads
     *  from a specific Evidence-tab row. We treat it as a synonym for
     *  `fieldsProvided` here so manual uploads correctly flip the
     *  checklist row from `missing` → `available` — including older
     *  rows created before the upload route started mirroring the
     *  field into `fieldsProvided`. */
    checklistField?: string | null;
  } | null;
  source?: string | null;
}

export function collectedFieldsFromPack(args: {
  sections?: SectionLike[] | null;
  evidenceItems?: EvidenceItemLike[] | null;
}): Set<string> {
  const set = new Set<string>();
  for (const s of args.sections ?? []) {
    for (const f of s.fieldsProvided ?? []) set.add(f);
  }
  for (const it of args.evidenceItems ?? []) {
    for (const f of it.payload?.fieldsProvided ?? []) set.add(f);
    // Manual-upload fallback: legacy rows persisted only `checklistField`,
    // never `fieldsProvided`. Treat the two as synonyms so the
    // Evidence Used section surfaces the upload immediately on the
    // next workspace read — no rebuild required.
    if (it.source === "manual_upload" && typeof it.payload?.checklistField === "string") {
      const cf = it.payload.checklistField.trim();
      if (cf) set.add(cf);
    }
  }
  return set;
}

/**
 * Defensive accessor — `checklist_v2` is typed as `ChecklistItemV2[]` in
 * code, but historical seed/builder paths persisted it as
 * `{ items: ChecklistItemV2[] }`. The TS cast at the route boundary
 * hides the runtime mismatch; this normalizer accepts either shape and
 * always returns a plain array. Exported so other read sites can use
 * the same unwrapping path.
 */
export function normalizeChecklistV2Shape(
  raw: unknown,
): ChecklistItemV2[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw as ChecklistItemV2[];
  if (typeof raw === "object" && raw !== null && "items" in raw) {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) return items as ChecklistItemV2[];
  }
  return null;
}

export function reconcileChecklistWithCollectedFields(
  checklist: ChecklistItemV2[] | null | undefined,
  collected: Set<string>,
): ChecklistItemV2[] {
  const normalized = normalizeChecklistV2Shape(checklist);
  if (!normalized) return [];
  return normalized.map((c) => {
    if (c.status !== "missing") return c;
    if (!collected.has(c.field)) return c;
    return { ...c, status: "available" as const, unavailableReason: undefined };
  });
}
