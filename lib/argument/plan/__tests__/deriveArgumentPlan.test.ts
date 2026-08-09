/**
 * `CaseArgumentPlan` derivation — CP-B §1.
 *
 * The properties under test are the ones the rest of the epic rests on:
 * exclusion happens BEFORE generation, every exclusion carries a reason the
 * merchant can read, and a plan with an unresolved review item is deadline_only.
 */

import { describe, expect, it } from "vitest";
import type { MerchantReviewItem, SnapshotFreshness } from "@/lib/pipeline/contracts";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import {
  computePlanInputHash,
  deriveCaseArgumentPlan,
  excludedRecordIds,
  includedRecordIds,
  planHasSafeArgument,
  type PlanCandidate,
} from "..";
import { EXCLUSION_REASON_TOKENS } from "../exclusionTokens";

const FRESHNESS: SnapshotFreshness = {
  inputHash: "plan-hash",
  policyVersion: 1,
  computedAt: "2026-08-09T00:00:00.000Z",
};

const MODULE = resolveReasonCodeModule("10.4");

function candidate(over: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    recordId: "delivery_proof#0",
    fieldKey: "delivery_proof",
    factCategory: "delivery_proof",
    validity: "valid",
    citation: "eligible",
    ...over,
  };
}

function derive(candidates: PlanCandidate[], reviewItems: MerchantReviewItem[] = []) {
  return deriveCaseArgumentPlan({
    caseId: "case-1",
    reasonModuleId: MODULE.key,
    reasonModule: MODULE,
    candidates,
    reviewItems,
    freshness: FRESHNESS,
  });
}

describe("deriveCaseArgumentPlan — inclusion", () => {
  it("includes a valid, citable, argument-relevant record", () => {
    const plan = derive([candidate()]);
    expect(plan.included).toEqual([
      { recordId: "delivery_proof#0", fieldKey: "delivery_proof", factCategory: "delivery_proof" },
    ]);
    expect(plan.excluded).toEqual([]);
    expect(plan.noSafeArgument).toBeNull();
    expect(plan.deadlineOnly).toBe(false);
    expect(planHasSafeArgument(plan)).toBe(true);
  });

  it("pins the reason module that supplied the allow-list", () => {
    expect(derive([candidate()]).reasonModuleId).toBe("visa_10_4_fraud");
  });

  it("carries the freshness snapshot through untouched", () => {
    expect(derive([candidate()]).freshness).toEqual(FRESHNESS);
  });
});

describe("deriveCaseArgumentPlan — exclusion classes", () => {
  const cases: Array<[string, Partial<PlanCandidate>, string]> = [
    ["structurally never bank-facing", { citation: "withheld_internal" }, "merchant_only"],
    ["citing it would hand the issuer an argument", { citation: "withheld_risk" }, "adverse"],
    ["we could not establish it", { validity: "unverifiable" }, "unverified"],
    ["understood but proves nothing", { validity: "invalid" }, "unverified"],
    ["sound but nothing worth citing", { citation: "ineligible" }, "unverified"],
  ];

  for (const [label, over, reason] of cases) {
    it(`excludes a record that is ${label} as ${reason}`, () => {
      const plan = derive([candidate(over)]);
      expect(plan.included).toEqual([]);
      expect(plan.excluded).toHaveLength(1);
      expect(plan.excluded[0]?.reason).toBe(reason);
    });
  }

  it("excludes a category the reason module does not allow", () => {
    // `device_session` is on visa_10_4_fraud's avoid list and absent from its
    // allow-list. Argument relevance is CONSUMED here, never replaced.
    const plan = derive([
      candidate({ recordId: "device#0", fieldKey: "device_session_consistency", factCategory: "device_session" }),
    ]);
    expect(plan.excluded[0]?.reason).toBe("not_argument_relevant");
  });

  it("admits a category the label would suppress when it is always-admissible", () => {
    const plan = deriveCaseArgumentPlan({
      caseId: "case-1",
      reasonModuleId: "product_unacceptable",
      reasonModule: resolveReasonCodeModule("13.3"),
      candidates: [
        candidate({
          recordId: "tds#0",
          fieldKey: "tds_authentication",
          factCategory: "payment_authentication",
        }),
      ],
      alwaysAdmissibleCategories: ["payment_authentication"],
      freshness: FRESHNESS,
    });
    expect(plan.included.map((i) => i.recordId)).toEqual(["tds#0"]);
  });

  it("reports the strongest reason, not the weakest: adverse beats irrelevant", () => {
    const plan = derive([
      candidate({
        recordId: "device#0",
        fieldKey: "device_session_consistency",
        factCategory: "device_session",
        citation: "withheld_risk",
      }),
    ]);
    expect(plan.excluded[0]?.reason).toBe("adverse");
  });

  it("gives every exclusion a merchant-facing token and no English", () => {
    const plan = derive([
      candidate({ recordId: "a", citation: "withheld_internal" }),
      candidate({ recordId: "b", citation: "withheld_risk" }),
      candidate({ recordId: "c", validity: "invalid" }),
    ]);
    for (const excluded of plan.excluded) {
      expect(excluded.merchantReasonToken).toBeTruthy();
      expect(Object.values(EXCLUSION_REASON_TOKENS)).toContain(excluded.merchantReasonToken);
      // A key path, never a sentence.
      expect(excluded.merchantReasonToken).toMatch(/^packs\.argumentPlan\.exclusion\.[a-zA-Z]+$/);
    }
  });
});

