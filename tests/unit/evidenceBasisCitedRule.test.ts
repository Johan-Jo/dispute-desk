/**
 * ONE rule for "cited to the bank": the letter's Evidence Basis and the dispute
 * page's roles answer it from the same predicate (lib/defence/citedFacts.ts).
 * An item is cited iff the letter relies on it.
 *
 * The change is FORWARD-ONLY. The Evidence Basis views are rendered at view time
 * from stored `facts_json`, so the new rule is gated by a stamp only a new build
 * writes (`document_provenance_json.evidenceBasisRule`). The first block proves
 * an unstamped package renders EXACTLY as it did before the change, against a
 * golden produced by the pre-change code (`legacyEvidenceBasis.golden.json`,
 * generated from origin/develop at 448bd2ee).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import { evidenceBasisFor } from "@/lib/defence/render/documentModel";
import {
  argumentFactIdsOfNarrative,
  CURRENT_EVIDENCE_BASIS_RULE,
  EVIDENCE_BASIS_RULE_CITED,
  EVIDENCE_BASIS_RULE_LEGACY,
  evidenceBasisRuleOf,
  isCitedFact,
} from "@/lib/defence/citedFacts";
import { isBankIncludedFact } from "@/lib/defence/bankInclusion";
import { buildDocumentProvenance } from "@/lib/defence/package/documentProvenance";
import { evidenceFieldOfFact, letterCitations } from "@/lib/disputes/letterCitations";
import { buildDisputeRecord, type ItemKey } from "@/lib/disputes/disputeRecord";
import { createRecordFormat } from "@/lib/disputes/recordFormat";
import type { DefenceNarrativeOutput } from "@/lib/defence/types";
import { recordInputsFromWorkspace } from "../../app/(embedded)/app/disputes/[id]/record/recordInputs";
import { openWorkspace } from "../fixtures/disputeRecordFixture";
import { narrativeJson } from "../fixtures/defencePackageShapes";
import { SHAPES, type Shape } from "../fixtures/evidenceBasisShapes";
import golden from "../fixtures/legacyEvidenceBasis.golden.json";

const facts = (s: Shape) => s.facts as never[];
const shape = (name: string) => SHAPES.find((s) => s.name === name) as Shape;
const labels = (rows: Array<{ label: string }>) => rows.map((r) => r.label);
const idOf = (s: Shape, category: string) => (s.facts.find((f) => f.category === category) as { id: string }).id;

type SectionKey =
  | "executiveSummary"
  | "transactionOverviewArgument"
  | "chronologyArgument"
  | "paymentAuthenticationArgument"
  | "fulfillmentArgument"
  | "communicationArgument"
  | "policyArgument"
  | "manualEvidenceArgument"
  | "conclusion";

/** A counsel-style narrative whose named sections print prose citing the given fact ids. */
function narrativeCiting(cites: Partial<Record<SectionKey, string[]>>, omitted: SectionKey[] = []): DefenceNarrativeOutput {
  const n = narrativeJson(Object.fromEntries(Object.keys(cites).map((k) => [k, "Prose."]))) as unknown as Record<string, any>;
  for (const [k, ids] of Object.entries(cites)) n[k].usedFactIds = ids;
  n.omittedSections = omitted.map((sectionKey) => ({ sectionKey, reason: "none" }));
  return n as unknown as DefenceNarrativeOutput;
}

/** Table rows of a NEW package whose letter prints `narrative`. */
function newRows(s: Shape, narrative?: DefenceNarrativeOutput) {
  return evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED, argumentFactIdsOfNarrative(narrative, null));
}

