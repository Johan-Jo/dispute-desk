/**
 * F-1b, READ TIME ONLY (docs/plans/single-source-architecture-audit.plan.md §3.1).
 * `refund_record` is inapplicable on CNP / FRAUDULENT when the record shows no
 * refund. Nothing stored changes: the inputs are frozen and the stored score is a column.
 */
import { describe, expect, it } from "vitest";
import {
  deriveCompletenessMetrics,
  evaluateCompletenessV2,
  fieldApplicability,
  inapplicableFields,
} from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { assembleEffectiveChecklist, merchantCompleteness, recordOrderContext } from "../effectiveChecklist";
import { refundRecordApplicability } from "../refundRecordApplicability";

const row = (
  field: string,
  status: ChecklistItemV2["status"],
  priority: ChecklistItemV2["priority"] = "critical",
): ChecklistItemV2 =>
  ({ field, label: field, status, priority, blocking: false, source: "auto_shopify" }) as ChecklistItemV2;

const orderSection = (refunded: unknown, returnStatus: string | null = "NO_RETURN") => ({
  type: "order",
  labelToken: { key: "packs.section.order" },
  source: "shopify_order",
  fieldsProvided: ["order_confirmation"],
  data: { returnStatus, totals: refunded === undefined ? {} : { refunded } },
});

const stored = [
  row("order_confirmation", "available"),
  row("refund_policy", "available"),
  row("refund_record", "missing"),
  row("customer_communication", "missing", "recommended"),
];

function run(reason: string | null, refunded: unknown, checklist = stored) {
  const frozen = structuredClone(checklist);
  Object.freeze(frozen);
  return assembleEffectiveChecklist({
    storedChecklist: frozen,
    packSections: [orderSection(refunded)],
    evidenceItems: [],
    disputeReason: reason,
  });
}

describe("refundRecordApplicability", () => {
  it.each([
    ["CREDIT_NOT_PROCESSED", "0.0", false],
    ["CREDIT_NOT_PROCESSED", 0, false],
    ["FRAUDULENT", "0.0", false],
    ["CREDIT_NOT_PROCESSED", "12.50", true],
    ["FRAUDULENT", 5, true],
    ["CREDIT_NOT_PROCESSED", null, true], // never recorded: fail open
    ["CREDIT_NOT_PROCESSED", undefined, true],
    ["CREDIT_NOT_PROCESSED", "n/a", true], // unparseable: fail open
    ["CREDIT_NOT_PROCESSED", "", true],
    ["PRODUCT_UNACCEPTABLE", "0.0", true], // not in scope: unchanged
    ["PRODUCT_NOT_RECEIVED", "0.0", true],
    [null, "0.0", true],
    [undefined, "0.0", true],
    ["CREDIT_NOT_PROCESSED", "-0.00", false], // a non-positive total is no refund
  ])("%s with refunded %s -> applicable=%s", (reason, refunded, applicable) => {
    const v = refundRecordApplicability({ disputeReason: reason as string, totalRefunded: refunded as string });
    expect(v.applicable).toBe(applicable);
    if (!v.applicable) expect(v.reason).toBe("no_refund_on_record"); // a CODE, never English
  });
});

describe("authority and context", () => {
  it("unset context = applicable (build time is unchanged)", () => {
    expect(fieldApplicability("refund_record", {} as never)).toEqual({ applicable: true });
    expect(inapplicableFields({} as never).size).toBe(0);
  });

  it("the shared context builder feeds both the assembler and the decided loader", () => {
    const ctx = recordOrderContext({ sections: [orderSection("0.0") as never], disputeReason: "CREDIT_NOT_PROCESSED" });
    expect([...inapplicableFields(ctx)]).toEqual(["refund_record"]);
  });

  it("build-time evaluation never consults it: the CNP template still yields the stored `missing` row", () => {
    const out = evaluateCompletenessV2("CREDIT_NOT_PROCESSED", new Set(["order_confirmation"]), [], null, {
      isFulfilled: true,
      hasCardPayment: true,
      avsCvvAvailable: true,
      hasShippingEvidence: true,
    });
    const r = out.checklist.find((c) => c.field === "refund_record");
    expect(r?.status).toBe("missing");
    expect(r?.priority).toBe("critical");
  });
});

