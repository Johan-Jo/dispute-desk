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
 *  - A collected field with NO row at all is APPENDED (see below).
 *  - Applies to every canonical field, supporting items included.
 *  - Pure: no DB I/O. Used both at build time (to persist) and on read
 *    (to normalize older packs without rebuild).
 *
 * THE APPEND RULE (2026-08-04). Until now this function could only flip an
 * existing row, never add one — so a collector output with no template row was
 * invisible on every merchant surface and skipped by the scorer
 * (`caseStrength.ts:511-513` iterates the checklist), while `factClassifier`
 * read `pack_json.sections` directly and cited it to the issuer. That is
 * blume-box #352552: a real ECI 02 liability shift argued to the bank and
 * shown to the merchant nowhere. The canonical evidence model measured the
 * scope: 76 (field × reason) pairs across 14 fields
 * (docs/evidence-model/divergence-manifest.json).
 *
 * This is the ONE function both pipelines' inputs pass through — build time
 * (`buildPack.ts:663`) and every read (`workspace/route.ts:420`) — so making
 * it additive fixes every existing open pack on the next page load, with no
 * rebuild and no backfill. Appended rows are `optional` priority: the reason
 * template did not ask for them, so they must not outweigh a field it did.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import {
  EVIDENCE_FIELD_KEYS,
  isEvidenceField,
} from "@/lib/evidence/model/domains";
import { definitionFor } from "@/lib/evidence/model/definitions";

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
  // A NULL/unparseable `checklist_v2` is treated as an empty checklist, not as
  // "stop". Returning early here meant a pack that collected evidence but has
  // no checklist rendered NOTHING — the merchant saw an empty dispute page
  // while `pack_json.sections` held five collected sections and
  // `factClassifier` could cite every one of them to the issuer.
  // Found on dev via surasvenne #SEED-1001 (2026-08-04), whose pack is `ready`
  // with 5 sections and a null checklist. Same shape as any pack whose
  // checklist write failed after the sections were persisted.
  const normalized = normalizeChecklistV2Shape(checklist) ?? [];

  const flipped = normalized.map((c) => {
    if (c.status !== "missing") return c;
    if (!collected.has(c.field)) return c;
    return { ...c, status: "available" as const, unavailableReason: undefined };
  });

  // Append collected canonical fields the template never gave a row.
  // Iterating EVIDENCE_FIELD_KEYS (not `collected`) keeps the output order
  // stable and silently ignores anything unregistered — those are reported by
  // the model's `nonEvidence.operational.unregisteredFields`, not rendered.
  const present = new Set(flipped.map((c) => c.field));
  const appended: ChecklistItemV2[] = [];
  for (const field of EVIDENCE_FIELD_KEYS) {
    if (present.has(field)) continue;
    if (!collected.has(field)) continue;
    if (!isEvidenceField(field)) continue;
    appended.push({
      field,
      // Empty by design: `lib/**` must not emit English, and every render site
      // resolves the localized name from `CANONICAL_EVIDENCE[field].labelKey`
      // (e.g. useEvidenceSections `fieldLabel`), falling back to this only
      // when the key is missing.
      label: "",
      status: "available",
      priority: "optional",
      blocking: false,
      source: definitionFor(field).merchantSuppliable
        ? "manual_upload"
        : "auto_shopify",
    });
  }

  return appended.length > 0 ? [...flipped, ...appended] : flipped;
}
