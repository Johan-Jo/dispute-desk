/**
 * Canonical evidence registry + categorizer tests.
 * Plan v3 §P2.9 — covers #14 (delivery proofType strict mapping)
 * and the per-field conditional logic for AVS/CVV, IP/location,
 * and supporting-field invariants.
 */

import { describe, expect, it } from "vitest";
import {
  CANONICAL_EVIDENCE,
  CANONICAL_EVIDENCE_VERSION,
  CATEGORY_WEIGHT,
  affectsStrength,
  categorizeEvidenceField,
  categoryFor,
} from "../canonicalEvidence";

describe("canonical evidence registry — invariants", () => {
  it("every entry has a signalId, label, category, and explicit excludedFromStrength flag", () => {
    for (const [field, spec] of Object.entries(CANONICAL_EVIDENCE)) {
      expect(spec.signalId, field).toBeTruthy();
      expect(spec.label, field).toBeTruthy();
      expect(["strong", "moderate", "supporting"], field).toContain(spec.category);
      expect(typeof spec.excludedFromStrength, field).toBe("boolean");
    }
  });

  it("supporting fields ALWAYS have weight 0 + excludedFromStrength true (P2.1.1)", () => {
    for (const [field, spec] of Object.entries(CANONICAL_EVIDENCE)) {
      if (spec.category === "supporting") {
        expect(spec.supportingOnly, field).toBe(true);
        expect(spec.excludedFromStrength, field).toBe(true);
        expect(CATEGORY_WEIGHT.supporting, field).toBe(0);
      }
    }
  });

  it("category weights are 3 / 2 / 0 / 0 (strong / moderate / supporting / invalid)", () => {
    expect(CATEGORY_WEIGHT.strong).toBe(3);
    expect(CATEGORY_WEIGHT.moderate).toBe(2);
    expect(CATEGORY_WEIGHT.supporting).toBe(0);
    expect(CATEGORY_WEIGHT.invalid).toBe(0);
  });

  it("affectsStrength gates correctly", () => {
    expect(affectsStrength("strong")).toBe(true);
    expect(affectsStrength("moderate")).toBe(true);
    expect(affectsStrength("supporting")).toBe(false);
    expect(affectsStrength("invalid")).toBe(false);
  });
});

describe("delivery proofType — strict 4-state mapping (#14)", () => {
  it("signature_confirmed → strong", () => {
    expect(categorizeEvidenceField("delivery_proof", { proofType: "signature_confirmed" })).toBe("strong");
    expect(categorizeEvidenceField("shipping_tracking", { proofType: "signature_confirmed" })).toBe("strong");
  });

  it("delivered_confirmed → moderate", () => {
    expect(categorizeEvidenceField("delivery_proof", { proofType: "delivered_confirmed" })).toBe("moderate");
    expect(categorizeEvidenceField("shipping_tracking", { proofType: "delivered_confirmed" })).toBe("moderate");
  });

  it("delivered_unverified → supporting", () => {
    expect(categorizeEvidenceField("delivery_proof", { proofType: "delivered_unverified" })).toBe("supporting");
    expect(categorizeEvidenceField("shipping_tracking", { proofType: "delivered_unverified" })).toBe("supporting");
  });

  it("label_created → invalid", () => {
    expect(categorizeEvidenceField("delivery_proof", { proofType: "label_created" })).toBe("invalid");
    expect(categorizeEvidenceField("shipping_tracking", { proofType: "label_created" })).toBe("invalid");
  });

  it("absent proofType → invalid (defaults to label_created)", () => {
    expect(categorizeEvidenceField("delivery_proof", {})).toBe("invalid");
    expect(categorizeEvidenceField("delivery_proof", null)).toBe("invalid");
  });
});

describe("avs_cvv_match", () => {
  it("both AVS and CVV match → strong", () => {
    expect(categorizeEvidenceField("avs_cvv_match", { avsResultCode: "Y", cvvResultCode: "M" })).toBe("strong");
    expect(categorizeEvidenceField("avs_cvv_match", { avsResultCode: "A", cvvResultCode: "M" })).toBe("strong");
  });

  it("only one matches → moderate", () => {
    expect(categorizeEvidenceField("avs_cvv_match", { avsResultCode: "Y", cvvResultCode: "N" })).toBe("moderate");
    expect(categorizeEvidenceField("avs_cvv_match", { avsResultCode: "N", cvvResultCode: "M" })).toBe("moderate");
  });

  it("neither matches → invalid", () => {
    expect(categorizeEvidenceField("avs_cvv_match", { avsResultCode: "N", cvvResultCode: "N" })).toBe("invalid");
    expect(categorizeEvidenceField("avs_cvv_match", {})).toBe("invalid");
  });
});

