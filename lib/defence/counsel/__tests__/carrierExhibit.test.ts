/**
 * A letter that argues the carrier's record shows it (whj8db-1q #24285,
 * 2026-11-10: a credit-not-processed letter said "The carrier recorded delivery
 * on 22 October" and the PDF had no carrier, no tracking number, no tracking
 * link, no chronology row).
 *
 * THE GUARD: for every reason-code module and every ledger it can reach, the
 * document shows the carrier exhibit exactly when the ledger argues a carrier
 * claim. A future family that adds the claim without the exhibit fails here.
 */
import { describe, expect, it } from "vitest";

import { ALL_REASON_CODE_MODULES } from "../../reasonCodes/registry";
import { buildChronologyEvents } from "../../chronology";
import { evidenceBasisFor, singleShipmentOf } from "../../render/documentModel";
import { EVIDENCE_BASIS_RULE_CITED } from "../../citedFacts";
import { CARRIER_RECORD_CLAIM_IDS, CREDIT_NOT_PROCESSED_BRIEF, briefForModule, carrierRecordArgued } from "../briefs";
import { carrierExhibitFacts } from "../carrierExhibit";
import { ledgerForBrief } from "../run";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

const DELIVERY = {
  id: "f-delivery",
  category: "delivery_proof",
  value: {
    fieldKey: "delivery_proof",
    proofType: "delivered_confirmed",
    carrier: "DHL Freight (Sweden) AB",
    trackingNumber: "4134605023",
    trackingUrl: "https://track.example/4134605023",
    deliveredAt: "2026-10-22T16:07:00Z",
    trackingSource: "carrier_api_dhl",
    finalDeliveryVerified: true,
  },
} as unknown as EvidenceFact;

const NO_RETURN = {
  id: "f-noret",
  category: "no_return_initiated",
  value: { returnStatus: "NO_RETURN", returnInitiated: false },
} as unknown as EvidenceFact;
const ORDER = { id: "f-order", category: "order_record", value: { fieldKey: "order_confirmation" } } as unknown as EvidenceFact;
const POLICY = {
  id: "f-policy",
  category: "policy_refund",
  value: { fieldKey: "refund_policy", publishedOnStore: true },
} as unknown as EvidenceFact;

const SECTIONS: LedgerInput["packSections"] = [
  { type: "order", source: "shopify_order", data: { orderName: "#24285", createdAt: "2026-10-18T10:00:00Z" } },
  { type: "order", source: "shopify_order", data: { returnStatus: "NO_RETURN" } },
  {
    type: "shipping",
    source: "shopify_fulfillments",
    data: {
      fulfillments: [
        {
          createdAt: "2026-10-19T09:00:00Z",
          deliveredAt: "2026-10-22T16:07:00Z",
          shipmentProofType: "delivered_confirmed",
          tracking: [{ number: "4134605023", carrier: "DHL Freight (Sweden) AB" }],
        },
      ],
    },
  },
];

function input(facts: EvidenceFact[], moduleKey: string, sections = SECTIONS): LedgerInput {
  return {
    moduleKey,
    facts,
    packSections: sections,
    orderName: "#24285",
    disputeOpenedAt: "2026-11-05T08:00:00Z",
    disputeAmount: 1000,
    disputeCurrency: "SEK",
    customerOrders: [],
  };
}

/** What the job does: the module's plan keeps only its allowed categories. */
function planFor(moduleKey: string, all: EvidenceFact[]): EvidenceFact[] {
  const mod = ALL_REASON_CODE_MODULES.find((m) => m.key === moduleKey)!;
  return all.filter((f) => (mod.allowedFactCategories as string[]).includes(f.category));
}

