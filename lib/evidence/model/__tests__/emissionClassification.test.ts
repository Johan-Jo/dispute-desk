import { describe, expect, it } from "vitest";
import { FIELD_PRECONDITIONS, REASON_TEMPLATES_V2 } from "@/lib/automation/completeness";
import { canMerchantUpload } from "@/lib/disputes/presentation/concreteContribution";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { EMISSION_CLASSIFICATION } from "../emissionClassification";

/** DB templates add two auto fields the code templates do not carry
 *  (supabase/migrations/20260517120000 and later); reconcile can also append them. */
const DB_ONLY_AUTO = ["tds_authentication", "device_session_consistency"];

function autoFieldsInCodeTemplates(): Set<string> {
  const out = new Set<string>();
  for (const rows of Object.values(REASON_TEMPLATES_V2)) {
    for (const r of rows) {
      if (r.collectionType === "auto" || r.collectionType === "conditional_auto") out.add(r.field);
    }
  }
  return out;
}

describe("emission classification (reviewed, completeness-enforced; not a proof)", () => {
  it("covers every auto/conditional_auto field of the code templates plus the DB-only ones", () => {
    const required = new Set([...autoFieldsInCodeTemplates(), ...DB_ONLY_AUTO]);
    const missing = [...required].filter((f) => !EMISSION_CLASSIFICATION[f]);
    expect(missing, "classify these in emissionClassification.ts").toEqual([]);
  });

  it("classifies only registered evidence fields, each with a written reason", () => {
    for (const [field, c] of Object.entries(EMISSION_CLASSIFICATION)) {
      expect(CANONICAL_EVIDENCE[field], `${field} is not a registered field`).toBeTruthy();
      expect(c.why.length, `${field} needs a reason`).toBeGreaterThan(20);
    }
  });

  it("world_precondition <=> a FIELD_PRECONDITIONS entry, in both directions", () => {
    const declared = Object.entries(EMISSION_CLASSIFICATION)
      .filter(([, c]) => c.class === "world_precondition")
      .map(([f]) => f)
      .sort();
    expect(declared).toEqual(Object.keys(FIELD_PRECONDITIONS).sort());
  });

  it("needs_decision is shrink-only, owned, and limited to the checked-in baseline", () => {
    const open = Object.entries(EMISSION_CLASSIFICATION).filter(([, c]) => c.class === "needs_decision");
    expect(open.map(([f]) => f)).toEqual([]); // BASELINE: may only shrink (refund_record closed at READ time by F-1b)
    for (const [f, c] of open) expect(c.owner, `${f} needs an owner`).toBeTruthy();
  });

  it("snapshots every class so a reclassification is a reviewed diff", () => {
    const snap = Object.fromEntries(
      Object.entries(EMISSION_CLASSIFICATION)
        .map(([f, c]) => [f, c.class] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(snap).toEqual({
      activity_log: "evidence_absent",
      avs_cvv_match: "evidence_absent",
      cancellation_policy: "evidence_absent",
      customer_account_info: "evidence_absent",
      customer_communication: "evidence_absent",
      delivery_proof: "evidence_absent",
      device_session_consistency: "evidence_absent",
      fraud_risk_screening: "evidence_absent",
      ip_location_check: "evidence_absent",
      no_return_initiated: "world_precondition",
      order_confirmation: "evidence_absent",
      product_description: "evidence_absent",
      refund_policy: "evidence_absent",
      refund_record: "world_precondition",
      shipping_policy: "evidence_absent",
      shipping_tracking: "evidence_absent",
      tds_authentication: "evidence_absent",
    });
  });

  it("cross-validates against canMerchantUpload: a world_precondition field is never merchant-uploadable", () => {
    for (const [field, c] of Object.entries(EMISSION_CLASSIFICATION)) {
      if (c.class === "world_precondition") {
        expect(canMerchantUpload({ field, collectionType: "conditional_auto" }), field).toBe(false);
      }
    }
    // F-1a: the unsatisfiable refund row is closed too.
    expect(canMerchantUpload({ field: "refund_record", collectionType: "conditional_auto" })).toBe(false);
  });

  it("system-derived auto fields are not merchant-uploadable (the written reason for each)", () => {
    for (const f of ["tds_authentication", "device_session_consistency"]) {
      expect(canMerchantUpload({ field: f, collectionType: "auto" }), f).toBe(false);
    }
  });
});