describe("ip_location_check", () => {
  it("location match + no privacy flags → moderate", () => {
    expect(categorizeEvidenceField("ip_location_check", {
      bankEligible: true,
      locationMatch: "match",
      ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
    })).toBe("moderate");
  });

  it("VPN flag → supporting (downgraded)", () => {
    expect(categorizeEvidenceField("ip_location_check", {
      bankEligible: true,
      locationMatch: "match",
      ipinfo: { privacy: { vpn: true } },
    })).toBe("supporting");
  });

  it("bankEligible false → supporting", () => {
    expect(categorizeEvidenceField("ip_location_check", { bankEligible: false })).toBe("supporting");
  });

  it("no location data → supporting", () => {
    expect(categorizeEvidenceField("ip_location_check", { locationMatch: "no_match" })).toBe("supporting");
  });
});

describe("supporting-only fields (#13 invariant — never elevates)", () => {
  it("customer_communication is always supporting regardless of payload", () => {
    expect(categorizeEvidenceField("customer_communication", { messages: 100 })).toBe("supporting");
    expect(categorizeEvidenceField("customer_communication", {})).toBe("supporting");
  });

  it("customer_account_info is always supporting", () => {
    expect(categorizeEvidenceField("customer_account_info", { totalOrders: 50 })).toBe("supporting");
  });

  it("activity_log is always supporting", () => {
    expect(categorizeEvidenceField("activity_log", { events: 100 })).toBe("supporting");
  });

  it("order_confirmation is always supporting (P2.6 — no vague summaries elevate)", () => {
    expect(categorizeEvidenceField("order_confirmation", { orderName: "#1234" })).toBe("supporting");
  });

  it("policies are always supporting", () => {
    expect(categorizeEvidenceField("refund_policy", { url: "..." })).toBe("supporting");
    expect(categorizeEvidenceField("shipping_policy", { url: "..." })).toBe("supporting");
    expect(categorizeEvidenceField("cancellation_policy", { url: "..." })).toBe("supporting");
  });

  it("null payload on supporting field → invalid (item omitted entirely)", () => {
    expect(categorizeEvidenceField("customer_communication", null)).toBe("invalid");
  });
});

describe("unknown fields", () => {
  it("unregistered evidenceFieldKey → invalid", () => {
    expect(categorizeEvidenceField("not_a_field", { foo: "bar" })).toBe("invalid");
    expect(categorizeEvidenceField("", null)).toBe("invalid");
  });
});

describe("categoryFor — version-gated cache resolution (#12)", () => {
  it("returns the cached value when versions match", () => {
    const result = categoryFor({
      fieldKey: "delivery_proof",
      payload: { proofType: "label_created" }, // would be invalid if recomputed
      cached: {
        category: "strong",
        signalId: "delivery",
        categoryVersion: CANONICAL_EVIDENCE_VERSION,
      },
    });
    // Cache is honoured at the matching version.
    expect(result).toBe("strong");
  });

  it("ignores the cached value when categoryVersion is stale", () => {
    const result = categoryFor({
      fieldKey: "delivery_proof",
      payload: { proofType: "label_created" },
      cached: {
        category: "strong",
        signalId: "delivery",
        categoryVersion: CANONICAL_EVIDENCE_VERSION - 1,
      },
    });
    expect(result).toBe("invalid");
  });

  it("re-derives when no cache provided", () => {
    expect(categoryFor({
      fieldKey: "delivery_proof",
      payload: { proofType: "delivered_confirmed" },
    })).toBe("moderate");
  });
});

describe("signal-level deduplication (#11)", () => {
  it("delivery_proof and shipping_tracking share signalId 'delivery'", () => {
    expect(CANONICAL_EVIDENCE.delivery_proof.signalId).toBe("delivery");
    expect(CANONICAL_EVIDENCE.shipping_tracking.signalId).toBe("delivery");
  });

  it("avs_cvv_match and tds_authentication share signalId 'payment_auth'", () => {
    expect(CANONICAL_EVIDENCE.avs_cvv_match.signalId).toBe("payment_auth");
    expect(CANONICAL_EVIDENCE.tds_authentication.signalId).toBe("payment_auth");
  });

  it("activity_log and customer_account_info share signalId 'account_history'", () => {
    expect(CANONICAL_EVIDENCE.activity_log.signalId).toBe("account_history");
    expect(CANONICAL_EVIDENCE.customer_account_info.signalId).toBe("account_history");
  });
});
