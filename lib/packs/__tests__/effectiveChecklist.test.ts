/**
 * PR 1 (docs/plans/single-source-architecture-audit.plan.md §2.6, §2.7).
 *
 * The assembled (effective) checklist, over REAL stored packs (prod, 2026-11-06,
 * sanitised to checklist + the few section fields the verdict reads) and the
 * synthetic shapes the plan lists. Stored rows, stored score and readiness are
 * never touched: the function is pure and the inputs are frozen.
 */
import { describe, expect, it } from "vitest";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { assembleEffectiveChecklist, merchantCompleteness } from "../effectiveChecklist";
import cases from "./__fixtures__/returnCoherenceCases.json";

type Case = (typeof cases)[keyof typeof cases];
const fx = (k: keyof typeof cases): Case => cases[k];

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

function run(c: Case, returnScope?: Parameters<typeof assembleEffectiveChecklist>[0]["returnScope"]) {
  const frozen = deepFreeze(structuredClone(c));
  return assembleEffectiveChecklist({
    storedChecklist: frozen.checklist_v2,
    packSections: frozen.sections,
    evidenceItems: [],
    returnScope,
  });
}

const fields = (rows: ChecklistItemV2[]) => rows.map((r) => r.field);

describe("real cases: the return banner and the checklist agree", () => {
  it.each(["24612", "24510"] as const)("#%s (RETURNED, zero refund entry): the no-return row is gone", (k) => {
    const c = fx(k);
    expect(c.checklist_v2.find((r) => r.field === "no_return_initiated")?.status).toBe("missing"); // the defect, stored
    const out = run(c);
    expect(fields(out.checklist)).not.toContain("no_return_initiated");
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
    expect(out.contradictedAvailable).toEqual([]);
  });

  it("#24599 (IN_PROGRESS, no refund section): dropped as a return on record, not as a refund", () => {
    const out = run(fx("24599"));
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
  });

  it("the percentage moves only by the dropped row, and equals an independent restatement", () => {
    const c = fx("24612");
    const out = run(c);
    // Independent: the same stored rows (after the same reconcile) with that one row excluded.
    // Hand-computed from the documented weights, not via the production function.
    const W: Record<string, number> = { critical: 1, recommended: 0.5, optional: 0.1 };
    const live = out.checklist.filter((r) => r.status !== "unavailable");
    const num = live.filter((r) => r.status === "available" || r.status === "waived").reduce((s, r) => s + (W[r.priority] ?? 0), 0);
    const den = live.reduce((s, r) => s + (W[r.priority] ?? 0), 0);
    expect(merchantCompleteness(out.checklist)).toBe(Math.round((num / den) * 100));
    const withRow = deriveCompletenessMetrics([
      ...out.checklist,
      c.checklist_v2.find((r) => r.field === "no_return_initiated") as ChecklistItemV2,
    ]).completenessScore;
    expect(merchantCompleteness(out.checklist)).toBeGreaterThan(withRow);
    expect(c.storedScore).toBe(68); // stored score is a column, never recomputed here
  });

  it("#24215 (NO_RETURN, nothing refunded): the available row stays", () => {
    const out = run(fx("24215"));
    expect(fields(out.checklist)).toContain("no_return_initiated");
    expect(out.droppedForRecord).toEqual([]);
  });

  it("#99445 (pre-stamp: return status never recorded): UNKNOWN is not a return, the row stays", () => {
    const c = fx("99445");
    expect(c.sections.find((s) => s.labelToken.key === "packs.section.order")?.data).not.toHaveProperty("returnStatus");
    const out = run(c);
    expect(fields(out.checklist)).toContain("no_return_initiated");
    expect(out.droppedForRecord).toEqual([]);
  });
});

