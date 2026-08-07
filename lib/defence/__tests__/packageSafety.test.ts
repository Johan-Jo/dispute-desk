/**
 * PR-C1 — the central package-candidate safety predicate.
 *
 * Every save / forward / deadline path consults this. The properties that
 * matter operationally are the candidate-based ones: a historical unsafe
 * version stays blocked, a regenerated safe version is usable, and the
 * presence of an old unsafe version never permanently blocks a dispute.
 */

import { describe, expect, it } from "vitest";
import {
  assessPackageCandidateSafety,
  narrativeTexts,
  packageBlockSummary,
} from "../packageSafety";

const CLEAN_NARRATIVE = {
  executiveSummary: {
    text: "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
  },
  fulfillmentArgument: { text: "The carrier recorded a signature on delivery." },
};

const UNSAFE_NARRATIVE = {
  fulfillmentArgument: {
    text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
  },
};

const AMBIGUOUS_NARRATIVE = {
  fulfillmentArgument: { text: "Delivery to the customer's address." },
};

const CLEAN_FACTS = [
  {
    id: "f1",
    category: "delivery_proof",
    value: { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "1" },
  },
];

const RETIRED_FACTS = [
  {
    id: "f1",
    category: "delivery_proof",
    value: { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true },
  },
];

describe("assessPackageCandidateSafety", () => {
  it("a clean candidate is safe", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(packageBlockSummary(v)).toBe("");
  });

  it("blocks on a retired delivery fact even when the narrative is clean", () => {
    const v = assessPackageCandidateSafety({
      factsJson: RETIRED_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("retired_delivery_fact");
    expect(v.retiredKeys).toContain("deliveredToVerifiedAddress");
  });

  it("blocks on collectedByCustomer too", () => {
    const v = assessPackageCandidateSafety({
      factsJson: [{ id: "f1", category: "shipping_tracking", value: { collectedByCustomer: true } }],
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.retiredKeys).toContain("collectedByCustomer");
  });

  it("blocks on an affirmative address assertion even when facts are clean", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: UNSAFE_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("affirmative_address_delivery_claim");
  });

  it("blocks on ambiguous address language — fails closed", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: AMBIGUOUS_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("ambiguous_address_delivery_claim");
  });

  it("does NOT block on negated / prohibition language", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: {
        fulfillmentArgument: {
          text: "We do not claim the parcel was delivered to the cardholder's address.",
        },
      },
    });
    expect(v.safe).toBe(true);
  });

  it("tolerates missing / unreadable persisted shapes without throwing", () => {
    for (const factsJson of [null, undefined, {}, 42, "nope", { approved: null }]) {
      for (const narrativeJson of [null, undefined, {}, 7]) {
        expect(() =>
          assessPackageCandidateSafety({ factsJson, narrativeJson }),
        ).not.toThrow();
      }
    }
    expect(assessPackageCandidateSafety({ factsJson: null, narrativeJson: null }).safe).toBe(true);
  });

  it("reads both the bare-array and wrapped facts_json shapes", () => {
    for (const factsJson of [
      RETIRED_FACTS,
      { approved: RETIRED_FACTS },
      { facts: RETIRED_FACTS },
      { approvedFacts: RETIRED_FACTS },
    ]) {
      expect(assessPackageCandidateSafety({ factsJson, narrativeJson: null }).safe).toBe(false);
    }
  });
});

describe("candidate-based blocking", () => {
  it("a regenerated safe version is usable even though an older unsafe version exists", () => {
    // Selectors read the LATEST version only; each candidate is judged alone.
    const older = assessPackageCandidateSafety({
      factsJson: RETIRED_FACTS,
      narrativeJson: UNSAFE_NARRATIVE,
    });
    const newer = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(older.safe).toBe(false);
    expect(newer.safe).toBe(true);
  });

  it("the verdict depends on nothing but the candidate's own persisted content", () => {
    const a = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: CLEAN_NARRATIVE });
    const b = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: CLEAN_NARRATIVE });
    expect(a).toEqual(b);
  });
});

describe("narrativeTexts", () => {
  it("reads both string sections and { text } sections", () => {
    expect(
      narrativeTexts({ a: "one", b: { text: "two" }, c: { nope: 1 }, d: 3 }).sort(),
    ).toEqual(["one", "two"]);
  });
});

describe("packageBlockSummary", () => {
  it("is merchant-safe: no gateway codes, no addresses, no bank framing", () => {
    const msg = packageBlockSummary(
      assessPackageCandidateSafety({ factsJson: RETIRED_FACTS, narrativeJson: UNSAFE_NARRATIVE }),
    );
    expect(msg).toContain("Regenerate");
    expect(msg).not.toMatch(/AVS|CVV|\bY\b|\bN\b/);
  });
});
