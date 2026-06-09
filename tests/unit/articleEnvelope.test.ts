import { describe, it, expect } from "vitest";
import { parseArticleEnvelope } from "@/lib/resources/generation/articleEnvelope";

const META = `{"title":"Visa VAMP Explained","excerpt":"What changed.","slug":"visa-vamp","meta_title":"Visa VAMP","meta_description":"desc","keyTakeaways":["a","b"],"faq":[{"q":"Q?","a":"A."}],"disclaimer":"For info only."}`;

describe("parseArticleEnvelope", () => {
  it("parses a well-formed envelope (body HTML outside the JSON)", () => {
    const raw = `<meta>\n${META}\n</meta>\n<article>\n<h2>Heading</h2><p>Body with "quotes" that would have broken JSON.</p>\n</article>`;
    const p = parseArticleEnvelope(raw);
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Visa VAMP Explained");
    expect(p!.slug).toBe("visa-vamp");
    expect(p!.body_json.mainHtml).toContain('<p>Body with "quotes" that would have broken JSON.</p>');
    expect(p!.body_json.keyTakeaways).toEqual(["a", "b"]);
    expect(p!.body_json.faq).toEqual([{ q: "Q?", a: "A." }]);
  });

  it("in-HTML double quotes do not break parsing (the whole point)", () => {
    const raw = `<meta>${META}</meta><article><p>The issuer said "insufficient evidence" and lost it.</p></article>`;
    const p = parseArticleEnvelope(raw);
    expect(p).not.toBeNull();
    expect(p!.body_json.mainHtml).toContain('"insufficient evidence"');
  });

  it("salvages a truncated/unclosed <article> (no closing tag)", () => {
    const raw = `<meta>${META}</meta><article><h2>One</h2><p>Complete sentence.</p><p>Cut off mid`;
    const p = parseArticleEnvelope(raw);
    expect(p).not.toBeNull();
    expect(p!.body_json.mainHtml).toContain("Complete sentence.");
  });

  it("strips code fences around the meta JSON", () => {
    const raw = "<meta>\n```json\n" + META + "\n```\n</meta><article><p>Body.</p></article>";
    const p = parseArticleEnvelope(raw);
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Visa VAMP Explained");
  });

  it("returns null when meta JSON is unparseable", () => {
    const raw = `<meta>{not valid json</meta><article><p>Body.</p></article>`;
    expect(parseArticleEnvelope(raw)).toBeNull();
  });

  it("returns null when the body is missing", () => {
    expect(parseArticleEnvelope(`<meta>${META}</meta>`)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseArticleEnvelope("")).toBeNull();
    expect(parseArticleEnvelope(null)).toBeNull();
  });
});
