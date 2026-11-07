/**
 * The checklist a MERCHANT should see, assembled at read time from what was
 * stored plus what the record says now. No rebuild, no stored change.
 *
 * Stored `checklist_v2` is a snapshot of the build. Where the record shows a
 * return or refund, the stored `no_return_initiated` row still reads "missing"
 * (the collector rightly stayed silent) and every surface that counts it says
 * "No return initiated" beside a banner saying the return was received.
 *
 * ONE function for every merchant page that shows a percentage:
 * `merchantCompleteness`. The stored `completeness_score` stays internal
 * (automation, decision hash, gates) and is never overwritten.
 */

import {
  deriveCompletenessMetrics,
  fieldApplicability,
  type OrderContext,
} from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ReturnScopeInput } from "@/lib/disputes/returnRequestConfirmation";
import {
  collectedFieldsFromPack,
  normalizeChecklistV2Shape,
  reconcileChecklistWithCollectedFields,
} from "./checklistReconcile";
import { noReturnApplicability } from "./noReturnApplicability";
import { refundRecordApplicability } from "./refundRecordApplicability";
import type { EvidenceSection } from "./types";

export interface EffectiveChecklistInput {
  storedChecklist: unknown;
  packSections: unknown;
  evidenceItems?: Parameters<typeof collectedFieldsFromPack>[0]["evidenceItems"];
  /** Already resolved by the caller: `returnScopeFor(settings, confirmation)`
   *  for the PACK's response cycle, plus the read-time support-inbox signal
   *  (`customerAskedInSupport`). `undefined` = setting off and no signal. */
  returnScope?: ReturnScopeInput | null;
  /** The dispute's reason (Shopify enum). Gates the world preconditions that
   *  are reason-specific (`refund_record`). Absent = applicable (fail open). */
  disputeReason: string | null;
}

export interface EffectiveChecklist {
  checklist: ChecklistItemV2[];
  /** Rows dropped because the record makes the fact inapplicable. */
  droppedForRecord: string[];
  /** `available` rows the record contradicts: kept, never hidden. */
  contradictedAvailable: string[];
}

interface OrderSectionData {
  returnStatus?: unknown;
  totals?: { refunded?: unknown };
}

/** Sections as stored: tolerate null, non-arrays, null entries, missing
 *  `fieldsProvided`. A malformed shape means "nothing here", never a throw. */
export function normaliseSections(raw: unknown): EvidenceSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is EvidenceSection => s != null && typeof s === "object");
}

export function orderFactsFromSections(sections: readonly EvidenceSection[]): {
  returnStatus: string | null;
  totalRefunded: string | number | null;
} {
  const order = sections.find(
    (s) => (s as { labelToken?: { key?: string } }).labelToken?.key === "packs.section.order",
  );
  const data = (order?.data ?? null) as OrderSectionData | null;
  return {
    returnStatus: typeof data?.returnStatus === "string" ? data.returnStatus : null,
    totalRefunded: (data?.totals?.refunded as string | number | null | undefined) ?? null,
  };
}

/**
 * What the record makes impossible, as an `OrderContext` for
 * `fieldApplicability` / `inapplicableFields`. The ONE builder: the assembler
 * (workspace, pack pages, include endpoint) and the decided loader both call it,
 * so a page and the dispute record can never disagree about a row.
 */
export function recordOrderContext(input: {
  sections: readonly EvidenceSection[];
  returnScope?: ReturnScopeInput | null;
  disputeReason: string | null;
}): OrderContext {
  const facts = orderFactsFromSections(input.sections);
  return {
    noReturnFact: noReturnApplicability({ ...facts, returnScope: input.returnScope }, input.sections),
    refundRecordFact: refundRecordApplicability({
      disputeReason: input.disputeReason,
      totalRefunded: facts.totalRefunded,
    }),
  } as OrderContext;
}

export function assembleEffectiveChecklist(input: EffectiveChecklistInput): EffectiveChecklist {
  const stored = normalizeChecklistV2Shape(input.storedChecklist) ?? [];
  const sections = normaliseSections(input.packSections);
  const collected = collectedFieldsFromPack({
    sections: sections as Array<{ fieldsProvided?: string[] | null }>,
    evidenceItems: input.evidenceItems ?? [],
  });
  const ctx = recordOrderContext({
    sections,
    returnScope: input.returnScope,
    disputeReason: input.disputeReason,
  });

  const reconciled = reconcileChecklistWithCollectedFields(stored, collected);
  const checklist = reconcileChecklistWithCollectedFields(stored, collected, {
    applicability: (f) => fieldApplicability(f, ctx),
  });
  const kept = new Set(checklist.map((c) => c.field));
  const droppedForRecord = reconciled.filter((c) => !kept.has(c.field)).map((c) => c.field);
  const contradictedAvailable = checklist
    .filter((c) => c.status === "available" && !fieldApplicability(c.field, ctx).applicable)
    .map((c) => c.field);
  return { checklist, droppedForRecord, contradictedAvailable };
}

/**
 * THE merchant-facing "Evidence completeness" percentage. Isomorphic: the
 * server calls it on the assembled rows and the browser calls it on the same
 * rows after an optimistic completion. No page keeps its own rule.
 */
export function merchantCompleteness(effectiveChecklist: readonly ChecklistItemV2[]): number {
  return deriveCompletenessMetrics([...effectiveChecklist]).completenessScore;
}
