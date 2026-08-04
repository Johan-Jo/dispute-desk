/**
 * Characterization of `deriveCaseEvidenceModel` against REAL prod payloads.
 *
 * Fixtures are copied verbatim from blume-box dispute #352552
 * (`0f53431d-177c-46b7-b199-e7a766f28a88`, prod, 2026-08-04) — the incident
 * that started this migration. Synthetic fixtures would prove the derivation
 * agrees with my assumptions; these prove it agrees with production.
 *
 * These tests pin CURRENT behaviour. They go red when behaviour changes, which
 * is the point: during the migration a change that is not in the divergence
 * manifest is a regression, not progress.
 */

import { describe, it, expect } from "vitest";
import { deriveCaseEvidenceModel } from "../derive";
import { EVIDENCE_FIELD_KEYS } from "../domains";

/** Verbatim from pack 01ea1c54 `pack_json.sections[]`, prod. */
const THREE_DS_SECTION = {
  source: "shopify_transactions",
  fieldsProvided: ["tds_authentication"],
  data: {
    eci: "02",
    gateway: "shopify_payments",
    tdsVersion: "2.2.0",
    tdsVerified: false,
    liabilityShift: true,
    receiptPresent: true,
    verifiedSource: "shopify_receipt",
    dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
    tdsAuthenticated: true,
    authenticationFlow: "frictionless",
    exemptionIndicator: null,
  },
};

const DELIVERY_SECTION = {
  source: "shopify_fulfillments",
  fieldsProvided: ["shipping_tracking", "delivery_proof"],
  data: {
    proofType: "delivered_confirmed",
    deliveredAt: "2026-07-10T19:28:00Z",
    deliveredToVerifiedAddress: true,
    signedByName: null,
    fulfillmentCount: 1,
    fulfillments: [
      {
        fulfillmentId: "gid://shopify/Fulfillment/6558653219009",
        status: "SUCCESS",
        deliveredAt: "2026-07-10T19:28:00Z",
        tracking: [
          {
            carrier: "TechSHIP",
            number: "420774699261290416102420728961",
            url: "https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420774699261290416102420728961",
          },
        ],
      },
    ],
  },
};

const COVERAGE_SECTION = {
  source: "shopify_order",
  fieldsProvided: ["shopify_protect_coverage"],
  data: { state: "not_covered", shopifyProtectStatus: null },
};

function derive(sections: unknown[], reason = "PRODUCT_UNACCEPTABLE") {
  return deriveCaseEvidenceModel({
    disputeId: "0f53431d-177c-46b7-b199-e7a766f28a88",
    reason,
    packId: "01ea1c54-cf88-4313-8e6e-01beae0b018e",
    sections: sections as never,
  });
}

describe("#352552 — the incident, as the model sees it", () => {
  const { model } = derive([THREE_DS_SECTION, DELIVERY_SECTION]);
  const tds = model.fields.tds_authentication;

  it("the 3-D Secure record EXISTS even though no reason template lists the field", () => {
    // This is the fix in one assertion. Today `evaluateCompletenessV2` gives
    // the field no checklist row on PRODUCT_UNACCEPTABLE, so it is invisible
    // on Overview and Evidence and skipped by the scorer — while the PDF
    // cites it. Here it exists, and relevance is a separate, explicit fact.
    expect(tds.records).toHaveLength(1);
    expect(tds.status.available).toBe(true);
    expect(tds.relevance).toBe("not_applicable");
  });

  it("carries a stable, non-positional record id", () => {
    // `EvidenceFact.id` is `f${index}` today — it changes on every rebuild,
    // so nothing downstream can reference a specific fact.
    expect(tds.records[0].recordId).toBe("tds_authentication#shopify_transactions");
    expect(tds.representativeId).toBe("tds_authentication#shopify_transactions");
  });

  it("is citable, because the liability shift is real", () => {
    // The predicate is imported from factClassifier, not restated — so the
    // model and the bank filter cannot disagree about this record.
    expect(tds.citableIds).toEqual(["tds_authentication#shopify_transactions"]);
    expect(tds.records[0].citation.eligibility).toBe("eligible");
  });

  it("is corroborating, not decisive — the receipt read is unverified", () => {
    // `tdsVerified: false` (no manual-confirmation flow exists in prod), so
    // the categorizer caps a receipt read at moderate. Raising this to
    // decisive is a scoring-policy change and belongs to P2b with its
    // transition matrix, NOT to a shadow derivation.
    expect(tds.records[0].validity.state).toBe("valid");
    expect(tds.records[0].quality).toBe("corroborating");
    expect(tds.quality).toBe("corroborating");
  });

  it("delivery is decisive and citable on the same dispute", () => {
    const delivery = model.fields.delivery_proof;
    expect(delivery.records[0].quality).toBe("decisive");
    expect(delivery.records[0].provenance.origin).toBe("shopify_fulfillment");
    expect(delivery.citableIds).toHaveLength(1);
  });
});

