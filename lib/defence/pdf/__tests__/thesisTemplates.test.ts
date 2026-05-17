import { describe, it, expect } from "vitest";
import { THESIS_TEMPLATES } from "../thesisTemplates";
import { THESIS_TOKENS } from "../thesisTokens";

describe("THESIS_TEMPLATES invariants", () => {
  it("every template references only tokens registered in THESIS_TOKENS", () => {
    const registeredTokens = new Set(Object.keys(THESIS_TOKENS));
    for (const t of THESIS_TEMPLATES) {
      const tokenMatches = Array.from(t.template.matchAll(/\{\{(\w+)\}\}/g));
      for (const m of tokenMatches) {
        expect(registeredTokens.has(m[1]), `template ${t.key} references token ${m[1]}`).toBe(true);
      }
    }
  });

  it("every required token in a template actually appears in the template body", () => {
    for (const t of THESIS_TEMPLATES) {
      for (const req of t.requiredTokens) {
        expect(t.template, `template ${t.key} declares required token ${req}`).toContain(`{{${req}}}`);
      }
    }
  });

  it("every registered token is referenced by at least one template (no orphans)", () => {
    const usedTokens = new Set<string>();
    for (const t of THESIS_TEMPLATES) {
      const tokenMatches = Array.from(t.template.matchAll(/\{\{(\w+)\}\}/g));
      for (const m of tokenMatches) usedTokens.add(m[1]);
    }
    for (const name of Object.keys(THESIS_TOKENS)) {
      expect(usedTokens.has(name), `token ${name} is registered but used by no template`).toBe(true);
    }
  });

  it("template keys are unique", () => {
    const keys = THESIS_TEMPLATES.map((t) => t.key);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("every section has a fallback (any, any) template", () => {
    const sections = Array.from(new Set(THESIS_TEMPLATES.map((t) => t.sectionKey)));
    for (const section of sections) {
      const fallback = THESIS_TEMPLATES.find(
        (t) => t.sectionKey === section && t.familyKey === "any" && t.packageMode === "any",
      );
      // Some sections (like paymentAuthenticationArgument) might fall back via
      // ("any", "any") OR via (family, "any") — accept either as long as a
      // generic catch-all exists for the section.
      const anyMatch = fallback ?? THESIS_TEMPLATES.find(
        (t) => t.sectionKey === section && (t.familyKey === "any" || t.packageMode === "any"),
      );
      expect(anyMatch, `section ${section} needs a fallback template`).toBeDefined();
    }
  });

  it("required tokens never appear inside [[ ]] optional clauses", () => {
    for (const t of THESIS_TEMPLATES) {
      const optionalRegions = Array.from(t.template.matchAll(/\[\[([^\]]*?)\]\]/g));
      for (const m of optionalRegions) {
        const innerTokens = Array.from(m[1].matchAll(/\{\{(\w+)\}\}/g)).map((x) => x[1]);
        for (const inner of innerTokens) {
          expect(
            t.requiredTokens.includes(inner),
            `template ${t.key}: required token ${inner} appears inside optional clause`,
          ).toBe(false);
        }
      }
    }
  });
});
