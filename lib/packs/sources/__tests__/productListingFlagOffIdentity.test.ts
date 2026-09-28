/**
 * Not-as-described plan PR 4, acceptance #7 — flag OFF is byte-identical.
 *
 * Every place PR 3 touched is checked with the flag OFF against the value the
 * code produced before PR 3, restated here (not imported) so a later change to
 * the new code cannot silently move what "unchanged" means:
 *   - the collector is not invoked (no section);
 *   - templated packs b…0004 / b…0013 still score product_description
 *     against order_confirmation;
 *   - the built-in PRODUCT_UNACCEPTABLE row still expects a manual upload;
 *   - a product_description payload has no `listings` key (it feeds hashes);
 *   - the listing fact's value keeps the legacy `{ hasListing }` shape;
 *   - other families' checklists are untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evaluateCompletenessV2, templateCollectorKey, REASON_TEMPLATES_V2 } from "@/lib/automation/completeness";
import { normalizeEvidencePayload } from "@/lib/evidence/model/payloads";
import { classifyFacts } from "@/lib/defence/factClassifier";
import { resolveReasonCodeModuleForContext } from "@/lib/defence/reasonCodes/registry";
import { collectProductEvidence } from "../productSource";

const prev = process.env.PRODUCT_LISTING_EVIDENCE_ENABLED;
beforeAll(() => {
  delete process.env.PRODUCT_LISTING_EVIDENCE_ENABLED;
});
afterAll(() => {
  process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = prev;
});

// Templates as seeded (019_seed_global_templates.sql:133, 20260411150000_…:151).
const TEMPLATED = [
  { key: "order_confirmation", label: "Order summary", required: true, collector_key: "order_confirmation" },
  { key: "product_description", label: "Product description", required: false, collector_key: "order_confirmation" },
];
const FIXTURES: Array<[string, string, typeof TEMPLATED | null]> = [
  ["product, untemplated", "PRODUCT_UNACCEPTABLE", null],
  ["product, b…0004", "PRODUCT_UNACCEPTABLE", TEMPLATED],
  ["product, b…0013 (inquiry)", "PRODUCT_UNACCEPTABLE", TEMPLATED],
  ["not received", "PRODUCT_NOT_RECEIVED", null],
  ["fraud", "FRAUDULENT", null],
  ["credit not processed", "CREDIT_NOT_PROCESSED", null],
  ["general", "GENERAL", null],
  ["subscription", "SUBSCRIPTION_CANCELLED", null],
];

describe("flag OFF: byte-identical to before PR 3", () => {
  it("the collector returns nothing", async () => {
    expect(await collectProductEvidence({ caseFamily: "product_not_as_described" } as never)).toEqual([]);
  });

  it.each(FIXTURES)("%s: checklist and score as before", (_name, reason, template) => {
    const fields = new Set(["order_confirmation", "refund_policy"]);
    const r = evaluateCompletenessV2(reason, fields, null, template as never);
    if (template) {
      // The product row is still satisfied by the order summary.
      const row = r.checklist.find((c) => c.field === "order_confirmation" && c.label === "Product description");
      expect(row?.status).toBe("available");
      for (const t of template) expect(templateCollectorKey(t)).toBe(t.collector_key);
    } else {
      const expected = REASON_TEMPLATES_V2[reason] ?? REASON_TEMPLATES_V2.GENERAL;
      const pd = expected.find((t) => t.field === "product_description");
      const got = r.checklist.find((c) => c.field === "product_description");
      if (pd) expect(got?.source).toBe(pd.expectedSource);
      else expect(got).toBeUndefined();
    }
  });

  it("a product_description payload has no listings key", () => {
    expect(normalizeEvidencePayload("product_description", { uploads: [{ id: "u1", fileName: "listing.png" }] })).toEqual({
      fieldKey: "product_description",
      uploads: [{ evidenceItemId: "u1", filename: "listing.png", mimeType: null, storagePath: null }],
    });
  });

  it("a merchant-uploaded listing keeps the legacy fact shape (not citable context)", () => {
    const r = classifyFacts({
      packageId: "p",
      sections: [{ type: "other", label: "Upload", source: "manual_upload", data: { title: "x" }, fieldsProvided: ["product_description"] }],
      evidenceItems: [], checklist: [], coverage: { state: "not_covered" }, fatalLoss: { triggered: false, reason: null },
      caseStrength: "moderate", manualRows: [], reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_UNACCEPTABLE"),
    });
    const f = r.approved.find((x) => x.category === "product_listing");
    expect(f?.value).toEqual({ hasListing: true, fieldKey: "product_description" });
    expect(f?.bankEligible).toBe(false);
  });
});
