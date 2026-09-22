/**
 * Conformity evidence for the not-as-described family.
 *
 * `product_description` mapped to the `order_record` fact category until
 * 2026-09-01. Three consequences followed, and each is pinned below:
 *
 *   1. The listing-as-purchased — the one fact that answers "did what we
 *      supplied match what we promised?" — was indistinguishable from the
 *      order confirmation.
 *   2. `product_unacceptable.criticalCategories` named `order_record`, which
 *      the order confirmation satisfies on essentially every case, so the
 *      family's critical category could never fail and `derivePackageMode`
 *      never dropped the package to hedged framing.
 *   3. `delivery_proof` sat second in that module's `prioritize` list, putting
 *      possession above conformity in the one family where possession is not
 *      in dispute.
 *
 * Measured on prod the same day: 0 of 252 not-as-described disputes carried a
 * `product_description` item, and all 252 rendered as `full` packages.
 *
 * These assert the rendered ORDER and the critical category, not merely that
 * the right module was selected — the module was always right; its ranking was
 * not.
 */

import { describe, it, expect } from "vitest";

import { categoryForField, derivePackageMode } from "@/lib/defence/factClassifier";
import { ALL_REASON_CODE_MODULES } from "@/lib/defence/reasonCodes/registry";
import { product_unacceptable } from "@/lib/defence/reasonCodes/product_unacceptable";
import { inr_product_not_received } from "@/lib/defence/reasonCodes/inr_product_not_received";
import type { EvidenceFact, EvidenceFactCategory } from "@/lib/defence/types";

function fact(category: EvidenceFactCategory): EvidenceFact {
  return {
    id: `f-${category}`,
    category,
    label: category,
    value: {},
    source: "test",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  };
}

const NO_FATAL_LOSS = { triggered: false, reason: null };

describe("categoryForField — the product listing is its own category", () => {
  it("maps product_description to product_listing, not order_record", () => {
    expect(categoryForField("product_description", null)).toBe("product_listing");
  });

  it("keeps order_confirmation on order_record so the two are separable", () => {
    expect(categoryForField("order_confirmation", null)).toBe("order_record");
    expect(categoryForField("order_confirmation", null)).not.toBe(
      categoryForField("product_description", null),
    );
  });
});

describe("product_unacceptable — conformity leads, delivery does not", () => {
  const rank = (c: EvidenceFactCategory) => product_unacceptable.prioritize.indexOf(c);

  it("ranks the product listing first", () => {
    expect(product_unacceptable.prioritize[0]).toBe("product_listing");
  });

  it("ranks delivery below both conformity and the buyer's own complaint", () => {
    expect(rank("delivery_proof")).toBeGreaterThan(rank("product_listing"));
    expect(rank("delivery_proof")).toBeGreaterThan(rank("customer_communication"));
    expect(rank("shipping_tracking")).toBeGreaterThan(rank("product_listing"));
  });

  it("rests its theory on the listing rather than the order confirmation", () => {
    expect(product_unacceptable.criticalCategories).toEqual(["product_listing"]);
  });

  it("tells the writer in words that delivery is not conformity", () => {
    expect(product_unacceptable.promptBody).toContain("DELIVERY IS NOT CONFORMITY");
  });
});

describe("item-not-received keeps delivery decisive", () => {
  it("is unchanged: delivery remains the critical category", () => {
    expect(inr_product_not_received.criticalCategories).toEqual(["delivery_proof"]);
    expect(inr_product_not_received.prioritize[0]).toBe("delivery_proof");
  });
});

describe("category split must not narrow what may be cited", () => {
  // Splitting a category is a taxonomy change, not a policy change. Any module
  // that admitted a product listing yesterday (as `order_record`) must still
  // admit it today (as `product_listing`) — otherwise the split silently
  // removes evidence from arguments nobody meant to touch.
  it("every module admitting order_record also admits product_listing", () => {
    const offenders = ALL_REASON_CODE_MODULES.filter(
      (m) =>
        m.allowedFactCategories.includes("order_record") &&
        !m.allowedFactCategories.includes("product_listing"),
    ).map((m) => m.key);
    expect(offenders).toEqual([]);
  });
});

describe("derivePackageMode — a not-as-described package without a listing", () => {
  const base = {
    caseStrength: "moderate" as const,
    fatalLoss: NO_FATAL_LOSS,
    reasonCodeModule: product_unacceptable,
  };

  it("renders hedged when the only evidence is the order and a delivery scan", () => {
    // This is the shape of all 252 prod not-as-described disputes as of
    // 2026-09-01. It rendered `full` before this change.
    expect(
      derivePackageMode({
        ...base,
        approvedFacts: [fact("order_record"), fact("delivery_proof")],
      }),
    ).toBe("narrow");
  });

  it("renders firm once conformity evidence is actually present", () => {
    expect(
      derivePackageMode({
        ...base,
        approvedFacts: [fact("product_listing"), fact("customer_communication")],
      }),
    ).toBe("full");
  });
});
