/**
 * Document provenance — which records the produced document actually
 * rendered, and on which surface.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * "Included in the letter" is a claim about a DOCUMENT, and until now no
 * consumer could check it. The merchant tabs answered it from
 * `checklist + payload`, which is not the document at all — that is the
 * defect this module's plan was written for. `plan.included` cannot answer
 * it either: the plan AUTHORISES a record, composition may still drop it,
 * and `bankIncludedFacts` may filter it. Authorisation, inclusion and
 * submission are three different properties and each needs its own source.
 *
 * So the producer records what it rendered, at the moment it renders it,
 * and consumers project that. Nobody re-derives it downstream.
 *
 * ── WHY `complete` IS AN ASSERTION, NOT AN INFERENCE ─────────────────
 *
 * A reader cannot tell "this record reached no surface" from "the walk that
 * would have found it never ran". Both look like absence. Treating the
 * second as the first turns an unknown into a confident negative — the
 * mirror of the bug that started this work, where eligibility became a
 * confident positive. Only the producer knows whether it walked every
 * surface, so only the producer may say so.
 *
 * ── ATTRIBUTION TIERS ────────────────────────────────────────────────
 *
 *   direct  — the surface names the record (`usedFactIds`, `factId`).
 *   traced  — the surface asserts on authority DERIVED from a known fact
 *             set, without naming ids. The deterministic fulfilment
 *             paragraph is the case: `hasFulfillmentClaimAuthority`
 *             computes it from the composed facts, so the records that
 *             authorise the sentence are knowable even though the prose
 *             cites nothing.
 *   unknown — rendered content that cannot be tied to records at all.
 *             Recorded as an unattributed surface, never silently dropped
 *             and never attributed to a record to make the map look tidy.
 */

import type { ComposedDocumentBlock, EvidenceFact } from "../types";
import { buildEvidenceBasisRows } from "../pdf/evidenceBasisRows";
import { hasFulfillmentClaimAuthority } from "./fulfillmentClaimAuthority";

/** Bumped when the MAP's shape changes. */
export const PROVENANCE_VERSION = 1;

/**
 * Rendered surfaces of the defence document.
 *
 * Deliberately not just "narrative": narrative citation ids are one surface
 * of several, and reading them as the whole inventory under-reports the
 * Evidence Basis (which renders every fact, cited in prose or not).
 */
export type DocumentSurface =
  | "evidence_basis"
  | "narrative"
  | "thesis"
  | "deterministic_section";

export type ProvenanceAttribution = "direct" | "traced";

export interface RecordProvenance {
  surfaces: DocumentSurface[];
  attribution: ProvenanceAttribution;
}

export interface DocumentProvenanceMap {
  provenanceVersion: number;
  /**
   * True only when every rendered surface was walked. A `false` map — and a
   * missing map — means "cannot be determined", never "not included".
   */
  complete: boolean;
  records: Record<string, RecordProvenance>;
  /** Rendered content that no record could be tied to. */
  unattributedSurfaces: DocumentSurface[];
}

export interface BuildProvenanceInput {
  /** The blocks actually composed into the document. */
  blocks: readonly ComposedDocumentBlock[];
  /** The facts the document was composed from (already record-id labelled). */
  composedFacts: readonly EvidenceFact[];
}

function add(
  into: Map<string, Set<DocumentSurface>>,
  recordId: string,
  surface: DocumentSurface,
): void {
  const existing = into.get(recordId);
  if (existing) existing.add(surface);
  else into.set(recordId, new Set([surface]));
}

/**
 * Walk the produced document and record what it rendered.
 *
 * Called by the producer AFTER composition, over the very blocks and facts
 * that became the PDF — not over the plan, and not over anything the reader
 * could have recomputed. That is what makes the result evidence rather than
 * a second opinion.
 */
