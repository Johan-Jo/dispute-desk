import { describe, it, expect } from "vitest";
import {
  categoryLabel,
  isHiddenCategory,
  HIDDEN_CATEGORIES,
} from "@/lib/signal-radar/category-labels";
import { SIGNAL_CATEGORIES } from "@/lib/signal-radar/schema";

describe("categoryLabel", () => {
  it("returns a plain-English label for every classifier category", () => {
    for (const c of SIGNAL_CATEGORIES) {
      const label = categoryLabel(c);
      expect(label).toBeTruthy();
      // Labels should not be the raw enum (they're meant to be human-readable).
      // Allowed exception: when the enum is already a plain English word like "spam".
      if (c !== "spam" && c !== "trolling") {
        expect(label).not.toBe(c);
      }
    }
  });

  it("falls back to the raw category string for unknown categories", () => {
    expect(categoryLabel("never_seen_before")).toBe("never_seen_before");
  });
});

describe("isHiddenCategory", () => {
  it("hides spam and trolling", () => {
    expect(isHiddenCategory("spam")).toBe(true);
    expect(isHiddenCategory("trolling")).toBe(true);
    expect(HIDDEN_CATEGORIES).toContain("spam");
    expect(HIDDEN_CATEGORIES).toContain("trolling");
  });

  it("does not hide pain categories", () => {
    expect(isHiddenCategory("migration_intent")).toBe(false);
    expect(isHiddenCategory("transparency_frustration")).toBe(false);
    expect(isHiddenCategory("reserve_fear")).toBe(false);
    expect(isHiddenCategory("competitor_frustration")).toBe(false);
    expect(isHiddenCategory("evidence_confusion")).toBe(false);
    expect(isHiddenCategory("operational_overload")).toBe(false);
    expect(isHiddenCategory("support_failure")).toBe(false);
    expect(isHiddenCategory("general_discussion")).toBe(false);
  });
});
