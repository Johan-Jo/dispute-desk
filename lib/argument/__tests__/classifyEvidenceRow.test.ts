/**
 * classifyEvidenceRow — UI safety wrapper. Plan v3 §P2.7.
 *
 * The whole reason this exists: missing/incomplete payload must NEVER
 * surface as "Invalid" in the merchant UI. "Invalid" is reserved for
 * explicit negative evidence.
 */

import { describe, expect, it } from "vitest";
import { classifyEvidenceRow } from "../categoryBadge";

describe("classifyEvidenceRow — status overrides", () => {
  it("missing → no category, status missing", () => {
    const r = classifyEvidenceRow({ fieldKey: "avs_cvv_match", status: "missing", payload: null });
    expect(r.category).toBeNull();
    expect(r.status).toBe("missing");
  });

  it("unavailable → no category, status not_applicable", () => {
    const r = classifyEvidenceRow({ fieldKey: "delivery_proof", status: "unavailable", payload: null });
    expect(r.category).toBeNull();
    expect(r.status).toBe("not_applicable");
  });

  it("waived → category resolved, status waived", () => {
    const r = classifyEvidenceRow({ fieldKey: "supporting_documents", status: "waived", payload: {} });
    expect(r.status).toBe("waived");
    expect(r.category).toBe("supporting");
  });
});

describe("classifyEvidenceRow — supporting-only fields never go invalid", () => {
  const SUPPORTING_FIELDS = [
    "order_confirmation",
    "activity_log",
    "customer_communication",
    "customer_account_info",
    "refund_policy",
    "shipping_policy",
    "cancellation_policy",
    "supporting_documents",
  ];

  for (const f of SUPPORTING_FIELDS) {
    it(`${f} with truthy payload → supporting`, () => {
      expect(
        classifyEvidenceRow({ fieldKey: f, status: "available", payload: { url: "..." } })
          .category,
      ).toBe("supporting");
    });
    it(`${f} with null payload → supporting (NOT invalid)`, () => {
      expect(
        classifyEvidenceRow({ fieldKey: f, status: "available", payload: null })
          .category,
      ).toBe("supporting");
    });
    it(`${f} with empty payload → supporting`, () => {
      expect(
        classifyEvidenceRow({ fieldKey: f, status: "available", payload: {} })
          .category,
      ).toBe("supporting");
    });
  }
});

describe("classifyEvidenceRow — avs_cvv_match", () => {
  it("both match → strong", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "avs_cvv_match",
        status: "available",
        payload: { avsResultCode: "Y", cvvResultCode: "M" },
      }).category,
    ).toBe("strong");
  });
  it("one match → moderate", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "avs_cvv_match",
        status: "available",
        payload: { avsResultCode: "Y", cvvResultCode: "N" },
      }).category,
    ).toBe("moderate");
  });
  it("both fail explicitly → invalid", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "avs_cvv_match",
        status: "available",
        payload: { avsResultCode: "N", cvvResultCode: "N" },
      }).category,
    ).toBe("invalid");
  });
  it("payload absent → supporting (NOT invalid)", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "avs_cvv_match", status: "available", payload: null })
        .category,
    ).toBe("supporting");
  });
  it("payload empty (codes blank) → supporting", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "avs_cvv_match", status: "available", payload: {} })
        .category,
    ).toBe("supporting");
  });
});

describe("classifyEvidenceRow — shipping/delivery proofType", () => {
  it("signature_confirmed → strong", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "shipping_tracking",
        status: "available",
        payload: { proofType: "signature_confirmed" },
      }).category,
    ).toBe("strong");
  });
  it("delivered_confirmed → moderate", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "delivery_proof",
        status: "available",
        payload: { proofType: "delivered_confirmed" },
      }).category,
    ).toBe("moderate");
  });
  it("delivered_unverified → supporting", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "shipping_tracking",
        status: "available",
        payload: { proofType: "delivered_unverified" },
      }).category,
    ).toBe("supporting");
  });
  it("label_created → invalid (explicit negative evidence)", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "shipping_tracking",
        status: "available",
        payload: { proofType: "label_created" },
      }).category,
    ).toBe("invalid");
  });
  it("payload absent → supporting (NOT invalid)", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "shipping_tracking", status: "available", payload: null })
        .category,
    ).toBe("supporting");
  });
  it("payload without proofType → supporting", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "delivery_proof",
        status: "available",
        payload: { someOtherKey: "x" },
      }).category,
    ).toBe("supporting");
  });
});

describe("classifyEvidenceRow — ip_location_check", () => {
  it("clean match → moderate", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "ip_location_check",
        status: "available",
        payload: {
          bankEligible: true,
          locationMatch: "match",
          ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
        },
      }).category,
    ).toBe("moderate");
  });
  it("VPN flag → supporting", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "ip_location_check",
        status: "available",
        payload: {
          bankEligible: true,
          locationMatch: "match",
          ipinfo: { privacy: { vpn: true } },
        },
      }).category,
    ).toBe("supporting");
  });
  it("bankEligible: false → supporting", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "ip_location_check",
        status: "available",
        payload: { bankEligible: false },
      }).category,
    ).toBe("supporting");
  });
  it("payload absent → supporting", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "ip_location_check", status: "available", payload: null })
        .category,
    ).toBe("supporting");
  });
});

describe("classifyEvidenceRow — billing_address_match", () => {
  it("match: true → strong", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "billing_address_match",
        status: "available",
        payload: { match: true },
      }).category,
    ).toBe("strong");
  });
  it("match: false → invalid (explicit)", () => {
    expect(
      classifyEvidenceRow({
        fieldKey: "billing_address_match",
        status: "available",
        payload: { match: false },
      }).category,
    ).toBe("invalid");
  });
  it("payload absent → supporting", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "billing_address_match", status: "available", payload: null })
        .category,
    ).toBe("supporting");
  });
});

describe("classifyEvidenceRow — unknown fields", () => {
  it("unregistered field with available status → supporting (not invalid)", () => {
    expect(
      classifyEvidenceRow({ fieldKey: "made_up_field", status: "available", payload: { x: 1 } })
        .category,
    ).toBe("supporting");
  });
});

describe("classifyEvidenceRow — dispute aee832ad scenario", () => {
  it("none of the 8 supporting fields render as Invalid (regression for the submitted-pack screenshot bug)", () => {
    const fields = [
      "order_confirmation",
      "activity_log",
      "customer_communication",
      "customer_account_info",
      "refund_policy",
      "shipping_policy",
      "cancellation_policy",
      "supporting_documents",
    ];
    for (const f of fields) {
      const r = classifyEvidenceRow({ fieldKey: f, status: "available", payload: null });
      expect(r.category, f).toBe("supporting");
    }
  });
  it("avs_cvv_match with Y/M payload (the actual pack 424bedfd codes) → strong", () => {
    const r = classifyEvidenceRow({
      fieldKey: "avs_cvv_match",
      status: "available",
      payload: { avsResultCode: "Y", cvvResultCode: "M" },
    });
    expect(r.category).toBe("strong");
  });
  it("ip_location_check with bankEligible: false (the actual pack 424bedfd state) → supporting", () => {
    const r = classifyEvidenceRow({
      fieldKey: "ip_location_check",
      status: "available",
      payload: { bankEligible: false, locationMatch: "different_country" },
    });
    expect(r.category).toBe("supporting");
  });
});