describe("membership carries no meaning", () => {
  it("every registered evidence field is present, collected or not", () => {
    const { model } = derive([THREE_DS_SECTION]);
    expect(Object.keys(model.fields).sort()).toEqual([...EVIDENCE_FIELD_KEYS].sort());
    // An uncollected field is an empty records array with explicit flags —
    // not an absence that later code has to interpret.
    expect(model.fields.refund_record.records).toEqual([]);
    expect(model.fields.refund_record.status.available).toBe(false);
    expect(model.fields.refund_record.status.satisfied).toBe(false);
  });
});

describe("waiving never makes evidence available", () => {
  it("keeps available false and satisfied true", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "PRODUCT_UNACCEPTABLE",
      sections: [],
      waivedItems: [
        {
          field: "delivery_proof",
          label: "Delivery Proof",
          reason: "evidence_unavailable",
          waivedAt: "2026-08-01T00:00:00Z",
          waivedBy: "merchant",
        },
      ],
    });
    const d = model.fields.delivery_proof;
    // The old model folded these together, so a merchant surface could say
    // "Delivery evidence available" about a dispute the merchant had just
    // dismissed the request for.
    expect(d.status.available).toBe(false);
    expect(d.status.waived).not.toBeNull();
    expect(d.status.satisfied).toBe(true);
  });
});

describe("the domain boundary holds at derivation time", () => {
  it("coverage never becomes an evidence field", () => {
    const { model } = derive([COVERAGE_SECTION, THREE_DS_SECTION]);
    expect(Object.keys(model.fields)).not.toContain("shopify_protect_coverage");
    expect(model.nonEvidence.operational.unregisteredFields).toEqual([]);
  });

  it("reports an unregistered field instead of dropping it", () => {
    // Both pipelines `continue` past unknown keys today with no record that
    // they existed — which is how a deliberate exclusion and an accidental
    // one became indistinguishable.
    const { model } = derive([
      { source: "manual_upload", fieldsProvided: ["not_a_real_field"], data: {} },
    ]);
    expect(model.nonEvidence.operational.unregisteredFields).toEqual([
      "not_a_real_field",
    ]);
  });
});

