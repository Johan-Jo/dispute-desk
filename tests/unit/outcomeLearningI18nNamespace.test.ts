import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overview = readFileSync(
  "app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx",
  "utf8",
);

describe("outcome learning i18n namespace", () => {
  it("resolves panel copy through the root disputes namespace", () => {
    for (const key of ["title", "caveat", "fraudRecommendation"]) {
      expect(overview).toContain(
        `tRoot("disputes.outcomeExplanation.learning.${key}")`,
      );
      expect(overview).not.toContain(
        `tRoot("outcomeExplanation.learning.${key}")`,
      );
    }
  });

  it("keeps factor detail in the panel instead of repeating it in the hero", () => {
    expect(overview).toContain('explanation.kind === "we_defended_with_facts"');
    expect(overview).toContain('kind: "we_defended_no_facts"');
    expect(overview).toContain("The learning panel below owns the factor explanation");
  });
});
