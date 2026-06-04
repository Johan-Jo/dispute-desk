import { describe, expect, it } from "vitest";
import {
  visibleHubSections,
  type HubSection,
} from "@/components/resources/HubSectionNav";

/**
 * Pins the "never link to an empty hub" rule. Empty hubs (glossary,
 * case-studies with zero published rows) `notFound()` at the index URL, so a
 * live nav link pointing at them is what Ahrefs flags as "Links to 4XX pages".
 * The nav must omit any section not in `present` — except the active one.
 */
describe("visibleHubSections", () => {
  it("renders all sections when present is undefined (legacy)", () => {
    expect(visibleHubSections("resources", undefined)).toEqual([
      "resources",
      "templates",
      "case-studies",
      "glossary",
    ]);
  });

  it("omits hubs with no published content", () => {
    // Only resources + templates have content (current prod state: glossary
    // and case-studies are empty).
    const present = new Set<HubSection>(["resources", "templates"]);
    expect(visibleHubSections("templates", present)).toEqual([
      "resources",
      "templates",
    ]);
    expect(visibleHubSections("templates", present)).not.toContain("glossary");
    expect(visibleHubSections("templates", present)).not.toContain(
      "case-studies",
    );
  });

  it("always renders the active section even if absent from present", () => {
    const present = new Set<HubSection>(["resources"]);
    expect(visibleHubSections("glossary", present)).toContain("glossary");
  });

  it("renders only the active section when present is empty", () => {
    expect(visibleHubSections("case-studies", new Set())).toEqual([
      "case-studies",
    ]);
  });
});