describe("legacy packages render exactly as they did before the change", () => {
  for (const s of SHAPES) {
    it(`${s.name}: rows, card filtering and table visibility are byte-identical`, () => {
      const basis = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_LEGACY);
      const now = {
        allRows: buildEvidenceBasisRows(facts(s)),
        letterRows: basis.rows,
        pdfTable: basis.tableAllowed && basis.rows.length > 0,
        htmlTable: basis.tableAllowed && !(basis.single && basis.rows.length === 0),
      };
      expect(JSON.stringify(now)).toBe(JSON.stringify((golden as Record<string, unknown>)[s.name]));
    });
  }

  it("an absent, null, malformed or unknown stamp is the legacy rule", () => {
    for (const stamp of [undefined, null, {}, { evidenceBasisRule: 1 }, { evidenceBasisRule: "2" }, { evidenceBasisRule: 3 }, 2, "2", []]) {
      expect(evidenceBasisRuleOf(stamp)).toBe(EVIDENCE_BASIS_RULE_LEGACY);
    }
    expect(evidenceBasisRuleOf({ evidenceBasisRule: 2 })).toBe(EVIDENCE_BASIS_RULE_CITED);
  });

  it("a build records the stamp only for the cited rule; the legacy map is unchanged", () => {
    const input = { blocks: [], composedFacts: facts(shape("fraud_clean")) };
    const legacy = buildDocumentProvenance(input);
    expect(legacy).not.toHaveProperty("evidenceBasisRule");
    expect(JSON.stringify(buildDocumentProvenance({ ...input, evidenceBasisRule: EVIDENCE_BASIS_RULE_LEGACY }))).toBe(
      JSON.stringify(legacy),
    );
    const stamped = buildDocumentProvenance({ ...input, evidenceBasisRule: CURRENT_EVIDENCE_BASIS_RULE });
    expect(stamped.evidenceBasisRule).toBe(EVIDENCE_BASIS_RULE_CITED);
    expect(evidenceBasisRuleOf(stamped)).toBe(EVIDENCE_BASIS_RULE_CITED);
  });
});

describe("the cited rule: an item is cited iff the letter relies on it", () => {
  it("dispute #368528: the table lists what the page marks cited; the delivery is cited by its section", () => {
    const s = shape("captured:open_368528_v1");
    const legacy = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_LEGACY).rows;
    const cited = newRows(s).rows;
    expect(labels(legacy)).toContain("Order record");
    expect(labels(cited).sort()).toEqual(
      ["IP & location consistency", "No return recorded in Shopify", "Pre-authorization fraud screening"].sort(),
    );
    // each fact once: the carrier card prints the delivery, the table does not repeat it
    expect(labels(cited)).not.toContain("Delivery confirmation");
    expect(letterCitations({ facts_json: s.facts, document_provenance_json: { evidenceBasisRule: 2 }, pdf_path: "x.pdf" })?.citedFields).toContain(
      "shipping_tracking",
    );
  });

  it("a delivery with no carrier card still prints its row, as it always did", () => {
    const s = shape("not_received_delivered");
    const noCard = s.facts.map((f) =>
      f.category === "delivery_proof" || f.category === "shipping_tracking"
        ? { ...f, value: { ...f.value, carrier: null, trackingNumber: null, trackingUrl: null } }
        : f,
    );
    const rows = evidenceBasisFor(noCard as never[], EVIDENCE_BASIS_RULE_CITED).rows;
    expect(labels(rows)).toContain("Delivery confirmation");
    expect(labels(rows)).not.toContain("Order record");
  });

  for (const s of SHAPES) {
    it(`${s.name}: even when the letter cites EVERY fact, only bank-included cited facts are listed`, () => {
      const everything = narrativeCiting({
        policyArgument: s.facts.map((f) => f.id),
        fulfillmentArgument: s.facts.map((f) => f.id),
      });
      for (const narrative of [undefined, everything]) {
        const rows = newRows(s, narrative).rows;
        const byId = new Map(s.facts.map((f) => [f.id, f]));
        const argued = argumentFactIdsOfNarrative(narrative, null);
        for (const r of rows) {
          const f = byId.get(r.factId) as never as (typeof s.facts)[number];
          expect(isBankIncludedFact(f as never), `${r.label} must be bank-included`).toBe(true);
          expect(isCitedFact(f as never, argued), `${r.label} must be cited`).toBe(true);
          expect(f.submissionRisk).toBe(false);
          expect(f.bankEligible).toBe(true);
        }
        // PROPERTY: every bank-included fact a printed argument cites is listed
        // (or is the delivery a carrier card prints), so a section never argues
        // from something the table refuses to show.
        for (const id of argued) {
          const f = byId.get(id);
          if (!f || !isBankIncludedFact(f as never)) continue;
          const isDelivery = f.category === "delivery_proof" || f.category === "shipping_tracking";
          expect(isDelivery || rows.some((r) => r.factId === id), `${f.label} is argued but not listed`).toBe(true);
        }
      }
    });
  }

  it("adverse facts are never listed, whatever the narrative cites", () => {
    const s = shape("never_cited");
    const all = narrativeCiting({ policyArgument: s.facts.map((f) => f.id), paymentAuthenticationArgument: s.facts.map((f) => f.id) });
    expect(newRows(s).rows).toEqual([]);
    // The order record is the one bank-included record fact: listed only because it is argued.
    expect(labels(newRows(s, all).rows)).toEqual(["Order record"]);
    expect(JSON.stringify(newRows(s, all).rows)).not.toMatch(/CANCEL|different|AVS|Payment authentication|Pre-authorization|IP &/i);
  });

  it("credit-not-processed: the refund policy is listed iff the letter argues from it", () => {
    const s = shape("credit_not_processed");
    const policy = idOf(s, "policy_refund");
    expect(labels(newRows(s).rows)).not.toContain("Refund policy");
    expect(labels(newRows(s, narrativeCiting({ policyArgument: [policy] })).rows)).toContain("Refund policy");
    // the summary and conclusion restate the case; they do not make a policy "relied on"
    expect(labels(newRows(s, narrativeCiting({ executiveSummary: [policy], conclusion: [policy] })).rows)).not.toContain("Refund policy");
    // an omitted section prints nothing, so it relies on nothing
    expect(labels(newRows(s, narrativeCiting({ policyArgument: [policy] }, ["policyArgument"])).rows)).not.toContain("Refund policy");
    // the order record is context unless argued, too
    expect(labels(newRows(s).rows)).not.toContain("Order record");
  });

  it("not-received: the shipping policy is listed iff the letter argues from it", () => {
    const s = shape("not_received_delivered");
    const policy = idOf(s, "policy_shipping");
    expect(labels(newRows(s).rows)).not.toContain("Shipping policy");
    expect(labels(newRows(s, narrativeCiting({ fulfillmentArgument: [policy] })).rows)).toContain("Shipping policy");
  });

  it("record context and arguments that are never scored: the in-transit shipment and the listing are cited", () => {
    expect(labels(newRows(shape("not_as_described")).rows)).toEqual(["Product listing"]);
  });

  it("a multi-parcel letter prints the table too, without repeating its parcel cards", () => {
    const s = shape("not_received_multi_parcel");
    expect(evidenceBasisFor(facts(s), 1).tableAllowed).toBe(false);
    const n = newRows(s);
    expect(n.tableAllowed).toBe(true);
    expect(n.rows).toEqual([]);
  });
});

