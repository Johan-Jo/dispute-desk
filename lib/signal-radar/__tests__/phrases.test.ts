import { describe, it, expect } from "vitest";
import { extractPhrases } from "@/lib/signal-radar/cluster";

describe("extractPhrases", () => {
  it("returns counts and respects the limit", () => {
    const items = [
      { title: "rolling reserve", content: "shopify froze our payouts" },
      { title: "rolling reserve fear", content: "another rolling reserve thread" },
      { title: "support failure", content: "rolling reserve" },
    ];
    const phrases = extractPhrases(items, 5);
    expect(phrases.length).toBeLessThanOrEqual(5);
    const rr = phrases.find((p) => p.phrase === "rolling reserve");
    expect(rr).toBeDefined();
    expect(rr!.count).toBeGreaterThanOrEqual(3);
  });

  it("filters stopwords and short tokens", () => {
    const phrases = extractPhrases([
      { title: "the and of for", content: "is a in to with" },
    ]);
    expect(phrases.length).toBe(0);
  });

  it("boosts curated Shopify phrases over generic tokens", () => {
    const items = [
      {
        title: "What to do about reserves",
        content: "rolling reserve has been brutal lately for our shop",
      },
    ];
    const phrases = extractPhrases(items, 25);
    const rr = phrases.find((p) => p.phrase === "rolling reserve")!;
    const generic = phrases.find((p) => p.phrase === "brutal");
    expect(rr).toBeDefined();
    if (generic) expect(rr.count).toBeGreaterThan(generic.count);
  });

  it("returns empty array for empty input", () => {
    expect(extractPhrases([])).toEqual([]);
  });

  it("caps results at the limit", () => {
    const items: Array<{ title: string | null; content: string }> = [];
    for (let i = 0; i < 30; i++) {
      items.push({ title: `keyword${i} pattern${i}`, content: `payment${i} issue${i}` });
    }
    const phrases = extractPhrases(items, 25);
    expect(phrases.length).toBeLessThanOrEqual(25);
  });
});
