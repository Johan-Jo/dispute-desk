/**
 * PR-C1 — retired payload keys.
 *
 * Historical `pack_json` is immutable and must still parse. What must NOT
 * happen is a retired value re-entering an evidence record, a category, a
 * grade, a completeness credit, a citation, or an LLM payload.
 */

import { describe, expect, it } from "vitest";
import {
  RETIRED_PAYLOAD_KEYS,
  isRetiredPayloadKey,
  retiredPayloadKeysIn,
  stripRetiredPayloadKeys,
} from "../retiredKeys";
import { deriveCaseEvidenceModel } from "../derive";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import { extractValueForTest } from "@/lib/defence/factClassifier";

/** A faithful copy of a historical delivery section, retired keys included. */
const HISTORICAL_SECTION = {
  source: "shopify_fulfillments",
  fieldsProvided: ["delivery_proof", "shipping_tracking"],
  data: {
    proofType: "delivered_confirmed",
    deliveredAt: "2026-07-10T19:28:00Z",
    deliveredToVerifiedAddress: true,
    collectedByCustomer: true,
    carrier: "PostNord",
    fulfillments: [
      {
        fulfillmentId: "gid://shopify/Fulfillment/1",
        deliveredAt: "2026-07-10T19:28:00Z",
        tracking: [{ carrier: "PostNord", number: "A1", url: null }],
      },
    ],
  },
};

describe("the registry", () => {
  it("names exactly the two keys PR-C1 retires", () => {
    expect([...RETIRED_PAYLOAD_KEYS].sort()).toEqual([
      "collectedByCustomer",
      "deliveredToVerifiedAddress",
    ]);
    expect(isRetiredPayloadKey("deliveredToVerifiedAddress")).toBe(true);
    expect(isRetiredPayloadKey("proofType")).toBe(false);
  });
});

describe("stripRetiredPayloadKeys", () => {
  it("removes retired keys and keeps everything else", () => {
    const out = stripRetiredPayloadKeys(HISTORICAL_SECTION.data)!;
    expect("deliveredToVerifiedAddress" in out).toBe(false);
    expect("collectedByCustomer" in out).toBe(false);
    expect(out.proofType).toBe("delivered_confirmed");
    expect(out.deliveredAt).toBe("2026-07-10T19:28:00Z");
    expect(out.carrier).toBe("PostNord");
  });

  it("returns the same reference when nothing is retired (no needless copy)", () => {
    const clean = { proofType: "delivered_confirmed" };
    expect(stripRetiredPayloadKeys(clean)).toBe(clean);
  });

  it("passes null / undefined through", () => {
    expect(stripRetiredPayloadKeys(null)).toBeNull();
    expect(stripRetiredPayloadKeys(undefined)).toBeUndefined();
  });

  it("reports which retired keys were present", () => {
    expect(retiredPayloadKeysIn(HISTORICAL_SECTION.data).sort()).toEqual([
      "collectedByCustomer",
      "deliveredToVerifiedAddress",
    ]);
    expect(retiredPayloadKeysIn({ proofType: "x" })).toEqual([]);
    expect(retiredPayloadKeysIn(null)).toEqual([]);
  });
});

describe("a historical pack derives cleanly", () => {
  const { model } = deriveCaseEvidenceModel({
    disputeId: "d1",
    reason: "PRODUCT_NOT_RECEIVED",
    sections: [HISTORICAL_SECTION],
  });

  it("parses — the pack is still readable", () => {
    expect(model.fields.delivery_proof.records.length).toBeGreaterThan(0);
  });

  it("records the retired keys as OPERATIONAL metadata, not as fields", () => {
    expect(model.nonEvidence.operational.retiredFields.sort()).toEqual([
      "collectedByCustomer",
      "deliveredToVerifiedAddress",
    ]);
    // Not an accident — the retired keys must never be reported as
    // unregistered collector fields.
    expect(model.nonEvidence.operational.unregisteredFields).toEqual([]);
  });

  it("does not let the retired value produce a decisive grade", () => {
    const record = model.fields.delivery_proof.records[0];
    expect(record.validity.state).toBe("valid");
    expect(record.quality).toBe("corroborating"); // moderate, not decisive
  });

  it("keeps the retired keys out of the normalized payload", () => {
    const payload = model.fields.delivery_proof.records[0].payload as Record<string, unknown>;
    expect("deliveredToVerifiedAddress" in payload).toBe(false);
    expect("collectedByCustomer" in payload).toBe(false);
    expect(payload.proofType).toBe("delivered_confirmed");
  });
});

describe("retired keys cannot reach a grade or a bank fact", () => {
  it("the categorizer ignores them", () => {
    expect(
      categorizeEvidenceField("delivery_proof", HISTORICAL_SECTION.data),
    ).toBe("moderate");
  });

  it("the fact extractor strips them, so nothing reaches facts_json or the LLM", () => {
    const value = extractValueForTest("delivery_proof", HISTORICAL_SECTION.data);
    expect("deliveredToVerifiedAddress" in value).toBe(false);
    expect("collectedByCustomer" in value).toBe(false);
    // Surviving, verifiable identifiers are still emitted.
    expect(value.carrier).toBe("PostNord");
    expect(value.trackingNumber).toBe("A1");
    expect(value.deliveredAt).toBe("2026-07-10T19:28:00Z");
  });
});
