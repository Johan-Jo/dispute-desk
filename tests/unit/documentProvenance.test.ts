/**
 * Layer 0 — the provenance map must match the DOCUMENT.
 *
 * ── WHY THIS TEST INSPECTS THE DOCUMENT, NOT JUST THE MAP ────────────
 *
 * The original defect was two self-consistent surfaces telling different
 * stories: the tabs and the PDF each answered "is this in the letter?" from
 * their own inputs, both were internally coherent, and the composition was
 * false. 96 tests were green throughout.
 *
 * Checking the merchant UI against the producer's own map would rebuild that
 * failure one layer up — map and UI agree while the rendered document says
 * something else. So these tests walk the composed blocks and the Evidence
 * Basis rows independently and assert the map matches what is actually
 * there. The map is the thing under test; the document is the oracle.
 *
 * Plan: docs/plans/plan-projection-drift.plan.md §6 Layer 0.
 */

import { describe, it, expect } from "vitest";
import {
  PROVENANCE_VERSION,
  buildDocumentProvenance,
  inclusionStateFor,
} from "@/lib/defence/package/documentProvenance";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import type { ComposedDocumentBlock, EvidenceFact } from "@/lib/defence/types";

function fact(
  recordId: string,
  category: string,
  over: Partial<EvidenceFact> = {},
): EvidenceFact {
  return {
    id: recordId,
    label: recordId,
    value: { fieldKey: recordId.split("#")[0] },
    source: "shopify_order",
    category,
    strength: "moderate",
    sourceRef: null,
    confidence: null,
    bankEligible: true,
    internalOnly: false,
    submissionRisk: false,
    merchantVisible: true,
    includeInBankNarrative: true,
    ...over,
  } as unknown as EvidenceFact;
}

function block(
  over: Partial<ComposedDocumentBlock> = {},
): ComposedDocumentBlock {
  return {
    sectionKey: "executiveSummary",
    heading: "Executive Summary",
    thesisText: "",
    llmText: "",
    fallbackText: "",
    usedFactIds: [],
    ...over,
  } as ComposedDocumentBlock;
}

