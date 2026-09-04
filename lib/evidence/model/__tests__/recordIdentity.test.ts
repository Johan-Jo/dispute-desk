/**
 * Pins the record-identity defect that printed the SAME fact twice in the
 * merchant-visible "Evidence Basis" section.
 *
 * `deriveCaseEvidenceModel` is fed the same underlying evidence from two
 * inputs: `sections` (from `pack_json.sections`, no `evidenceItemId`) and
 * `evidenceItems` (rows carrying a uuid). The record id's fallback used to
 * be `evidenceItemId ?? source ?? "unknown"` — provenance, not identity — so
 * one fact became two records with different ids, the dedup on `recordId`
 * never fired, and the duplicate rode all the way through the argument plan
 * into the PDF and the Review & Forward page.
 *
 * Verified on prod package 014f4e23-6b44-4095-bfa5-de1addfcb2ea (blume-box):
 * `plan_json.included[]` carried both ids for `no_return_initiated`.
 */

import { describe, it, expect } from "vitest";
import { deriveCaseEvidenceModel } from "../derive";

const NO_RETURN_DATA = { noReturnInitiated: true, returnCount: 0 };

describe("record identity is independent of the derivation path", () => {
  it("emits ONE record when a section and its mirrored evidence_item carry the same fact", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: [
        {
          source: "shopify_order",
          fieldsProvided: ["no_return_initiated"],
          data: NO_RETURN_DATA,
        },
      ],
      evidenceItems: [
        {
          id: "1419a997-4874-4eae-8cb5-dfbe707022ab",
          source: "shopify_order",
          created_at: "2026-07-10T19:28:00Z",
          payload: { ...NO_RETURN_DATA, fieldsProvided: ["no_return_initiated"] },
        },
      ],
    });

    const records = model.fields.no_return_initiated.records;
    expect(records.map((r) => r.recordId)).toEqual(["no_return_initiated#0"]);
  });

  it("still dedups when the two paths report different collector sources", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: [
        { source: "shopify_order", fieldsProvided: ["no_return_initiated"], data: NO_RETURN_DATA },
      ],
      evidenceItems: [
        {
          id: "abc",
          source: "shopify_refunds",
          created_at: null,
          payload: { ...NO_RETURN_DATA, fieldsProvided: ["no_return_initiated"] },
        },
      ],
    });

    expect(model.fields.no_return_initiated.records).toHaveLength(1);
  });

  it("does NOT collapse genuine parcel A / parcel B into one record", () => {
    const twoParcels = {
      proofType: "delivered_confirmed",
      fulfillments: [
        {
          fulfillmentId: "gid://shopify/Fulfillment/1",
          status: "SUCCESS",
          displayStatus: "DELIVERED",
          deliveredAt: "2026-07-10T19:28:00Z",
          tracking: [{ number: "AAA111", carrier: "TechSHIP", url: null }],
        },
        {
          fulfillmentId: "gid://shopify/Fulfillment/2",
          status: "SUCCESS",
          displayStatus: "DELIVERED",
          deliveredAt: "2026-07-11T09:00:00Z",
          tracking: [{ number: "BBB222", carrier: "TechSHIP", url: null }],
        },
      ],
    };

    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: [
        { source: "shopify_fulfillments", fieldsProvided: ["delivery_proof"], data: twoParcels },
      ],
      evidenceItems: [
        {
          id: "item-1",
          source: "shopify_fulfillments",
          created_at: null,
          payload: { ...twoParcels, fieldsProvided: ["delivery_proof"] },
        },
      ],
    });

    const ids = model.fields.delivery_proof.records.map((r) => r.recordId);
    expect(ids).toEqual([
      "delivery_proof#gid://shopify/Fulfillment/1",
      "delivery_proof#gid://shopify/Fulfillment/2",
    ]);
  });
});

/**
 * The end-to-end path the merchant actually saw: model → argument plan →
 * `selectPlanFacts` → `buildEvidenceBasisRows`. Reproduces the blume-box
 * screenshot (Visa 10.4, "No return initiated / Confirmed" twice).
 */
describe("Evidence Basis prints one row per real fact", () => {
  it("emits ONE 'No return initiated' row when section and evidence_item mirror it", async () => {
    const { derivePlanForCase } = await import("@/lib/argument/plan/planForCase");
    const { selectPlanFacts } = await import("@/lib/defence/package/projectFromPlan");
    const { buildEvidenceBasisRows } = await import("@/lib/defence/pdf/evidenceBasisRows");

    const fact = {
      id: "f0",
      category: "no_return_initiated" as const,
      label: "No return initiated",
      value: { fieldKey: "no_return_initiated", noReturnInitiated: true },
      source: "shopify_order",
      sourceRef: null,
      strength: "moderate" as const,
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    };

    const { plan, factsByRecordId } = derivePlanForCase({
      caseId: "c1",
      model: {
        disputeId: "d1",
        reason: "FRAUDULENT",
        sections: [
          {
            source: "shopify_order",
            fieldsProvided: ["no_return_initiated"],
            data: NO_RETURN_DATA,
          },
        ],
        evidenceItems: [
          {
            id: "1419a997-4874-4eae-8cb5-dfbe707022ab",
            source: "shopify_order",
            created_at: "2026-07-10T19:28:00Z",
            payload: { ...NO_RETURN_DATA, fieldsProvided: ["no_return_initiated"] },
          },
        ],
      },
      reasonCodeModule: {
        key: "visa_10_4_fraud",
        allowedFactCategories: ["no_return_initiated"],
        criticalCategories: [],
      },
      approvedFacts: [fact],
      computedAt: "2026-09-03T00:00:00Z",
    });

    // The plan itself must carry exactly one record id — a renderer-level
    // dedup would hide the duplicate here while the narrative writer,
    // `validateNarrative` and `usedFactIds` all still joined against two.
    const included = plan.included.filter((i) => i.fieldKey === "no_return_initiated");
    expect(included).toHaveLength(1);

    const { includedFacts } = selectPlanFacts(plan, factsByRecordId);
    const rows = buildEvidenceBasisRows(includedFacts);
    expect(rows.filter((r) => r.label === "No return initiated")).toHaveLength(1);
  });
});
