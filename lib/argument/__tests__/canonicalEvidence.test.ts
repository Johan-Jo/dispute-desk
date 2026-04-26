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

  it("supportingOnly fields are strict — supportingOnly === true ⇒ category 'supporting' AND excludedFromStrength true (P2.1.1)", () => {
    for (const [field, spec] of Object.entries(CANONICAL_EVIDENCE)) {
      if (spec.supportingOnly) {
        expect(spec.category, field).toBe("supporting");
        expect(spec.excludedFromStrength, field).toBe(true);
      }
    }
    expect(CATEGORY_WEIGHT.supporting).toBe(0);
  });

  it("conditional supporting fields (default 'supporting' but supportingOnly: false) can upgrade per the rubric", () => {
    // Rubric: customer_communication, activity_log, customer_account_info,
    // supporting_documents, refund/shipping/cancellation_policy default to
    // supporting but upgrade to strong when payload carries the decisive
    // discriminator. They are NOT supportingOnly.
    const conditionalSupporting = [
      "customer_communication",
      "activity_log",
      "customer_account_info",
      "supporting_documents",
      "refund_policy",
      "shipping_policy",
      "cancellation_policy",
    ];
    for (const field of conditionalSupporting) {
      const spec = CANONICAL_EVIDENCE[field];
      expect(spec.category, field).toBe("supporting");
      expect(spec.supportingOnly, field).toBe(false);
      expect(spec.excludedFromStrength, field).toBe(false);
    }
  });

  it("strict supporting-only fields (rubric: never elevate)", () => {
    // Rubric GRAY: order record, product listing, duplicate explanation
    // never upgrade regardless of payload.
    const strict = ["order_confirmation", "product_description", "duplicate_explanation"];
    for (const field of strict) {
      const spec = CANONICAL_EVIDENCE[field];
      expect(spec.supportingOnly, field).toBe(true);
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

describe("rubric — conditional supporting fields stay supporting without decisive payload", () => {
  it("customer_communication without customerConfirmsOrder → supporting", () => {
    expect(categorizeEvidenceField("customer_communication", { messages: 100 })).toBe("supporting");
    expect(categorizeEvidenceField("customer_communication", {})).toBe("supporting");
    expect(categorizeEvidenceField("customer_communication", null)).toBe("supporting");
  });

  it("customer_account_info with totalOrders=0 (no prior orders) → supporting", () => {
    expect(categorizeEvidenceField("customer_account_info", { totalOrders: 0 })).toBe("supporting");
    expect(categorizeEvidenceField("customer_account_info", {})).toBe("supporting");
  });

  it("activity_log without decisive session/digital-access proof → supporting", () => {
    expect(categorizeEvidenceField("activity_log", { events: 100 })).toBe("supporting");
  });

  it("order_confirmation is always supporting (rubric GRAY — no vague summaries elevate)", () => {
    expect(categorizeEvidenceField("order_confirmation", { orderName: "#1234" })).toBe("supporting");
  });

  it("policies without explicit acceptance are supporting (text only)", () => {
    expect(categorizeEvidenceField("refund_policy", { url: "..." })).toBe("supporting");
    expect(categorizeEvidenceField("shipping_policy", { url: "..." })).toBe("supporting");
    expect(categorizeEvidenceField("cancellation_policy", { url: "..." })).toBe("supporting");
  });

  it("supporting_documents without signedContract → supporting", () => {
    expect(categorizeEvidenceField("supporting_documents", { fileName: "screenshot.png" })).toBe(
      "supporting",
    );
  });
});

describe("rubric — conditional upgrades to strong", () => {
  it("rubric #6 — customer_communication with customerConfirmsOrder=true → strong", () => {
    expect(
      categorizeEvidenceField("customer_communication", { customerConfirmsOrder: true }),
    ).toBe("strong");
  });

  it("rubric #5 — customer_account_info with priorUndisputedOrders >= 1 → strong", () => {
    expect(
      categorizeEvidenceField("customer_account_info", { priorUndisputedOrders: 3 }),
    ).toBe("strong");
    // totalOrders alone (and disputeFreeHistory not falsified) also upgrades
    expect(categorizeEvidenceField("customer_account_info", { totalOrders: 5 })).toBe("strong");
  });

  it("rubric #5 — disputeFreeHistory: false suppresses any upgrade", () => {
    expect(
      categorizeEvidenceField("customer_account_info", {
        totalOrders: 10,
        priorUndisputedOrders: 0,
        disputeFreeHistory: false,
      }),
    ).toBe("supporting");
  });

  it("rubric #4 — activity_log with decisiveSessionProof=true → strong", () => {
    expect(
      categorizeEvidenceField("activity_log", { decisiveSessionProof: true }),
    ).toBe("strong");
  });

  it("rubric #7 — activity_log with digitalAccessUsed=true → strong (digital products)", () => {
    expect(categorizeEvidenceField("activity_log", { digitalAccessUsed: true })).toBe("strong");
  });

  it("rubric #3 — supporting_documents with signedContract=true → strong", () => {
    expect(
      categorizeEvidenceField("supporting_documents", { signedContract: true, fileName: "agreement.pdf" }),
    ).toBe("strong");
  });

  it("rubric #8 — policies with acceptedAtCheckout AND acceptanceTimestamp → strong", () => {
    const accepted = { acceptedAtCheckout: true, acceptanceTimestamp: "2026-04-25T00:00:00Z" };
    expect(categorizeEvidenceField("refund_policy", accepted)).toBe("strong");
    expect(categorizeEvidenceField("shipping_policy", accepted)).toBe("strong");
    expect(categorizeEvidenceField("cancellation_policy", accepted)).toBe("strong");
  });

  it("rubric #8 — accepted without timestamp → supporting (cannot prove acceptance was for this order)", () => {
    expect(
      categorizeEvidenceField("refund_policy", { acceptedAtCheckout: true }),
    ).toBe("supporting");
  });

  it("rubric #4 — device_session_consistency with consistent + login + IP match → strong", () => {
    expect(
      categorizeEvidenceField("device_session_consistency", {
        consistent: true,
        loginPresent: true,
        ipMatch: true,
      }),
    ).toBe("strong");
  });

  it("rubric — device_session_consistency with consistent only → moderate", () => {
    expect(
      categorizeEvidenceField("device_session_consistency", { consistent: true }),
    ).toBe("moderate");
  });

  it("rubric #9 — shipping_tracking delivered_confirmed + deliveredToVerifiedAddress → strong", () => {
    expect(
      categorizeEvidenceField("shipping_tracking", {
        proofType: "delivered_confirmed",
        deliveredToVerifiedAddress: true,
      }),
    ).toBe("strong");
    expect(
      categorizeEvidenceField("delivery_proof", {
        proofType: "delivered_confirmed",
        deliveredToVerifiedAddress: true,
      }),
    ).toBe("strong");
  });

  it("rubric #9 — delivered_confirmed alone (no verified address) → moderate", () => {
    expect(
      categorizeEvidenceField("shipping_tracking", { proofType: "delivered_confirmed" }),
    ).toBe("moderate");
  });

  it("strict supporting-only fields stay supporting even with rich payload", () => {
    expect(categorizeEvidenceField("order_confirmation", { everyKey: "true" })).toBe("supporting");
    expect(categorizeEvidenceField("product_description", { signedContract: true })).toBe(
      "supporting",
    );
    expect(categorizeEvidenceField("duplicate_explanation", { customerConfirmsOrder: true })).toBe(
      "supporting",
    );
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