describe("Layer 0 — map vs the rendered document", () => {
  it("every Evidence Basis row the document renders appears in the map", () => {
    // The surface a narrative-only reading misses: `buildEvidenceBasisRows`
    // takes the WHOLE composed fact list, so a fact reaches the table having
    // been cited in no prose at all.
    const facts = [
      fact("no_return_initiated#0", "no_return_initiated"),
      fact("order_confirmation#0", "order_record"),
    ];
    const blocks = [
      block({ llmText: "Prose citing only one fact.", usedFactIds: ["order_confirmation#0"] }),
    ];

    const map = buildDocumentProvenance({ blocks, composedFacts: facts });

    // Derive the truth from the document itself, independently of the map.
    const renderedIds = buildEvidenceBasisRows([...facts])
      .map((r) => r.factId)
      .filter(Boolean);

    expect(renderedIds.length).toBeGreaterThan(0);
    for (const id of renderedIds) {
      expect(
        map.records[id],
        `record ${id} renders in the Evidence Basis but is absent from the map`,
      ).toBeDefined();
      expect(map.records[id].surfaces).toContain("evidence_basis");
    }
  });

  it("a fact cited in NO prose is still recorded as included", () => {
    // Guards the under-count that narrative-only provenance would produce.
    const uncited = fact("no_return_initiated#0", "no_return_initiated");
    const map = buildDocumentProvenance({
      blocks: [block({ llmText: "Mentions nothing.", usedFactIds: [] })],
      composedFacts: [uncited],
    });

    expect(inclusionStateFor(map, "no_return_initiated#0")).toBe("included");
  });

  it("narrative citations are recorded against the narrative surface", () => {
    const f = fact("delivery_proof#0", "delivery_proof");
    const map = buildDocumentProvenance({
      blocks: [
        block({
          sectionKey: "fulfillmentArgument",
          llmText: "The carrier confirmed delivery.",
          usedFactIds: ["delivery_proof#0"],
        }),
      ],
      composedFacts: [f],
    });

    expect(map.records["delivery_proof#0"].surfaces).toContain("narrative");
  });

  it("a block that rendered NO text contributes nothing", () => {
    // An omitted section must not create provenance for the facts it would
    // have cited — that would assert inclusion for text nobody can read.
    const f = fact("policy#0", "policy_shipping");
    const map = buildDocumentProvenance({
      blocks: [block({ llmText: "   ", usedFactIds: ["policy#0"] })],
      composedFacts: [],
    });

    expect(map.records["policy#0"]).toBeUndefined();
    void f;
  });

  it("deterministic fallback prose is TRACED to its authorising records", () => {
    /* The correction that matters: on the canonical route the fulfilment
     * fallback is NOT unbacked. `composePdfBlocks` renders it only when
     * `hasFulfillmentClaimAuthority` holds over the composed facts, so the
     * authorising records are knowable even though the prose cites no ids.
     * Attributing it to "no record" would under-report real evidence. */
    const delivered = fact("delivery_proof#0", "delivery_proof", {
      value: {
        fieldKey: "delivery_proof",
        proofType: "delivered_confirmed",
      } as unknown as EvidenceFact["value"],
    });

    const map = buildDocumentProvenance({
      blocks: [
        block({
          sectionKey: "fulfillmentArgument",
          fallbackText: "The order was fulfilled.",
          usedFactIds: [],
        }),
      ],
      composedFacts: [delivered],
    });

    const rec = map.records["delivery_proof#0"];
    expect(rec, "the authorising record must be attributed").toBeDefined();
    expect(rec.surfaces).toContain("deterministic_section");
    // It is also in the Evidence Basis, so `direct` wins over `traced`.
    expect(rec.attribution).toBe("direct");
  });

  it("fallback prose with NO authorising record is recorded as unattributed", () => {
    // The honest alternative to inventing an attribution: the surface is
    // named as unattributed rather than tied to a record or dropped.
    const map = buildDocumentProvenance({
      blocks: [
        block({
          sectionKey: "fulfillmentArgument",
          fallbackText: "Some deterministic sentence.",
          usedFactIds: [],
        }),
      ],
      composedFacts: [],
    });

    expect(map.unattributedSurfaces).toContain("deterministic_section");
    expect(Object.keys(map.records)).toEqual([]);
  });
});

describe("Layer 0 — unknown never becomes a confident negative", () => {
  it("a MISSING map yields cannot_determine, not not_included", () => {
    // Every package generated before this map existed. The honest answer is
    // "cannot be determined" — NOT "we did not cite it".
    expect(inclusionStateFor(null, "anything#0")).toBe("cannot_determine");
    expect(inclusionStateFor(undefined, "anything#0")).toBe("cannot_determine");
  });

  it("an INCOMPLETE map yields cannot_determine for absent records", () => {
    const partial = {
      provenanceVersion: PROVENANCE_VERSION,
      complete: false,
      records: {},
      unattributedSurfaces: [],
    };
    expect(inclusionStateFor(partial, "absent#0")).toBe("cannot_determine");
  });

  it("a COMPLETE map yields not_included for absent records", () => {
    // Absence is a negative only when the producer asserts it walked
    // everything. This is the one state where the negative is earned.
    const complete = {
      provenanceVersion: PROVENANCE_VERSION,
      complete: true,
      records: {},
      unattributedSurfaces: [],
    };
    expect(inclusionStateFor(complete, "absent#0")).toBe("not_included");
  });

  it("an UNSUPPORTED provenanceVersion yields cannot_determine", () => {
    const future = {
      provenanceVersion: PROVENANCE_VERSION + 99,
      complete: true,
      records: { "x#0": { surfaces: ["narrative" as const], attribution: "direct" as const } },
      unattributedSurfaces: [],
    };
    // Even for a record the map CONTAINS: we cannot read the shape, so we
    // cannot vouch for what it means.
    expect(inclusionStateFor(future, "x#0")).toBe("cannot_determine");
  });
});
