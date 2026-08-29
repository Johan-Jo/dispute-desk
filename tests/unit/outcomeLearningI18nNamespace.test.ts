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
});