/* ── Page and letter agree ── */

const FIELD_FOR_ITEM: Partial<Record<ItemKey, string>> = {
  pay: "avs_cvv_match",
  screen: "fraud_risk_screening",
  ip: "ip_location_check",
  delivery: "shipping_tracking",
  return: "no_return_initiated",
  order: "order_confirmation",
  history: "activity_log",
  shipping: "shipping_policy",
  refundpol: "refund_policy",
  cancel: "cancellation_policy",
  tds: "tds_authentication",
  comms: "customer_communication",
};
const ITEM_FIELDS = new Set(Object.values(FIELD_FOR_ITEM) as string[]);
const ALL_LINE_FIELDS = [
  "avs_cvv_match", "tds_authentication", "fraud_risk_screening", "order_confirmation", "ip_location_check",
  "customer_communication", "shipping_tracking", "no_return_initiated", "activity_log", "shipping_policy",
  "refund_policy", "cancellation_policy",
];

function recordFor(s: Shape, stamp: { evidenceBasisRule: number } | null, narrative: DefenceNarrativeOutput | null = null, status = "final") {
  const w = JSON.parse(JSON.stringify(openWorkspace())) as Record<string, any>;
  const have = new Set(s.lines.map((l) => l.field));
  const lines = [...s.lines];
  for (const field of ALL_LINE_FIELDS) {
    if (!have.has(field)) lines.push({ field, hasEvidence: false, submissionMethod: "not_included", strengthContribution: "none" });
  }
  w.evidenceLineItems = lines.map((l) => ({ id: `line:${l.field}`, label: l.field, ...l }));
  w.defencePackage.latest = {
    ...w.defencePackage.latest,
    status,
    facts_json: s.facts,
    narrative_json: narrative,
    document_provenance_json: stamp,
  };
  return buildDisputeRecord(recordInputsFromWorkspace(w as unknown as Parameters<typeof recordInputsFromWorkspace>[0], "2026-11-06T12:00:00Z"), createRecordFormat("en"));
}

