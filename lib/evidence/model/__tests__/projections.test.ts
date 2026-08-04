/**
 * P3 — the contract every surface must honour.
 *
 * This is the test the plan's Verification §4 describes: all INVARIANT
 * properties agree across every consumer, every INTENTIONAL difference matches
 * the documented rules, and both directions are checked — the invariants hold,
 * AND the documented divergences are actually present.
 *
 * "Consistent everywhere" is the wrong goal and the wrong wording: it invites
 * someone to push raw AVS codes or every delivery record into the PDF to make
 * a test pass. The rules below are deliberately asymmetric.
 */

import { describe, it, expect } from "vitest";
import { deriveCaseEvidenceModel } from "../derive";
import {
  allRecordIds,
  selectForBank,
  selectForEvidence,
  selectForOverview,
} from "../projections";

const THREE_DS = {
  source: "shopify_transactions",
  fieldsProvided: ["tds_authentication"],
  data: {
    tdsAuthenticated: true,
    liabilityShift: true,
    tdsVerified: false,
    verifiedSource: "shopify_receipt",
    eci: "02",
    dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
  },
};

const TWO_PARCELS = {
  source: "shopify_fulfillments",
  fieldsProvided: ["delivery_proof", "shipping_tracking"],
  data: {
    proofType: "delivered_confirmed",
    deliveredToVerifiedAddress: true,
    deliveredAt: "2026-07-10T19:28:00Z",
    fulfillments: [
      {
        fulfillmentId: "gid://shopify/Fulfillment/1",
        tracking: [{ carrier: "TechSHIP", number: "A1", url: null }],
      },
      {
        fulfillmentId: "gid://shopify/Fulfillment/2",
        tracking: [{ carrier: "TechSHIP", number: "B2", url: null }],
      },
    ],
  },
};

/** device_session_consistency is the sole never-bank-facing field. */
const DEVICE = {
  source: "ipinfo",
  fieldsProvided: ["device_session_consistency"],
  data: { consistent: true },
};

function model(sections: unknown[], reason = "PRODUCT_UNACCEPTABLE") {
  return deriveCaseEvidenceModel({
    disputeId: "d1",
    reason,
    sections: sections as never,
  }).model;
}

describe("traceability — every projected row maps to a canonical record", () => {
  it("no surface invents a row", () => {
    const m = model([THREE_DS, TWO_PARCELS, DEVICE]);
    const canonical = allRecordIds(m);
    for (const [name, rows] of [
      ["overview", selectForOverview(m)],
      ["evidence", selectForEvidence(m)],
      ["bank", selectForBank(m)],
    ] as const) {
      const orphans = rows
        .map((r) => r.recordId)
        .filter((id) => !canonical.has(id));
      expect(orphans, `${name} emitted rows with no canonical record: ${orphans}`).toEqual(
        [],
      );
    }
  });
});

describe("invariants — the same record reads the same everywhere", () => {
  it("quality and identity agree between merchant surfaces and the bank", () => {
    const m = model([THREE_DS, TWO_PARCELS]);
    const evidence = new Map(selectForEvidence(m).map((r) => [r.recordId, r]));
    for (const bankRow of selectForBank(m)) {
      const merchantRow = evidence.get(bankRow.recordId);
      expect(merchantRow, `bank row ${bankRow.recordId} absent from Evidence`).toBeTruthy();
      // A record may be SHOWN differently; it may not BE different.
      expect(merchantRow!.quality).toBe(bankRow.quality);
      expect(merchantRow!.fieldKey).toBe(bankRow.fieldKey);
    }
  });
});

describe("intentional differences — and they must actually be present", () => {
  it("Overview collapses the declared delivery sibling; Evidence does not", () => {
    const m = model([TWO_PARCELS]);
    const overview = selectForOverview(m).map((r) => r.fieldKey);
    // One row, not two — via `aggregation.collapsesWith`, declared once in the
    // definition, replacing four hand-written collapses.
    expect(overview).toContain("delivery_proof");
    expect(overview).not.toContain("shipping_tracking");

    // Evidence shows every parcel: 2 fulfillments x 2 fields = 4 records.
    const evidence = selectForEvidence(m);
    expect(evidence).toHaveLength(4);
    expect(new Set(evidence.map((r) => r.recordId)).size).toBe(4);
  });

  it("Overview reports how many siblings a collapsed row stands for", () => {
    // The merchant is told the row represents more than one parcel rather
    // than the second parcel silently vanishing.
    const m = model([TWO_PARCELS]);
    const row = selectForOverview(m).find((r) => r.fieldKey === "delivery_proof");
    expect(row?.alsoRepresents).toBe(1);
  });

  it("the bank never sees a never-citable record; the merchant does", () => {
    const m = model([DEVICE, THREE_DS]);
    const bankFields = selectForBank(m).map((r) => r.fieldKey);
    expect(bankFields).not.toContain("device_session_consistency");

    const merchantRow = selectForEvidence(m).find(
      (r) => r.fieldKey === "device_session_consistency",
    );
    expect(merchantRow, "the merchant must still see their own internal signal").toBeTruthy();
    expect(merchantRow!.keptInternal).toBe(true);
  });

  it("projections carry no payload, so raw AVS/CVV codes cannot leak", () => {
    // Structural, not a convention: the bank row type has no payload field, so
    // there is nothing for a renderer to reach into. Bank-facing prose is
    // composed from tokens downstream.
    const m = model([
      {
        source: "shopify_transactions",
        fieldsProvided: ["avs_cvv_match"],
        data: { avsResultCode: "N", cvvResultCode: "M" },
      },
    ]);
    const serialized = JSON.stringify(selectForBank(m));
    expect(serialized).not.toContain("avsResultCode");
    expect(serialized).not.toContain('"N"');
  });
});

describe("the incident, as the merchant now sees it", () => {
  it("3-D Secure appears on Overview and Evidence for a PRODUCT_UNACCEPTABLE dispute", () => {
    // blume-box #352552. The field is in NO reason template, so today it has
    // no checklist row and renders nowhere — while the PDF cites it.
    const m = model([THREE_DS]);
    expect(selectForOverview(m).map((r) => r.fieldKey)).toContain("tds_authentication");
    expect(selectForEvidence(m).map((r) => r.fieldKey)).toContain("tds_authentication");
    // And it is genuinely citable, because the liability shift is real.
    expect(selectForBank(m).map((r) => r.fieldKey)).toContain("tds_authentication");
  });

  it("an attempted 3DS is visible to the merchant but withheld from the issuer", () => {
    const m = model([
      {
        source: "shopify_transactions",
        fieldsProvided: ["tds_authentication"],
        data: {
          tdsAuthenticated: true,
          liabilityShift: false,
          tdsVerified: false,
          verifiedSource: "shopify_receipt",
          eci: "06",
        },
      },
    ]);
    expect(selectForEvidence(m).map((r) => r.fieldKey)).toContain("tds_authentication");
    expect(selectForBank(m).map((r) => r.fieldKey)).not.toContain("tds_authentication");
  });
});
