/**
 * PR 5 (docs/plans/single-source-architecture-audit.plan.md §3.2, §5): the one
 * "effective view" of a stored dispute pack for the merchant surfaces that are
 * NOT the embedded pack page: the portal pack page, the portal dispute page and
 * the evidence-pack PDF.
 *
 * It wraps `assembleEffectiveChecklist` + `merchantCompleteness` (the embedded
 * app's functions) and nothing else, so every surface shows the same rows and
 * the same percentage. Read-only: the stored `checklist`, `checklist_v2` and
 * `completeness_score` are never touched; callers ADD effective fields beside
 * them. Returns null where there is no stored v2 checklist to judge (library
 * packs, legacy packs): the caller keeps its stored fallback, the same rule the
 * embedded API route applies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { assembleEffectiveChecklist, merchantCompleteness } from "./effectiveChecklist";
import { normalizeChecklistV2Shape } from "./checklistReconcile";
import { loadReturnScopeForPack } from "./loadReturnScope";

/** The v1 row shape the portal checklist and the PDF render. */
export interface DisplayChecklistRow {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

export interface EffectivePackView {
  checklist: ChecklistItemV2[];
  merchantCompleteness: number;
}

export interface EffectivePackViewInput {
  checklistV2: unknown;
  packSections: unknown;
  evidenceItems?: Parameters<typeof assembleEffectiveChecklist>[0]["evidenceItems"];
  returnScope?: Parameters<typeof assembleEffectiveChecklist>[0]["returnScope"];
  disputeReason: string | null;
}

/** Pure. null when there is no stored (non-empty) v2 checklist. */
export function effectivePackView(input: EffectivePackViewInput): EffectivePackView | null {
  const stored = normalizeChecklistV2Shape(input.checklistV2);
  if (!stored || stored.length === 0) return null;
  const effective = assembleEffectiveChecklist({
    storedChecklist: input.checklistV2,
    packSections: input.packSections,
    evidenceItems: input.evidenceItems,
    returnScope: input.returnScope,
    disputeReason: input.disputeReason,
  });
  return {
    checklist: effective.checklist,
    merchantCompleteness: merchantCompleteness(effective.checklist),
  };
}

/** v2 rows -> the v1 `{field,label,required,present}` rows. Presentation only. */
export function toDisplayChecklistRows(rows: readonly ChecklistItemV2[]): DisplayChecklistRow[] {
  return rows.map((r) => ({
    field: r.field,
    label: r.label,
    required: r.priority === "critical" && r.status !== "unavailable",
    present: r.status === "available" || r.status === "waived",
  }));
}

/** Server-side: resolve the pack's return scope (read-only) then build the view. */
export async function loadEffectivePackView(
  db: SupabaseClient,
  args: {
    shopId: string;
    disputeId: string | null;
    packCycle: number | null | undefined;
    /** Default true. False for a stored or sent artifact (see `loadReturnScopeForPack`). */
    withSupportSignal?: boolean;
    checklistV2: unknown;
    packSections: unknown;
    evidenceItems?: EffectivePackViewInput["evidenceItems"];
    disputeReason: string | null;
  },
): Promise<EffectivePackView | null> {
  if (args.disputeId == null) return null;
  const stored = normalizeChecklistV2Shape(args.checklistV2);
  if (!stored || stored.length === 0) return null;
  return effectivePackView({
    checklistV2: args.checklistV2,
    packSections: args.packSections,
    evidenceItems: args.evidenceItems,
    disputeReason: args.disputeReason,
    returnScope: await loadReturnScopeForPack(db, {
      shopId: args.shopId,
      disputeId: args.disputeId,
      packCycle: args.packCycle,
      withSupportSignal: args.withSupportSignal,
    }),
  });
}