export function buildDocumentProvenance(
  input: BuildProvenanceInput,
): DocumentProvenanceMap {
  const surfaces = new Map<string, Set<DocumentSurface>>();
  const traced = new Set<string>();
  const unattributed = new Set<DocumentSurface>();

  /* Surface 1 — Evidence Basis. Built from the WHOLE composed fact list, so
   * a fact reaches it having been cited in no prose at all. This is the
   * surface a narrative-only reading misses. */
  for (const row of buildEvidenceBasisRows([...input.composedFacts])) {
    if (row.factId) add(surfaces, row.factId, "evidence_basis");
  }

  /* Surfaces 2 + 3 — narrative blocks and their theses. `usedFactIds` is the
   * only per-record citation the document carries. A block that rendered
   * text while citing nothing is real (deterministic fallbacks do exactly
   * that) and is handled below rather than being attributed to a record. */
  for (const block of input.blocks) {
    const rendered =
      block.llmText.trim().length > 0 ||
      block.thesisText.trim().length > 0 ||
      block.fallbackText.trim().length > 0;
    if (!rendered) continue;

    const cited = block.usedFactIds ?? [];
    for (const id of cited) {
      if (block.llmText.trim().length > 0) add(surfaces, id, "narrative");
      if (block.thesisText.trim().length > 0) add(surfaces, id, "thesis");
    }

    /* Surface 4 — deterministic prose. It cites no ids, but on the canonical
     * route it is not unbacked: `composePdfBlocks` only renders the
     * fulfilment fallback when `hasFulfillmentClaimAuthority` holds over the
     * composed facts. So the authorising records ARE knowable — trace them
     * rather than declaring the surface unattributable. */
    if (block.fallbackText.trim().length > 0) {
      const authorising = fulfilmentAuthorisingRecordIds(input.composedFacts);
      if (authorising.length > 0) {
        for (const id of authorising) {
          add(surfaces, id, "deterministic_section");
          traced.add(id);
        }
      } else {
        // Rendered prose we cannot tie to any record. Recorded as such —
        // never attributed, never dropped.
        unattributed.add("deterministic_section");
      }
    }
  }

  const records: Record<string, RecordProvenance> = {};
  for (const [recordId, set] of surfaces) {
    const list = [...set].sort();
    records[recordId] = {
      surfaces: list,
      // `direct` wins: a record named by a citation is directly attributed
      // even if it also happens to authorise deterministic prose.
      attribution:
        list.some((s) => s !== "deterministic_section") || !traced.has(recordId)
          ? "direct"
          : "traced",
    };
  }

  return {
    provenanceVersion: PROVENANCE_VERSION,
    // Every surface above was walked, so the producer can honestly assert
    // completeness. If a future surface is added without being walked here,
    // this must become false rather than silently under-reporting.
    complete: true,
    records,
    unattributedSurfaces: [...unattributed].sort(),
  };
}

/**
 * Record ids whose facts authorise the deterministic fulfilment paragraph.
 *
 * Mirrors `hasFulfillmentClaimAuthority`'s own inputs rather than
 * re-implementing its rule: if it does not hold over the composed facts,
 * nothing is authorising and the caller records an unattributed surface.
 * The narrower per-fact attribution below is a superset only in the sense
 * that it names the facts the predicate consults.
 */
function fulfilmentAuthorisingRecordIds(
  facts: readonly EvidenceFact[],
): string[] {
  if (!hasFulfillmentClaimAuthority(facts)) return [];
  const out: string[] = [];
  for (const fact of facts) {
    const category = String(fact.category);
    if (
      category === "order_record" ||
      category === "order" ||
      category === "delivery_proof" ||
      category === "shipping_tracking"
    ) {
      out.push(fact.id);
    }
  }
  return out.sort();
}

/* ── Reader side ──────────────────────────────────────────────────── */

/**
 * What a consumer may truthfully say about one record's inclusion.
 *
 * `cannot_determine` is a first-class answer, not an error. It is what a
 * missing, incomplete or unreadable map yields, and it is the honest state
 * for every package generated before this map existed.
 */
export type InclusionState = "included" | "not_included" | "cannot_determine";

export function inclusionStateFor(
  map: DocumentProvenanceMap | null | undefined,
  recordId: string,
): InclusionState {
  if (!map || map.provenanceVersion !== PROVENANCE_VERSION) {
    return "cannot_determine";
  }
  if (map.records[recordId]) return "included";
  // Absence is only a negative on a map that claims to have looked
  // everywhere. Otherwise it is indistinguishable from "not walked".
  return map.complete ? "not_included" : "cannot_determine";
}