function citedItemFields(rec: ReturnType<typeof recordFor>): string[] {
  return rec.items
    .filter((i) => i.role === "cited")
    .map((i) => FIELD_FOR_ITEM[i.key])
    .filter((f): f is string => Boolean(f))
    .sort();
}

/** What a NEW letter cites: its table rows, plus the delivery its section sets out. */
function expectedNewCited(s: Shape, narrative?: DefenceNarrativeOutput): string[] {
  const byId = new Map(s.facts.map((f) => [f.id, f]));
  const out = new Set<string>();
  for (const r of newRows(s, narrative).rows) {
    const f = byId.get(r.factId);
    const field = f ? evidenceFieldOfFact(f as never) : null;
    if (field && ITEM_FIELDS.has(field)) out.add(field);
  }
  if (s.facts.some((f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && isBankIncludedFact(f as never))) {
    out.add("shipping_tracking");
  }
  return [...out].sort();
}

describe("the dispute page and the letter's Evidence Basis cite the same items", () => {
  const stamp = { evidenceBasisRule: 2 };
  for (const s of SHAPES) {
    it(`${s.name} (new package): the page's cited set equals what the letter relies on`, () => {
      expect(citedItemFields(recordFor(s, stamp))).toEqual(expectedNewCited(s));
      const everything = narrativeCiting({ policyArgument: s.facts.map((f) => f.id) });
      expect(citedItemFields(recordFor(s, stamp, everything))).toEqual(expectedNewCited(s, everything));
    });

    it(`${s.name} (legacy package): the page says only what the stored letter says`, () => {
      const rec = recordFor(s, null);
      const basis = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_LEGACY);
      const byId = new Map(s.facts.map((f) => [f.id, f]));
      const listed = new Set<string>();
      if (basis.tableAllowed) {
        for (const r of basis.rows) {
          const f = byId.get(r.factId);
          const field = f ? evidenceFieldOfFact(f as never) : null;
          if (field) listed.add(field);
        }
      }
      if (s.facts.some((f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && isBankIncludedFact(f as never))) {
        listed.add("shipping_tracking");
      }
      for (const field of citedItemFields(rec)) expect(listed.has(field), `${field} is not in the legacy letter`).toBe(true);
    });
  }

  it("a policy the letter argues from is cited on the page AND listed; one it does not is context and not listed", () => {
    const s = shape("credit_not_processed");
    const policy = idOf(s, "policy_refund");
    const argued = narrativeCiting({ policyArgument: [policy] });
    const withArgument = recordFor(s, stamp, argued);
    const without = recordFor(s, stamp, narrativeCiting({ chronologyArgument: [idOf(s, "no_return_initiated")] }));
    expect(withArgument.items.find((i) => i.key === "refundpol")?.role).toBe("cited");
    expect(labels(newRows(s, argued).rows)).toContain("Refund policy");
    expect(without.items.find((i) => i.key === "refundpol")?.role).toBe("context");
    expect(labels(newRows(s, narrativeCiting({ chronologyArgument: [idOf(s, "no_return_initiated")] })).rows)).not.toContain("Refund policy");
  });

  it("the open case: Order record is context on the new page, cited on a legacy one (that is what its letter lists)", () => {
    const s = shape("captured:open_368528_v1");
    const fresh = recordFor(s, stamp);
    const legacy = recordFor(s, null);
    expect(fresh.items.find((i) => i.key === "order")?.role).toBe("context");
    expect(fresh.items.filter((i) => i.role === "cited").map((i) => i.key).sort()).toEqual(["delivery", "ip", "return", "screen"]);
    expect(legacy.items.find((i) => i.key === "order")?.role).toBe("cited");
    expect(legacy.items.find((i) => i.key === "delivery")?.role).toBe("cited");
  });

  it("a failed or skipped build printed no letter: the page keeps the live evidence reading", () => {
    const s = shape("captured:open_368528_v1");
    for (const status of ["failed", "skipped"]) {
      expect(letterCitations({ facts_json: s.facts, status, pdf_path: "x.pdf" })).toBeNull();
    }
    expect(letterCitations({ facts_json: s.facts, status: "final", pdf_path: "x.pdf" })).not.toBeNull();
    // a row whose letter was never printed (no PDF) is no letter either
    expect(letterCitations({ facts_json: s.facts, status: "superseded", pdf_path: null })).toBeNull();
  });

  it("the delivery is cited only where the letter prints it (card or table row)", () => {
    const s = shape("not_received_delivered");
    // no carrier card (no carrier / tracking) but a table row: still cited
    const noCard = s.facts.map((f) =>
      f.category === "delivery_proof" || f.category === "shipping_tracking"
        ? { ...f, value: { ...f.value, carrier: null, trackingNumber: null, trackingUrl: null } }
        : f,
    );
    const stamp = { evidenceBasisRule: 2 };
    expect(letterCitations({ facts_json: noCard, document_provenance_json: stamp, pdf_path: "x" })?.citedFields).toContain("shipping_tracking");
    // a delivery fact the letter does not list and no card prints is not claimed
    const hidden = s.facts.map((f) => (f.category === "delivery_proof" || f.category === "shipping_tracking" ? { ...f, includeInBankNarrative: false } : f));
    expect(letterCitations({ facts_json: hidden, document_provenance_json: stamp, pdf_path: "x" })?.citedFields).not.toContain("shipping_tracking");
  });

  it("argumentFactIdsOfNarrative counts only printed argument sections (mutation guards)", () => {
    const policy = idOf(shape("credit_not_processed"), "policy_refund");
    const n = narrativeCiting({ policyArgument: [policy] });
    expect(argumentFactIdsOfNarrative(n, null).has(policy)).toBe(true);
    // an omitted section prints nothing (guards the `omitted` check)
    expect(argumentFactIdsOfNarrative(narrativeCiting({ policyArgument: [policy] }, ["policyArgument"]), null).has(policy)).toBe(false);
    // a model-written section the reason code denies prints nothing (guards the `isSectionShown` check)
    expect(argumentFactIdsOfNarrative(n, "visa_10_4_fraud").has(policy)).toBe(false);
    // ...but a record-built one prints even there
    const record = narrativeCiting({ policyArgument: [policy] });
    (record.policyArgument as { source?: string }).source = "record";
    expect(argumentFactIdsOfNarrative(record, "visa_10_4_fraud").has(policy)).toBe(true);
    // empty text prints nothing
    const empty = narrativeCiting({ policyArgument: [policy] });
    empty.policyArgument.text = "  ";
    expect(argumentFactIdsOfNarrative(empty, null).has(policy)).toBe(false);
    // the summary and conclusion never count in the narrative reader
    expect(argumentFactIdsOfNarrative(narrativeCiting({ executiveSummary: [policy], conclusion: [policy] }), null).has(policy)).toBe(false);
  });
});

/* ── No hash rotation, no regeneration ── */

describe("the stamp touches no identity the pipeline compares", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  it("evidence_hash, plan_input_hash and the staleness readers never see the rule", () => {
    for (const rel of [
      "lib/defence/computeEvidenceHash.ts",
      "lib/argument/plan/planInputHash.ts",
      "lib/defence/enqueue.ts",
      "lib/defence/latestPackageGenerationGuard.ts",
      "lib/defence/package/loadFileableSelection.ts",
      "lib/defence/package/selectFileablePackage.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/evidenceBasisRule|citedFacts/);
    }
  });
  it("the stamp lives in document_provenance_json, never in narrative_json (the safety parser refuses unknown keys)", () => {
    const job = read("lib/jobs/handlers/buildDefencePackageJob.ts");
    expect(job).toMatch(/evidenceBasisRule: CURRENT_EVIDENCE_BASIS_RULE/);
    expect(job).not.toMatch(/narrative_json:\s*\{/);
  });
});
