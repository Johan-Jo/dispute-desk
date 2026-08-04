/**
 * Projections — how each surface reads the canonical model.
 *
 * A projection may FILTER, SORT and SUMMARISE. It may never reclassify,
 * re-derive, or reconstruct evidence. Every value it returns is carried
 * straight from a `CaseEvidenceRecord`, so the three tabs, the PDF and the
 * scorer cannot disagree about a fact — only about how much of it to show.
 *
 * INVARIANT vs INTENTIONAL DIFFERENCE (docs/technical.md is the reference):
 *
 *   invariant       — recordId, provenance, validity, quality,
 *                     citation.eligibility, status, labelToken. Every surface
 *                     that shows a record shows the SAME values for these.
 *   intentional     — which records appear, their order, how verbose the copy
 *                     is, and the two-layer non-disclosure split.
 *
 * The bank projection is the one with teeth: raw AVS/CVV codes and internal
 * signals must never reach it, and every projected row must remain traceable
 * to its canonical record so a reviewer can ask "where did this come from".
 */

import type {
  CaseEvidenceModel,
  CaseEvidenceRecord,
  EvidenceRecordId,
  FieldEvidenceSummary,
} from "./types";
import type { EvidenceFieldKey } from "./domains";
import { definitionFor } from "./definitions";
import { QUALITY_RANK, type EvidenceQuality } from "./vocabulary";
import type { I18nToken } from "@/lib/i18n/token";

/** One row on a merchant surface. Traceable to its record by construction. */
export interface MerchantEvidenceRow {
  /** The canonical record this row displays. Never synthesised. */
  recordId: EvidenceRecordId;
  fieldKey: EvidenceFieldKey;
  labelToken: I18nToken;
  quality: EvidenceQuality | null;
  available: boolean;
  /** Present but deliberately not shown to the issuer. Merchant-only context. */
  keptInternal: boolean;
  /** How many further records this row stands for (collapsed siblings). */
  alsoRepresents: number;
}

/** One row destined for the issuer. */
export interface BankEvidenceRow {
  recordId: EvidenceRecordId;
  fieldKey: EvidenceFieldKey;
  quality: EvidenceQuality;
}

function orderedFields(model: CaseEvidenceModel): FieldEvidenceSummary[] {
  return Object.values(model.fields);
}

function representative(summary: FieldEvidenceSummary): CaseEvidenceRecord | null {
  if (!summary.representativeId) return summary.records[0] ?? null;
  return (
    summary.records.find((r) => r.recordId === summary.representativeId) ??
    summary.records[0] ??
    null
  );
}

/**
 * OVERVIEW — one row per signal, best quality first.
 *
 * Collapses declared siblings (`delivery_proof` + `shipping_tracking`) using
 * the definition's `collapsesWith`, replacing the four hand-written delivery
 * collapses. Crucially it collapses by DECLARATION, not by a local scoring
 * heuristic, so the surviving row is the same one every other surface names.
 */
export function selectForOverview(model: CaseEvidenceModel): MerchantEvidenceRow[] {
  const suppressed = new Set<string>();
  for (const summary of orderedFields(model)) {
    const sibling = definitionFor(summary.fieldKey).aggregation.collapsesWith;
    // Only collapse when the surviving side actually has evidence; otherwise a
    // tracking-only dispute would show nothing at all.
    if (sibling && summary.status.available) suppressed.add(sibling);
  }

  const rows: MerchantEvidenceRow[] = [];
  for (const summary of orderedFields(model)) {
    if (suppressed.has(summary.fieldKey)) continue;
    if (summary.records.length === 0) continue;
    const rep = representative(summary);
    if (!rep) continue;
    rows.push({
      recordId: rep.recordId,
      fieldKey: summary.fieldKey,
      labelToken: definitionFor(summary.fieldKey).labelToken,
      quality: summary.quality,
      available: summary.status.available,
      keptInternal: rep.citation.eligibility === "withheld_internal",
      alsoRepresents: Math.max(summary.records.length - 1, 0),
    });
  }
  return rows.sort(
    (a, b) =>
      QUALITY_RANK[b.quality ?? "contextual"] - QUALITY_RANK[a.quality ?? "contextual"],
  );
}

/**
 * EVIDENCE TAB — every record, nothing collapsed.
 *
 * The merchant is entitled to see each parcel and each message individually;
 * this is where the multi-record model pays off. Deliberately different from
 * Overview, and that difference is documented rather than emergent.
 */
export function selectForEvidence(model: CaseEvidenceModel): MerchantEvidenceRow[] {
  const rows: MerchantEvidenceRow[] = [];
  for (const summary of orderedFields(model)) {
    for (const record of summary.records) {
      rows.push({
        recordId: record.recordId,
        fieldKey: summary.fieldKey,
        labelToken: definitionFor(summary.fieldKey).labelToken,
        quality: record.quality,
        available: record.validity.state === "valid",
        keptInternal: record.citation.eligibility === "withheld_internal",
        alsoRepresents: 0,
      });
    }
  }
  return rows;
}

/**
 * BANK — only records the issuer may see.
 *
 * The two-layer non-disclosure rule made structural: anything not `eligible`
 * is absent, so a `withheld_internal` device signal or a `withheld_risk`
 * attempted-3DS cannot reach the issuer even if a renderer asks for it. Raw
 * AVS/CVV codes never appear because this returns no payload at all —
 * bank-facing prose is composed from tokens downstream.
 */
export function selectForBank(model: CaseEvidenceModel): BankEvidenceRow[] {
  const rows: BankEvidenceRow[] = [];
  const suppressed = new Set<string>();
  for (const summary of orderedFields(model)) {
    const sibling = definitionFor(summary.fieldKey).aggregation.collapsesWith;
    if (sibling && summary.citableIds.length > 0) suppressed.add(sibling);
  }

  for (const summary of orderedFields(model)) {
    if (suppressed.has(summary.fieldKey)) continue;
    for (const record of summary.records) {
      if (record.citation.eligibility !== "eligible") continue;
      if (!record.quality) continue;
      rows.push({
        recordId: record.recordId,
        fieldKey: summary.fieldKey,
        quality: record.quality,
      });
    }
  }
  return rows;
}

/**
 * Every recordId any projection can emit. The traceability check: a row on a
 * surface must correspond to a canonical record, never to something a
 * renderer invented.
 */
export function allRecordIds(model: CaseEvidenceModel): Set<EvidenceRecordId> {
  const ids = new Set<EvidenceRecordId>();
  for (const summary of orderedFields(model)) {
    for (const r of summary.records) ids.add(r.recordId);
  }
  return ids;
}
