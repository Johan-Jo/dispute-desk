/**
 * Tests for the reason-code catalog — invariants only. Catalog content
 * itself is reviewed via PR; tests guard the structural rules so a typo
 * in the source can't ship.
 */

import { describe, it, expect } from "vitest";
import {
  REASON_CODE_CATALOG,
  getReasonCode,
  getReasonCodesByFamily,
  isCE30AnchorCode,
  isFPTEligibleCode,
} from "@/lib/disputes/reasonCodeCatalog";

describe("reasonCodeCatalog invariants", () => {
  it("contains the CE 3.0 anchor (Visa 10.4)", () => {
    const entry = getReasonCode("visa", "10.4");
    expect(entry).not.toBeNull();
    expect(entry?.family).toBe("ce30_eligible");
  });

  it("contains both Mastercard FPT-eligible codes", () => {
    const fpt = getReasonCodesByFamily("fpt_eligible");
    const codes = fpt.map((e) => e.code).sort();
    expect(codes).toEqual(["4837", "4863"]);
  });

  it("isCE30AnchorCode is only true for visa 10.4", () => {
    expect(isCE30AnchorCode("visa", "10.4")).toBe(true);
    expect(isCE30AnchorCode("visa", "10.3")).toBe(false);
    expect(isCE30AnchorCode("mastercard", "10.4")).toBe(false);
  });

  it("isFPTEligibleCode is only true for mastercard 4837 / 4863", () => {
    expect(isFPTEligibleCode("mastercard", "4837")).toBe(true);
    expect(isFPTEligibleCode("mastercard", "4863")).toBe(true);
    expect(isFPTEligibleCode("mastercard", "4853")).toBe(false);
    expect(isFPTEligibleCode("visa", "10.4")).toBe(false);
  });

  it("no duplicate (network, code) pairs", () => {
    const seen = new Set<string>();
    for (const entry of REASON_CODE_CATALOG) {
      const key = `${entry.network}:${entry.code}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("every entry has a non-empty i18nKey and rebuttalTemplateKey", () => {
    for (const entry of REASON_CODE_CATALOG) {
      expect(entry.i18nKey.length).toBeGreaterThan(0);
      expect(entry.rebuttalTemplateKey.length).toBeGreaterThan(0);
      expect(entry.evidenceChecklistKey.length).toBeGreaterThan(0);
    }
  });

  it("Visa codes match X.Y format; Mastercard codes match 4-digit format", () => {
    for (const entry of REASON_CODE_CATALOG) {
      if (entry.network === "visa") {
        expect(entry.code).toMatch(/^\d{2}\.\d{1,2}$/);
      } else if (entry.network === "mastercard") {
        expect(entry.code).toMatch(/^\d{4}$/);
      }
    }
  });

  it("getReasonCode returns null for unknown codes", () => {
    expect(getReasonCode("visa", "99.9")).toBeNull();
    expect(getReasonCode("mastercard", "9999")).toBeNull();
  });
});
