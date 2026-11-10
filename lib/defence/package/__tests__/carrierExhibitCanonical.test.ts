/**
 * The carrier exhibit on the CANONICAL route (CANONICAL_PIPELINE=on).
 *
 * #1116 appended the exhibit facts to the plan's fact list. Their ids are the
 * classifier's positional ids; the plan authorises RECORD ids. Every counsel
 * section cites the facts it was handed, so every section cited ids the plan
 * does not authorise and #24285 v20 failed `orphaned_claim` in production
 * (2026-11-10). The tests of #1116 rendered the document but never ran the
 * projection and the plan-aware validator.
 *
 * Here the REAL runCounsel (model mocked) feeds the REAL projection and the
 * REAL `validatePackageDocument`, for every module that can reach the exhibit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopify/makeAuthedRequest", () => ({ makeAuthedRequest: vi.fn(async () => ({ data: null })) }));
const callClaudeMessages = vi.fn();
vi.mock("../../anthropicClient", () => ({ callClaudeMessages: (...a: unknown[]) => callClaudeMessages(...a) }));

import { runCounsel } from "../../counsel/run";
import { projectPackageFromPlan } from "../projectFromPlan";
import { validatePackageDocument } from "../documentValidation";
import { carrierExhibitFacts } from "../../counsel/carrierExhibit";
import { singleShipmentOf } from "../../render/documentModel";
import type { EvidenceFact } from "../../types";

const base = {
  source: "shopify_order",
  sourceRef: null,
  strength: "strong",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  confidence: null,
};
const f = (id: string, category: string, value: Record<string, unknown>) =>
  ({ ...base, id, category, label: category, value }) as unknown as EvidenceFact;

// The plan's facts carry RECORD ids (selectPlanFacts relabels them).
const PLAN_FACTS = [
  f("order_confirmation#0", "order_record", { fieldKey: "order_confirmation" }),
  f("refund_policy#0", "policy_refund", { fieldKey: "refund_policy", publishedOnStore: true }),
  f("no_return_initiated#0", "no_return_initiated", { returnStatus: "NO_RETURN", returnInitiated: false }),
];
// The classifier's fact: positional id, NOT in the plan.
const DELIVERY = f("f7", "delivery_proof", {
  fieldKey: "delivery_proof",
  proofType: "delivered_confirmed",
  carrier: "DHL Freight (Sweden) AB",
  trackingNumber: "4134605023",
  trackingUrl: "https://track.example/4134605023",
  deliveredAt: "2026-10-22T16:07:00Z",
});

const SECTIONS = [
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

const plan = {
  noSafeArgument: null,
  included: PLAN_FACTS.map((x) => ({ recordId: x.id })),
  excluded: [],
} as never;

const WRITE = JSON.stringify({
  summary: ["No return has been recorded in Shopify for this order. The store's refund policy is published on the store. The merchant respectfully requests that this inquiry be closed in its favour."],
  summaryClaimIds: ["no_return_recorded", "refund_policy_published"],
  sections: {
    shipping: { text: "The carrier recorded delivery on 22 October.", claimIds: ["carrier_delivered"] },
  },
  conclusion: { text: "No return has been recorded in Shopify for this order.", claimIds: ["no_return_recorded"] },
});
const REVIEW = JSON.stringify({ errors: [], unclear: [] });

afterEach(() => callClaudeMessages.mockReset());

function model(write: string) {
  const queue = [write, REVIEW, REVIEW, REVIEW];
  callClaudeMessages.mockImplementation(async () => ({
    raw: queue.shift() ?? REVIEW,
    promptTokens: 1,
    completionTokens: 1,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 1,
    error: null,
  }));
}

async function run(facts: EvidenceFact[], pool: EvidenceFact[], moduleKey = "credit_not_processed", write = WRITE) {
  model(write);
  return runCounsel({
    shopId: "shop",
    moduleKey,
    facts,
    carrierRecordPool: pool,
    packSections: SECTIONS,
    orderName: "#24285",
    orderGid: null,
    disputeGid: "gid://shopify/Dispute/1",
    disputeOpenedAt: "2026-11-05T08:00:00Z",
    disputeAmount: 1000,
    disputeCurrency: "SEK",
    amountDisplay: "SEK 1000",
    cardLast4: null,
    merchantName: "Shop AB",
    paymentFamily: "card",
    paymentLabel: "Card",
    phase: "inquiry",
  } as never);
}

function validate(narrative: never, includedFacts: EvidenceFact[]) {
  const projection = projectPackageFromPlan({
    plan,
    narrative,
    factsByRecordId: new Map(PLAN_FACTS.map((x) => [x.id, x])),
    bankIncludedFacts: includedFacts,
    packageMode: "full",
    familyKey: "credit_not_processed" as never,
    moduleKey: "credit_not_processed",
    fulfillmentStatus: null,
  });
  const verdict = validatePackageDocument({
    plan,
    blocks: projection.blocks,
    includedFacts,
    orphaned: projection.orphaned,
    missingRecordIds: projection.missingRecordIds,
    packageMode: "full",
  });
  return { projection, verdict };
}

describe("canonical route: the carrier exhibit is not an orphaned claim", () => {
  it("the real writer + projection + document validation: no orphaned_claim, and the exhibit is returned for the document", async () => {
    const res = await run(PLAN_FACTS, [DELIVERY]);
    expect(res, "counsel wrote a letter").not.toBeNull();
    expect(res!.exhibitFacts!.map((x) => x.id)).toEqual(["f7"]);
    // Sections cite plan records only.
    for (const s of Object.values(res!.narrative)) {
      const ids = (s as { usedFactIds?: string[] } | undefined)?.usedFactIds ?? [];
      for (const id of ids) expect(PLAN_FACTS.map((x) => x.id)).toContain(id);
    }
    const { projection, verdict } = validate(res!.narrative as never, PLAN_FACTS);
    expect(projection.orphaned).toEqual([]);
    expect(verdict.failureCodes).not.toContain("orphaned_claim");
    // And the document still has the card from the document-level list.
    expect(singleShipmentOf([...PLAN_FACTS, ...res!.exhibitFacts!], [], "#24285")).not.toBeNull();
  });

  it("the #1116 shape (exhibit appended to the plan's facts before the writer) IS an orphaned claim", async () => {
    const res = await run([...PLAN_FACTS, DELIVERY], [DELIVERY]);
    expect(res).not.toBeNull();
    const { verdict } = validate(res!.narrative as never, [...PLAN_FACTS, DELIVERY]);
    expect(verdict.failureCodes).toContain("orphaned_claim");
  });

  it("plan-only facts are unchanged by the exhibit (hash input stays the plan's)", () => {
    expect(carrierExhibitFacts([], PLAN_FACTS, [DELIVERY])).toEqual([]);
  });
});

describe("every module that reaches the carrier exhibit validates on the canonical route", () => {
  const GENERAL_WRITE = JSON.stringify({
    summary: ["The customer disputes the transaction. The merchant respectfully requests that this inquiry be closed in its favour."],
    summaryClaimIds: ["claim_stated"],
    sections: { shipping: { text: "The carrier recorded delivery on 22 October.", claimIds: ["carrier_delivered"] } },
    conclusion: { text: "The record shows the order and its delivery.", claimIds: ["carrier_delivered"] },
  });
  for (const key of ["duplicate_processing", "canceled_recurring"]) {
    it(`${key}: no orphaned_claim, card available`, async () => {
      const res = await run(PLAN_FACTS, [DELIVERY], key, GENERAL_WRITE);
      expect(res, "counsel wrote a letter").not.toBeNull();
      const { verdict } = validate(res!.narrative as never, PLAN_FACTS);
      expect(verdict.failureCodes).not.toContain("orphaned_claim");
      expect(res!.exhibitFacts!.map((x) => x.id)).toEqual(["f7"]);
    });
  }
});