describe("the carrier exhibit follows the ledger, for every module", () => {
  const all = [ORDER, NO_RETURN, POLICY, DELIVERY];
  for (const mod of ALL_REASON_CODE_MODULES) {
    it(`${mod.key}: carrier claim argued <=> the document holds the carrier record`, () => {
      const plan = planFor(mod.key, all);
      const pool = all.filter((f) => f.category === "delivery_proof");
      // Offered to the ledger exactly as run.ts does.
      const offered = [...plan, ...pool.filter((p) => !plan.some((f) => f.id === p.id))];
      const got = ledgerForBrief(briefForModule(mod.key), input(offered, mod.key), null);
      const ledger = got?.ledger ?? [];
      const ids = new Set(ledger.map((c) => c.id));
      const exhibit = carrierExhibitFacts(ledger, plan, pool);
      const documentFacts = [...plan, ...exhibit];
      const card = singleShipmentOf(documentFacts, [], "#24285");

      if (carrierRecordArgued(ids)) {
        expect(card, "shipment card").not.toBeNull();
        expect(card).toMatchObject({
          carrier: "DHL Freight (Sweden) AB",
          reference: "4134605023",
          trackingUrl: "https://track.example/4134605023",
        });
        // The matching chronology row, with no carrier row in the order timeline.
        const rows = buildChronologyEvents(
          { timelineEvents: [{ at: "2026-10-18T10:00:00Z", text: "The customer placed this order." }] },
          documentFacts,
        );
        expect(rows.some((r) => r.at === "2026-10-22T16:07:00Z")).toBe(true);
        // Stated once: the card carries the delivery, the table does not repeat it.
        expect(evidenceBasisFor(documentFacts, EVIDENCE_BASIS_RULE_CITED, new Set(["f-delivery"])).single).toBe(true);
      } else {
        expect(exhibit).toEqual([]);
        expect(card).toBeNull();
      }
    });
  }

  it("any claim that cites the shipping record comes with a carrier claim (a new claim cannot skip the exhibit)", () => {
    for (const mod of ALL_REASON_CODE_MODULES) {
      const got = ledgerForBrief(briefForModule(mod.key), input([ORDER, NO_RETURN, POLICY, DELIVERY], mod.key), null);
      const ledger = got?.ledger ?? [];
      const cites = ledger.filter((c) => c.sources.some((s) => s.startsWith("pack.shipping") || s === DELIVERY.id));
      if (cites.length > 0) {
        expect(
          carrierRecordArgued(new Set(ledger.map((c) => c.id))),
          `${mod.key}: ${cites.map((c) => c.id).join(",")}`,
        ).toBe(true);
      }
    }
  });

  it("the carrier claims are all known to the owner list", () => {
    expect(CARRIER_RECORD_CLAIM_IDS).toEqual(expect.arrayContaining(["carrier_delivered", "shipped"]));
  });
});

describe("credit not processed, the #24285 shape", () => {
  it("the module keeps the delivery fact out of the plan, and the ledger argues the delivery anyway", () => {
    const plan = planFor("credit_not_processed", [ORDER, NO_RETURN, POLICY, DELIVERY]);
    expect(plan.map((f) => f.id)).not.toContain("f-delivery");
    const got = ledgerForBrief(
      CREDIT_NOT_PROCESSED_BRIEF,
      input([ORDER, NO_RETURN, POLICY, DELIVERY], "credit_not_processed"),
      null,
    )!;
    expect(got.ledger.map((c) => c.id)).toContain("carrier_delivered");
    expect(carrierExhibitFacts(got.ledger, plan, [DELIVERY]).map((f) => f.id)).toEqual(["f-delivery"]);
  });

  it("a ledger with no delivery claim adds no exhibit", () => {
    const noShipping = SECTIONS.filter((s) => s?.type !== "shipping");
    const got = ledgerForBrief(
      CREDIT_NOT_PROCESSED_BRIEF,
      input([ORDER, NO_RETURN, POLICY], "credit_not_processed", noShipping),
      null,
    )!;
    expect(got.ledger.map((c) => c.id)).not.toContain("carrier_delivered");
    expect(carrierExhibitFacts(got.ledger, [ORDER, NO_RETURN, POLICY], [DELIVERY])).toEqual([]);
  });
});
