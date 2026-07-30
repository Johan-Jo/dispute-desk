import { describe, it, expect } from "vitest";
import {
  DISPUTE_TYPES,
  isDisputeType,
  normalizeDisputeType,
  type DisputeType,
} from "@/lib/rules/disputeTypes";
import { FAMILY_TO_DISPUTE_TYPE } from "@/lib/rules/helpers";
import {
  CATEGORY_KEYS,
  DISPUTE_TYPE_LABEL_KEYS,
} from "@/components/packs/TemplateLibraryContent";

/**
 * Regression guard for the 2026-07-20 template-library install bug.
 *
 * The template library filters `pack_templates` with
 * `.eq("dispute_type", <category>)`. Three vocabularies had drifted apart
 * (UI `FRAUD`/`REFUND`, API `fraud`/`credit`, DB `FRAUDULENT`/
 * `CREDIT_NOT_PROCESSED`), so category-filtered queries returned zero rows
 * and the modal fell back to fake demo cards whose install always 500'd.
 *
 * These tests pin the single canonical vocabulary: every category value the
 * UI can send MUST be a real `dispute_type`, or the whole class of bug
 * returns silently. If you add a dispute family, add it here and to
 * `DISPUTE_TYPES` — do not weaken this test.
 */
describe("dispute-type vocabulary is canonical everywhere", () => {
  it("every non-empty CATEGORY_KEYS value is a valid dispute_type", () => {
    for (const cat of CATEGORY_KEYS) {
      if (cat.value === "") continue; // the "All" tab sends no filter
      expect(
        isDisputeType(cat.value),
        `CATEGORY_KEYS value "${cat.value}" is not a canonical dispute_type — ` +
          `it would filter out every row and surface uninstallable cards`
      ).toBe(true);
    }
  });

  it("every FAMILY_TO_DISPUTE_TYPE value is a valid dispute_type", () => {
    for (const [family, code] of Object.entries(FAMILY_TO_DISPUTE_TYPE)) {
      expect(
        isDisputeType(code),
        `FAMILY_TO_DISPUTE_TYPE["${family}"] = "${code}" is not a canonical dispute_type`
      ).toBe(true);
    }
  });

  it("every DISPUTE_TYPE_LABEL_KEYS key is a valid dispute_type", () => {
    for (const code of Object.keys(DISPUTE_TYPE_LABEL_KEYS)) {
      expect(
        isDisputeType(code),
        `DISPUTE_TYPE_LABEL_KEYS has stray key "${code}"`
      ).toBe(true);
    }
  });
});

describe("normalizeDisputeType", () => {
  it("passes canonical codes through unchanged", () => {
    for (const code of DISPUTE_TYPES) {
      expect(normalizeDisputeType(code)).toBe(code);
    }
  });

  it("maps legacy short UI aliases from old deep links to canonical codes", () => {
    const cases: Record<string, DisputeType> = {
      FRAUD: "FRAUDULENT",
      PNR: "PRODUCT_NOT_RECEIVED",
      NOT_AS_DESCRIBED: "PRODUCT_UNACCEPTABLE",
      SUBSCRIPTION: "SUBSCRIPTION_CANCELLED",
      REFUND: "CREDIT_NOT_PROCESSED",
    };
    for (const [alias, expected] of Object.entries(cases)) {
      expect(normalizeDisputeType(alias)).toBe(expected);
    }
  });

  it("is case-insensitive and maps Shopify reason synonyms", () => {
    expect(normalizeDisputeType("fraudulent")).toBe("FRAUDULENT");
    expect(normalizeDisputeType("UNRECOGNIZED")).toBe("FRAUDULENT");
  });

  it("returns undefined for unknown values so callers skip the filter", () => {
    expect(normalizeDisputeType("NONSENSE")).toBeUndefined();
    expect(normalizeDisputeType("")).toBeUndefined();
    expect(normalizeDisputeType(null)).toBeUndefined();
    expect(normalizeDisputeType(undefined)).toBeUndefined();
  });
});
