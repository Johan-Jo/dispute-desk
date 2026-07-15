import { describe, it, expect } from "vitest";
import {
  normalizeDisputeReasonKey,
  resolveDisputeTypeLabel,
} from "@/lib/disputes/reasonLabel";

describe("normalizeDisputeReasonKey", () => {
  it("uppercases a lowercase REST reason", () => {
    expect(normalizeDisputeReasonKey("credit_not_processed")).toBe(
      "CREDIT_NOT_PROCESSED",
    );
  });

  it("leaves a canonical GraphQL enum untouched", () => {
    expect(normalizeDisputeReasonKey("CREDIT_NOT_PROCESSED")).toBe(
      "CREDIT_NOT_PROCESSED",
    );
  });

  it("collapses whitespace to underscores", () => {
    expect(normalizeDisputeReasonKey("product not received")).toBe(
      "PRODUCT_NOT_RECEIVED",
    );
  });

  it("maps null/empty to GENERAL", () => {
    expect(normalizeDisputeReasonKey(null)).toBe("GENERAL");
    expect(normalizeDisputeReasonKey(undefined)).toBe("GENERAL");
    expect(normalizeDisputeReasonKey("")).toBe("GENERAL");
  });
});

describe("resolveDisputeTypeLabel", () => {
  // Stand-in for a next-intl packs-scoped translator: returns the real label
  // for the uppercase key, echoes the key path back on a miss (the actual
  // next-intl default — it does NOT throw).
  const tPacks = (key: string): string => {
    const map: Record<string, string> = {
      "disputeTypeLabel.CREDIT_NOT_PROCESSED": "Refund / Credit Not Processed",
      "disputeTypeLabel.FRAUDULENT": "Fraud / Unauthorized",
    };
    return map[key] ?? `packs.${key}`;
  };

  it("resolves a lowercase REST reason to the localized label (the #12452 bug)", () => {
    expect(resolveDisputeTypeLabel(tPacks, "credit_not_processed")).toBe(
      "Refund / Credit Not Processed",
    );
  });

  it("resolves a canonical uppercase reason to the localized label", () => {
    expect(resolveDisputeTypeLabel(tPacks, "CREDIT_NOT_PROCESSED")).toBe(
      "Refund / Credit Not Processed",
    );
  });

  it("never leaks the raw i18n key on a miss — falls back to Title Case", () => {
    const out = resolveDisputeTypeLabel(tPacks, "some_unmapped_reason");
    expect(out).not.toContain("disputeTypeLabel.");
    expect(out).not.toContain("packs.");
    expect(out).toBe("Some Unmapped Reason");
  });

  it("handles null via the GENERAL fallback", () => {
    // GENERAL isn't in the stub map → title-cased fallback, still no key leak.
    const out = resolveDisputeTypeLabel(tPacks, null);
    expect(out).not.toContain("disputeTypeLabel.");
    expect(out).toBe("General");
  });
});
