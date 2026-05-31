import { describe, it, expect } from "vitest";
import { shouldHoldForIncompleteLocales } from "@/lib/resources/generation/localeCompleteness";

describe("shouldHoldForIncompleteLocales", () => {
  it("holds when no locales were produced", () => {
    expect(shouldHoldForIncompleteLocales([])).toBe(true);
  });

  it("holds when any locale was rejected (content === null)", () => {
    const results = [
      { content: { title: "en" } },
      { content: null },
      { content: { title: "fr" } },
    ];
    expect(shouldHoldForIncompleteLocales(results)).toBe(true);
  });

  it("does not hold when every locale produced content", () => {
    const results = [
      { content: { title: "en" } },
      { content: { title: "de" } },
      { content: { title: "fr" } },
      { content: { title: "es" } },
      { content: { title: "pt" } },
      { content: { title: "sv" } },
    ];
    expect(shouldHoldForIncompleteLocales(results)).toBe(false);
  });
});