describe("synthetic shapes from the plan (§2.7)", () => {
  const row = (field: string, status: ChecklistItemV2["status"], priority = "recommended"): ChecklistItemV2 =>
    ({ field, label: "", status, priority, blocking: false, source: "auto_shopify" }) as ChecklistItemV2;
  const order = (returnStatus: string | null, refunded: string | null) => ({
    labelToken: { key: "packs.section.order" },
    fieldsProvided: ["order_confirmation"],
    data: { ...(returnStatus ? { returnStatus } : {}), totals: refunded == null ? undefined : { refunded } },
  });
  const assemble = (rows: unknown, sections: unknown, scope?: Parameters<typeof assembleEffectiveChecklist>[0]["returnScope"]) =>
    assembleEffectiveChecklist({ storedChecklist: rows, packSections: sections, returnScope: scope });

  it("a processed refund with no recorded status is a refund on record (3 prod packs)", () => {
    const out = assemble([row("no_return_initiated", "missing")], [order(null, "25.00")]);
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
  });

  it("an unrecognised status is UNKNOWN at read time: it never hides the row (the collector stays silent, as before)", () => {
    const out = assemble([row("no_return_initiated", "missing")], [order("SOMETHING_NEW", "0.0")]);
    expect(out.droppedForRecord).toEqual([]);
  });

  it("an unrecognised status WITH a refund on record is still a refund on record", () => {
    const out = assemble([row("no_return_initiated", "missing")], [order("SOMETHING_NEW", "10.0")]);
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
  });

  it("an available row the record contradicts is KEPT and flagged, never hidden", () => {
    const out = assemble(
      [row("no_return_initiated", "available")],
      [{ ...order("RETURNED", "0.0"), fieldsProvided: ["no_return_initiated"] }],
    );
    expect(fields(out.checklist)).toContain("no_return_initiated");
    expect(out.contradictedAvailable).toEqual(["no_return_initiated"]);
    expect(out.droppedForRecord).toEqual([]);
  });

  it("a waived row is dropped when inapplicable (the stored waive record is untouched)", () => {
    const out = assemble([row("no_return_initiated", "waived")], [order("RETURNED", "0.0")]);
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
  });

  it("returned-to-sender composes after the verdict (NO_RETURN + a returned parcel)", () => {
    const shipping = {
      labelToken: { key: "packs.section.shipping" },
      fieldsProvided: ["shipping_tracking"],
      data: { proofType: "returned_to_sender" },
    };
    const out = assemble([row("no_return_initiated", "missing")], [order("NO_RETURN", "0.0"), shipping]);
    expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
  });

  describe("unknown Shopify status and carrier evidence", () => {
    const returnedShipping = {
      labelToken: { key: "packs.section.shipping" },
      fieldsProvided: ["shipping_tracking"],
      data: { proofType: "returned_to_sender" },
    };
    const carrierReturned = {
      labelToken: { key: "packs.section.shipping" },
      fieldsProvided: ["delivery_proof"],
      data: { fulfillments: [{ carrierTracking: { deliveryStatus: "Returned" }, carrierTerminalEvent: { happenedAt: "2026-07-06T00:00:00Z" } }] },
    };

    it.each([["proofType", returnedShipping], ["per-fulfilment Returned", carrierReturned]])(
      "status never recorded + carrier %s: the missing row is dropped (returned_to_sender)",
      (_n, shipping) => {
        const out = assemble([row("no_return_initiated", "missing")], [order(null, "0.0"), shipping]);
        expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
      },
    );

    describe.each([
      ["status never recorded", null],
      ["unrecognised non-null status", "SOMETHING_NEW"],
    ])("%s", (_label, status) => {
      it.each([["proofType", returnedShipping], ["per-fulfilment Returned", carrierReturned]])(
        "+ confirmed carrier return (%s): the missing row is dropped as returned_to_sender",
        (_n, shipping) => {
          const out = assemble([row("no_return_initiated", "missing")], [order(status, "0.0"), shipping]);
          expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
        },
      );

      it("without carrier evidence: never inferred to be a return, the row stays", () => {
        const out = assemble([row("no_return_initiated", "missing")], [order(status, "0.0")]);
        expect(out.droppedForRecord).toEqual([]);
        expect(out.checklist.find((r) => r.field === "no_return_initiated")?.status).toBe("missing");
      });

      it("an available row is kept and flagged even with carrier evidence", () => {
        const out = assemble([row("no_return_initiated", "available")], [order(status, "0.0"), returnedShipping]);
        expect(fields(out.checklist)).toContain("no_return_initiated");
        expect(out.contradictedAvailable).toEqual(["no_return_initiated"]);
        expect(out.droppedForRecord).toEqual([]);
      });
    });

    it("status never recorded and NO carrier evidence: unknown stays applicable, the row stays", () => {
      const out = assemble([row("no_return_initiated", "missing")], [order(null, "0.0")]);
      expect(out.droppedForRecord).toEqual([]);
    });

    it("an available row is still kept, never hidden, even with carrier evidence", () => {
      const out = assemble([row("no_return_initiated", "available")], [order(null, "0.0"), returnedShipping]);
      expect(fields(out.checklist)).toContain("no_return_initiated");
      expect(out.contradictedAvailable).toEqual(["no_return_initiated"]);
    });
  });

  it("NO_RETURN with an unparseable refund total still shows the row (fails open, as the collector emits)", () => {
    const out = assemble([row("no_return_initiated", "missing")], [order("NO_RETURN", "n/a")]);
    expect(out.droppedForRecord).toEqual([]);
  });

  describe("the merchant's answer (setting on) and response cycles", () => {
    const rows = [row("no_return_initiated", "missing")];
    const sections = [order("NO_RETURN", "0.0")];

    it("'request received' drops the row", () => {
      const out = assemble(rows, sections, { returnsOutsideShopify: true, answer: "request_received" });
      expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
    });

    it("'no request received' and 'not sure' keep it", () => {
      for (const answer of ["no_request_received", "not_sure"] as const) {
        expect(assemble(rows, sections, { returnsOutsideShopify: true, answer }).droppedForRecord).toEqual([]);
      }
    });

    it("the setting OFF ignores a stale answer (returnScopeFor returns undefined)", () => {
      expect(assemble(rows, sections, undefined).droppedForRecord).toEqual([]);
    });
  });

  describe("stored shapes", () => {
    const sections = [order("RETURNED", "0.0")];
    it("accepts the historical { items } shape", () => {
      const out = assemble({ items: [row("no_return_initiated", "missing")] }, sections);
      expect(out.droppedForRecord).toEqual(["no_return_initiated"]);
    });
    it("null checklist and malformed sections never throw", () => {
      expect(() => assemble(null, sections)).not.toThrow();
      for (const bad of [null, undefined, "x", { a: 1 }, [null, 1, { fieldsProvided: "x" }]]) {
        expect(() => assemble([row("no_return_initiated", "missing")], bad)).not.toThrow();
        expect(assemble([row("no_return_initiated", "missing")], bad).droppedForRecord).toEqual([]);
      }
    });
  });

  it("reconcile's own behaviour (flip, append, retired) is unchanged when nothing is inapplicable", () => {
    const sections = [{ ...order("NO_RETURN", "0.0"), fieldsProvided: ["order_confirmation", "ip_location_check"] }];
    const out = assemble([row("order_confirmation", "missing")], sections);
    expect(out.checklist.find((r) => r.field === "order_confirmation")?.status).toBe("available");
    expect(fields(out.checklist)).toContain("ip_location_check"); // appended
  });
});
