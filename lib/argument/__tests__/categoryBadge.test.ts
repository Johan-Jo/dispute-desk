/**
 * categoryBadge tests — the only allowed translator from
 * `EvidenceCategory` to a UI label + tone for the dispute-detail
 * surface. Plan v3 §P2.7.
 */

import { describe, expect, it } from "vitest";
import { categoryBadge } from "../categoryBadge";

describe("categoryBadge", () => {
  it("strong → 'Strong' / success", () => {
    const b = categoryBadge("strong");
    expect(b.label).toBe("Strong");
    expect(b.tone).toBe("success");
  });

  it("moderate → 'Moderate' / warning", () => {
    const b = categoryBadge("moderate");
    expect(b.label).toBe("Moderate");
    expect(b.tone).toBe("warning");
  });

  it("supporting → 'Supporting' / neutral (undefined Polaris tone)", () => {
    const b = categoryBadge("supporting");
    expect(b.label).toBe("Supporting");
    expect(b.tone).toBeUndefined();
  });

  it("invalid → 'Invalid' / critical (regression: must NOT collapse to 'Supporting')", () => {
    const b = categoryBadge("invalid");
    expect(b.label).toBe("Invalid");
    expect(b.tone).toBe("critical");
    // Hard-coded regression check for the prior bug where invalid was
    // silently mapped to the same label as supporting.
    expect(b.label).not.toBe("Supporting");
  });

  it("every category has bg + color hex pair for the inline-styled pill", () => {
    for (const cat of ["strong", "moderate", "supporting", "invalid"] as const) {
      const b = categoryBadge(cat);
      expect(b.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(b.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
