/**
 * ONE rule for "cited to the bank": the letter's Evidence Basis and the dispute
 * page's roles answer it from the same predicate (lib/defence/citedFacts.ts).
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
import { recordInputsFromWorkspace } from "../../app/(embedded)/app/disputes/[id]/record/recordInputs";
import { openWorkspace } from "../fixtures/disputeRecordFixture";
import { SHAPES, type Shape } from "../fixtures/evidenceBasisShapes";
import golden from "../fixtures/legacyEvidenceBasis.golden.json";

const facts = (s: Shape) => s.facts as never[];
const shape = (name: string) => SHAPES.find((s) => s.name === name) as Shape;
const labels = (rows: Array<{ label: string }>) => rows.map((r) => r.label);

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

describe("the cited rule", () => {
  it("dispute #368528: the table lists what the page marks cited, and Delivery gets its row", () => {
    const s = shape("captured:open_368528_v1");
    const legacy = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_LEGACY).rows;
    const cited = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED).rows;
    // The page before: cited = fraud screening, IP, delivery, return; context = order record, ...
    expect(labels(legacy)).toContain("Order record");
    expect(labels(legacy)).not.toContain("Delivery confirmation");
    expect(labels(cited).sort()).toEqual(
      ["Delivery confirmation", "IP & location consistency", "No return recorded in Shopify", "Pre-authorization fraud screening"].sort(),
    );
    expect(cited.find((r) => r.label === "Delivery confirmation")?.value).toMatch(/^Delivered /);
  });

  for (const s of SHAPES) {
    it(`${s.name}: every row is a cited fact, no context row, nothing the legacy rule hid`, () => {
      const rows = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED).rows;
      const byId = new Map(s.facts.map((f) => [f.id, f]));
      for (const r of rows) {
        const f = byId.get(r.factId) as never as (typeof s.facts)[number];
        expect(isBankIncludedFact(f), `${r.label} must be bank-included`).toBe(true);
        expect(isCitedFact(f), `${r.label} must be cited`).toBe(true);
        expect(f.submissionRisk).toBe(false);
        expect(f.bankEligible).toBe(true);
      }
      // Never a superset of the legacy table's FACTS (delivery rows excepted: the
      // legacy letter showed them on a carrier card).
      const legacyIds = new Set(buildEvidenceBasisRows(facts(s)).map((r) => r.factId));
      for (const r of rows) {
        expect(legacyIds.has(r.factId) || /delivery|shipping|shipment/i.test(r.category + r.label)).toBe(true);
      }
      // A bank-included delivery fact always has its row (the page lists it as cited).
      const hasDelivery = s.facts.some(
        (f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && isBankIncludedFact(f as never),
      );
      if (hasDelivery) expect(rows.some((r) => /delivery|shipment|shipping/i.test(r.category + r.label))).toBe(true);
    });
  }

  it("what must stay internal never reaches the table", () => {
    const s = shape("never_cited");
    const text = JSON.stringify(evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED).rows);
    expect(labels(evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED).rows)).toEqual(["Delivery confirmation"]);
    expect(text).not.toMatch(/CANCEL|different|AVS|Payment authentication|Pre-authorization|IP &/i);
  });

  it("record context (order record, policies) is not listed as proof; arguments that are never scored still are", () => {
    expect(labels(evidenceBasisFor(facts(shape("not_received_delivered")), 2).rows)).not.toEqual(
      expect.arrayContaining(["Order record"]),
    );
    expect(labels(evidenceBasisFor(facts(shape("not_received_in_transit")), 2).rows)).toEqual(["Delivery confirmation"]);
    expect(labels(evidenceBasisFor(facts(shape("not_as_described")), 2).rows)).toEqual(
      expect.arrayContaining(["Product listing", "Delivery confirmation"]),
    );
    expect(labels(evidenceBasisFor(facts(shape("not_as_described")), 2).rows)).not.toContain("Refund policy");
  });

  it("a multi-parcel letter now prints the table too, so the page's claim holds for it", () => {
    const s = shape("not_received_multi_parcel");
    expect(evidenceBasisFor(facts(s), 1).tableAllowed).toBe(false);
    const n = evidenceBasisFor(facts(s), 2);
    expect(n.tableAllowed).toBe(true);
    expect(n.rows.length).toBe(2);
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
const ALL_LINE_FIELDS = [
  "avs_cvv_match", "tds_authentication", "fraud_risk_screening", "order_confirmation", "ip_location_check",
  "customer_communication", "shipping_tracking", "no_return_initiated", "activity_log", "shipping_policy",
  "refund_policy", "cancellation_policy",
];

function recordFor(s: Shape, stamp: { evidenceBasisRule: number } | null) {
  const w = JSON.parse(JSON.stringify(openWorkspace())) as Record<string, any>;
  const have = new Set(s.lines.map((l) => l.field));
  const lines = [...s.lines];
  for (const field of ALL_LINE_FIELDS) {
    if (!have.has(field)) lines.push({ field, hasEvidence: false, submissionMethod: "not_included", strengthContribution: "none" });
  }
  w.evidenceLineItems = lines.map((l) => ({ id: `line:${l.field}`, label: l.field, ...l }));
  w.defencePackage.latest = { ...w.defencePackage.latest, facts_json: s.facts, narrative_json: null, document_provenance_json: stamp };
  return buildDisputeRecord(recordInputsFromWorkspace(w, "2026-11-06T12:00:00Z"), createRecordFormat("en"));
}

function citedItemFields(rec: ReturnType<typeof recordFor>): string[] {
  return rec.items
    .filter((i) => i.role === "cited")
    .map((i) => FIELD_FOR_ITEM[i.key])
    .filter((f): f is string => Boolean(f))
    .sort();
}

describe("the dispute page and the letter's Evidence Basis cite the same items", () => {
  for (const s of SHAPES) {
    it(`${s.name} (new package): the page's cited set equals the table's items`, () => {
      const stamp = { evidenceBasisRule: 2 };
      const rec = recordFor(s, stamp);
      const basis = evidenceBasisFor(facts(s), EVIDENCE_BASIS_RULE_CITED);
      const byId = new Map(s.facts.map((f) => [f.id, f]));
      const tableFields = new Set<string>();
      for (const r of basis.rows) {
        const f = byId.get(r.factId);
        const field = f ? evidenceFieldOfFact(f as never) : null;
        if (field && Object.values(FIELD_FOR_ITEM).includes(field)) tableFields.add(field);
      }
      expect(citedItemFields(rec)).toEqual([...tableFields].sort());
      // and the page says so about the stored letter itself
      expect(letterCitations(s.facts, stamp)?.citedFields.filter((f) => Object.values(FIELD_FOR_ITEM).includes(f))).toEqual(
        [...tableFields].sort(),
      );
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
      // the legacy letter argues the delivery in its own section
      if (s.facts.some((f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && isBankIncludedFact(f as never))) {
        listed.add("shipping_tracking");
      }
      for (const field of citedItemFields(rec)) expect(listed.has(field), `${field} is not in the legacy letter`).toBe(true);
    });
  }

  it("the open case: Order record is context on the new page, cited on a legacy one (that is what its letter lists)", () => {
    const s = shape("captured:open_368528_v1");
    const fresh = recordFor(s, { evidenceBasisRule: 2 });
    const legacy = recordFor(s, null);
    expect(fresh.items.find((i) => i.key === "order")?.role).toBe("context");
    expect(fresh.items.filter((i) => i.role === "cited").map((i) => i.key).sort()).toEqual(["delivery", "ip", "return", "screen"]);
    expect(legacy.items.find((i) => i.key === "order")?.role).toBe("cited");
    expect(legacy.items.find((i) => i.key === "delivery")?.role).toBe("cited");
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
