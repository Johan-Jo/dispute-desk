/**
 * The single source of truth for the writer (docs/plans/defence-letter-structure.plan.md
 * §2.1, §2.3; acceptance tests T1 and T2): the method lives once, in the
 * constitution, which names no dispute type, provider or stage outside its
 * examples; briefs carry data, never instructions.
 */
import { describe, expect, it } from "vitest";
import { WRITER_SYSTEM } from "../constitution";
import { GENERAL_BRIEF, ITEM_NOT_RECEIVED_BRIEF, NOT_AS_DESCRIBED_BRIEF, sectionApplies } from "../briefs";

const beforeExamples = WRITER_SYSTEM.slice(0, WRITER_SYSTEM.indexOf("EXAMPLES ("));

describe("T1 — the constitution names no dispute type, provider or stage outside its examples", () => {
  it.each([
    /not received|non-receipt/i,
    /not as described|defective/i,
    /\bfraud|unauthori[sz]ed/i,
    /\brefund not|credit not processed/i,
    /\bsubscription/i,
    /\bPayPal\b|\bKlarna\b|\bVisa\b|\bMastercard\b/,
    /\binquiry\b/i,
  ])("does not contain %s", (re) => {
    expect(beforeExamples).not.toMatch(re);
  });

  it("carries its examples from more than one dispute type", () => {
    const examples = WRITER_SYSTEM.slice(WRITER_SYSTEM.indexOf("EXAMPLES ("));
    expect(examples).toMatch(/not received/i);
    expect(examples).toMatch(/not as described/i);
  });
});

describe("T2 — briefs are data, never instructions", () => {
  const IMPERATIVE = /^(?:lead|say|open|write|use|state|argue|emphasi[sz]e|mention|start|begin|put|tell)\b/i;
  it.each([ITEM_NOT_RECEIVED_BRIEF, NOT_AS_DESCRIBED_BRIEF, GENERAL_BRIEF])("$type", (brief) => {
    for (const s of brief.sections) {
      expect(s.question.split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(s.question).not.toMatch(IMPERATIVE);
      expect(s.title.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
    for (const t of brief.theories) expect(Object.keys(t).sort()).toEqual(["claimIds", "name"]);
    // Limits only forbid.
    for (const l of brief.limits) expect(l.rule).toMatch(/^No\b/);
  });
});

describe("a section needs its lead claim (#93254)", () => {
  const policy = NOT_AS_DESCRIBED_BRIEF.sections.find((s) => s.key === "policy")!;
  const shipping = NOT_AS_DESCRIBED_BRIEF.sections.find((s) => s.key === "shipping")!;
  it("no Return Route section when the return window has closed", () => {
    expect(sectionApplies(policy, new Set(["no_return_recorded", "carrier_delivered"]))).toBe(false);
    expect(sectionApplies(shipping, new Set(["no_return_recorded", "carrier_delivered"]))).toBe(true);
  });
  it("the Return Route section when the route is open", () => {
    expect(sectionApplies(policy, new Set(["return_route_open", "no_return_recorded"]))).toBe(true);
  });
});
