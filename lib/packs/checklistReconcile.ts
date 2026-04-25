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
  payload?: { fieldsProvided?: string[] | null } | null;
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
  }
  return set;
}

export function reconcileChecklistWithCollectedFields(
  checklist: ChecklistItemV2[] | null | undefined,
  collected: Set<string>,
): ChecklistItemV2[] {
  if (!checklist) return [];
  return checklist.map((c) => {
    if (c.status !== "missing") return c;
    if (!collected.has(c.field)) return c;
    return { ...c, status: "available" as const, unavailableReason: undefined };
  });
}