describe("P2a — real instances become real records", () => {
  it("splits a Gorgias thread into one record per conversation", () => {
    // P1 emitted ONE record here and reported the shortfall via
    // recordsCollapsed. That assertion going red is the migration landing.
    // Prod carries exactly this shape on one dispute today.
    const { model, recordsCollapsed } = derive([
      {
        source: "gorgias",
        fieldsProvided: ["customer_communication"],
        data: { conversationCount: 2, conversations: [{ id: "a" }, { id: "b" }] },
      },
    ]);
    const comms = model.fields.customer_communication;
    expect(comms.records).toHaveLength(2);
    expect(comms.records.map((r) => r.recordId)).toEqual([
      "customer_communication#a",
      "customer_communication#b",
    ]);
    expect(recordsCollapsed.customer_communication).toEqual({
      nested: 2,
      emitted: 2,
    });
  });

  it("splits a two-parcel shipment and keys each record on its Shopify GID", () => {
    // The scenario that drove the Definition/Record split. No disputed order
    // in prod has two fulfillments yet (74/74 have one), so this fixture is
    // synthetic by necessity — the shape is the real fulfillment shape.
    const { model } = derive([
      {
        source: "shopify_fulfillments",
        fieldsProvided: ["delivery_proof"],
        data: {
          proofType: "delivered_confirmed",
          deliveredToVerifiedAddress: true,
          fulfillments: [
            {
              fulfillmentId: "gid://shopify/Fulfillment/1",
              deliveredAt: "2026-07-10T19:28:00Z",
              tracking: [{ carrier: "TechSHIP", number: "A1", url: null }],
            },
            {
              fulfillmentId: "gid://shopify/Fulfillment/2",
              deliveredAt: null,
              tracking: [{ carrier: "TechSHIP", number: "B2", url: null }],
            },
          ],
        },
      },
    ]);
    const d = model.fields.delivery_proof;
    expect(d.records).toHaveLength(2);
    expect(d.records.map((r) => r.recordId)).toEqual([
      "delivery_proof#gid://shopify/Fulfillment/1",
      "delivery_proof#gid://shopify/Fulfillment/2",
    ]);
    // Both parcels are citable — today `firstTrackingEntry()` keeps one and
    // the second parcel never reaches the issuer.
    expect(d.citableIds).toHaveLength(2);
    expect(d.records[1].provenance.sourceSystemId).toBe(
      "gid://shopify/Fulfillment/2",
    );
  });

  it("emits one record for a genuinely single-instance field", () => {
    const { recordsCollapsed } = derive([THREE_DS_SECTION]);
    expect(recordsCollapsed.tds_authentication).toEqual({ nested: 1, emitted: 1 });
  });
});

describe("P2a — typed payloads replace the raw-record back door", () => {
  it("normalizes 3DS into named fields instead of collector JSON", () => {
    const { model } = derive([THREE_DS_SECTION]);
    expect(model.fields.tds_authentication.records[0].payload).toEqual({
      fieldKey: "tds_authentication",
      authenticated: true,
      liabilityShift: true,
      merchantConfirmed: false,
      eci: "02",
      dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
      version: "2.2.0",
      flow: "frictionless",
      exemption: null,
    });
  });

  it("reads the LEGACY snake_case AVS shape that 11 prod packs still carry", () => {
    // `categorizeEvidenceField` reads `avsResultCode` only, so these packs
    // score AVS as invalid. They are all decided (newest 2026-01-19), so this
    // is not a live merchant bug — but re-deriving the model on read touches
    // them, and mis-reading a decided case corrupts any post-mortem.
    const { model } = derive([
      {
        source: "shopify_transactions",
        fieldsProvided: ["avs_cvv_match"],
        data: { avs_result_code: "Y", cvv_result_code: "M", processor: "stripe" },
      },
    ]);
    const payload = model.fields.avs_cvv_match.records[0].payload;
    expect(payload).toMatchObject({
      fieldKey: "avs_cvv_match",
      avsResultCode: "Y",
      cvvResultCode: "M",
    });
  });

  it("reads the LEGACY flat delivery shape (4 prod packs, no fulfillments[])", () => {
    const { model } = derive([
      {
        source: "shopify_fulfillments",
        fieldsProvided: ["delivery_proof"],
        data: {
          carrier: "PostNord",
          trackingNumber: "XYZ",
          status: "delivered",
          deliveredAt: "2026-01-02T10:00:00Z",
        },
      },
    ]);
    const payload = model.fields.delivery_proof.records[0].payload;
    expect(payload).toMatchObject({ fieldKey: "delivery_proof" });
    expect(
      (payload as { fulfillments: { tracking: { number: string | null }[] }[] })
        .fulfillments[0].tracking[0].number,
    ).toBe("XYZ");
  });
});