describe("deriveCaseArgumentPlan — review_required and deadlineOnly", () => {
  const reviewItem: MerchantReviewItem = {
    recordId: "tds#0",
    fieldKey: "tds_authentication",
    reasonToken: { key: "disputes.review.confirmThreeDs" },
    blocksNormalFiling: true,
  };

  it("excludes the reviewed record and makes the plan deadline_only", () => {
    const plan = derive(
      [
        candidate(),
        candidate({
          recordId: "tds#0",
          fieldKey: "tds_authentication",
          factCategory: "payment_authentication",
        }),
      ],
      [reviewItem],
    );
    expect(includedRecordIds(plan)).toEqual(new Set(["delivery_proof#0"]));
    expect(excludedRecordIds(plan)).toEqual(new Set(["tds#0"]));
    expect(plan.excluded[0]?.reason).toBe("review_required");
    expect(plan.deadlineOnly).toBe(true);
    // A safe argument still exists — the deadline trigger may take it.
    expect(plan.noSafeArgument).toBeNull();
  });

  it("shows the merchant the reason they were actually given, not the generic one", () => {
    const plan = derive([candidate({ recordId: "tds#0" })], [
      { ...reviewItem, recordId: "tds#0" },
    ]);
    expect(plan.excluded[0]?.merchantReasonToken).toBe("disputes.review.confirmThreeDs");
  });

  it("matches a review item by recordId, never by fieldKey — multi-record fields", () => {
    const plan = derive(
      [
        candidate({ recordId: "delivery_proof#parcel-a" }),
        candidate({ recordId: "delivery_proof#parcel-b" }),
      ],
      [{ ...reviewItem, recordId: "delivery_proof#parcel-a", fieldKey: "delivery_proof" }],
    );
    expect(includedRecordIds(plan)).toEqual(new Set(["delivery_proof#parcel-b"]));
  });

  it("a plan with no review item is NOT deadline_only", () => {
    expect(derive([candidate(), candidate({ recordId: "x", citation: "withheld_risk" })]).deadlineOnly).toBe(
      false,
    );
  });
});

describe("deriveCaseArgumentPlan — noSafeArgument", () => {
  it("all_support_excluded when everything non-critical was removed", () => {
    // `delivery_proof` is allowed and prioritised but NOT a critical category
    // for visa_10_4_fraud, so its loss is not the theory's own support going.
    const plan = derive([candidate({ citation: "withheld_risk" })]);
    expect(plan.noSafeArgument).toBe("all_support_excluded");
    expect(planHasSafeArgument(plan)).toBe(false);
  });

  it("no_primary_argument when the theory's own support was removed", () => {
    // `payment_authentication` is one of visa_10_4_fraud's criticalCategories.
    const plan = derive([
      candidate({
        recordId: "avs#0",
        fieldKey: "avs_cvv_match",
        factCategory: "payment_authentication",
        citation: "withheld_risk",
      }),
    ]);
    expect(plan.noSafeArgument).toBe("no_primary_argument");
  });

  it("no_rebuttal_argument when nothing was ever collected", () => {
    expect(derive([]).noSafeArgument).toBe("no_rebuttal_argument");
  });

  it("removing the review_required fact can leave no safe argument at all", () => {
    const plan = derive([candidate()], [
      {
        recordId: "delivery_proof#0",
        fieldKey: "delivery_proof",
        reasonToken: { key: "disputes.review.confirmDelivery" },
        blocksNormalFiling: true,
      },
    ]);
    expect(plan.included).toEqual([]);
    expect(plan.noSafeArgument).toBe("all_support_excluded");
    expect(plan.deadlineOnly).toBe(true);
  });
});

describe("determinism and the plan input hash", () => {
  it("the derivation is pure — same inputs, identical plan", () => {
    const input = [candidate(), candidate({ recordId: "b", citation: "withheld_risk" })];
    expect(derive(input)).toEqual(derive(input));
  });

  it("candidate ORDER does not move the hash — it is not positional", () => {
    const a = candidate({ recordId: "a" });
    const b = candidate({ recordId: "b" });
    const parts = {
      reasonModuleId: MODULE.key,
      allowedFactCategories: MODULE.allowedFactCategories,
      criticalCategories: MODULE.criticalCategories,
    };
    expect(computePlanInputHash({ ...parts, candidates: [a, b] })).toBe(
      computePlanInputHash({ ...parts, candidates: [b, a] }),
    );
  });

  it("a changed candidate DOES move the hash", () => {
    const parts = {
      reasonModuleId: MODULE.key,
      allowedFactCategories: MODULE.allowedFactCategories,
      criticalCategories: MODULE.criticalCategories,
    };
    expect(computePlanInputHash({ ...parts, candidates: [candidate()] })).not.toBe(
      computePlanInputHash({ ...parts, candidates: [candidate({ validity: "invalid" })] }),
    );
  });

  it("a changed review item moves the hash — it changes which trigger may file", () => {
    const parts = {
      reasonModuleId: MODULE.key,
      allowedFactCategories: MODULE.allowedFactCategories,
      criticalCategories: MODULE.criticalCategories,
      candidates: [candidate()],
    };
    expect(computePlanInputHash(parts)).not.toBe(
      computePlanInputHash({
        ...parts,
        reviewItems: [
          {
            recordId: "delivery_proof#0",
            fieldKey: "delivery_proof",
            reasonToken: { key: "t" },
            blocksNormalFiling: true,
          },
        ],
      }),
    );
  });

  it("a changed allow-list moves the hash — the module is a result-bearing input", () => {
    const parts = {
      reasonModuleId: MODULE.key,
      criticalCategories: MODULE.criticalCategories,
      candidates: [candidate()],
    };
    expect(
      computePlanInputHash({ ...parts, allowedFactCategories: MODULE.allowedFactCategories }),
    ).not.toBe(computePlanInputHash({ ...parts, allowedFactCategories: ["order_record"] }));
  });
});