describe("assembled checklist", () => {
  it("CNP, zero refund total: the unsatisfiable critical row is dropped and the percentage rises", () => {
    const out = run("CREDIT_NOT_PROCESSED", "0.0");
    expect(out.checklist.map((c) => c.field)).not.toContain("refund_record");
    expect(out.droppedForRecord).toEqual(["refund_record"]);
    expect(merchantCompleteness(out.checklist)).toBeGreaterThan(deriveCompletenessMetrics([...stored]).completenessScore);
  });

  it("FRAUDULENT with a zero-amount entry: dropped too", () => {
    expect(run("FRAUDULENT", "0.0").droppedForRecord).toEqual(["refund_record"]);
  });

  it("CNP with a refund on record: the row stays", () => {
    const out = run("CREDIT_NOT_PROCESSED", "25.00");
    expect(out.checklist.map((c) => c.field)).toContain("refund_record");
    expect(out.droppedForRecord).toEqual([]);
  });

  it("no order section at all (total unknown): fail open, the row stays", () => {
    const out = assembleEffectiveChecklist({
      storedChecklist: stored,
      packSections: [],
      evidenceItems: [],
      disputeReason: "CREDIT_NOT_PROCESSED",
    });
    expect(out.droppedForRecord).toEqual([]);
  });

  it("no reason supplied by the caller: fail open", () => {
    expect(run(null, "0.0").droppedForRecord).toEqual([]);
  });

  it("other reasons are unchanged (PRODUCT_UNACCEPTABLE keeps its recommended row)", () => {
    const rows = [row("refund_record", "missing", "recommended")];
    expect(run("PRODUCT_UNACCEPTABLE", "0.0", rows).droppedForRecord).toEqual([]);
  });

  it("an `available` refund_record is never hidden, even if the total reads zero", () => {
    const rows = [row("refund_record", "available")];
    const out = run("CREDIT_NOT_PROCESSED", "0.0", rows);
    expect(out.checklist.map((c) => c.field)).toContain("refund_record");
    expect(out.contradictedAvailable).toEqual(["refund_record"]);
  });

  it("a row that is already `unavailable` (FRAUDULENT required_if_refunded) vanishes without moving the percentage", () => {
    const rows = [row("order_confirmation", "available"), row("refund_record", "unavailable"), row("refund_policy", "missing")];
    const out = run("FRAUDULENT", "0.0", rows);
    expect(out.checklist.map((c) => c.field)).not.toContain("refund_record");
    expect(merchantCompleteness(out.checklist)).toBe(deriveCompletenessMetrics([...rows]).completenessScore);
  });

  it("every caller of the assembler/pack view passes the dispute reason explicitly (a forgotten caller would fail open silently)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const callers = [
      "app/api/disputes/[id]/workspace/route.ts",
      "app/api/disputes/[id]/route.ts",
      "app/api/packs/[packId]/route.ts",
      "app/api/packs/[packId]/inclusion-override/route.ts",
      "lib/jobs/handlers/renderPdfJob.ts",
      "lib/disputes/loadDecidedResponse.ts",
    ];
    for (const f of callers) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toMatch(/disputeReason:/);
    }
  });

  it("is idempotent and leaves the stored rows untouched", () => {
    const a = run("CREDIT_NOT_PROCESSED", "0.0");
    const b = assembleEffectiveChecklist({
      storedChecklist: a.checklist,
      packSections: [orderSection("0.0")],
      evidenceItems: [],
      disputeReason: "CREDIT_NOT_PROCESSED",
    });
    expect(b.checklist).toEqual(a.checklist);
    expect(stored.find((c) => c.field === "refund_record")?.status).toBe("missing");
  });
});
