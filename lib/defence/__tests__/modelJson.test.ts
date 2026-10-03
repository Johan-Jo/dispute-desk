import { describe, expect, it } from "vitest";
import { parseJson } from "../modelJson";

describe("parseJson (lib/defence/modelJson)", () => {
  it("parses a clean reply and ignores trailing commentary", () => {
    expect(parseJson<{ a: number }>('Here:\n{"a": 1}\nThanks {"b": 2}')).toEqual({ a: 1 });
  });

  it("keeps escaped quotes and braces inside strings", () => {
    expect(parseJson<{ s: string }>('{"s": "a \\"b\\" {c}"}')).toEqual({ s: 'a "b" {c}' });
  });

  /* Mein Maison #100806, 2026-10-02: the writer quoted a product name without
   * escaping it, and the whole letter was lost to `Expected ',' or ']' after
   * array element`, twice in a row. */
  it("repairs an unescaped quoted phrase inside the writer's summary", () => {
    const raw = [
      "{",
      '  "summary": [',
      '    "The cardholder says the item was not as described. The order contained one "RideSafe – Sicher unterwegs bei jedem Wetter!" phone mount."',
      "  ],",
      '  "summaryClaimIds": ["c1"]',
      "}",
    ].join("\n");
    const out = parseJson<{ summary: string[]; summaryClaimIds: string[] }>(raw);
    expect(out.summary[0]).toContain('one "RideSafe – Sicher unterwegs bei jedem Wetter!" phone mount.');
    expect(out.summaryClaimIds).toEqual(["c1"]);
  });

  it("repairs a stray quote that would otherwise unbalance the braces", () => {
    const raw = '{"errors": [{"sentence": "a 5" mount {x}", "problem": "p"}]}';
    expect(parseJson<{ errors: Array<{ sentence: string }> }>(raw).errors[0].sentence).toBe('a 5" mount {x}');
  });

  /* Mein Maison #100806, third failure (2026-10-03): the model escaped the
   * opening quote and not the closing one, and a comma followed it. */
  it("repairs a stray quote that is followed by a prose comma", () => {
    const raw = [
      "{",
      '  "summary": [',
      '    "The order was for one item, described as \\"RideSafe – Safe on the road in any weather!", and the fulfilment record shows that exact item.",',
      '    "Second paragraph."',
      "  ],",
      '  "summaryClaimIds": ["c1", "c2"]',
      "}",
    ].join("\n");
    const out = parseJson<{ summary: string[]; summaryClaimIds: string[] }>(raw);
    expect(out.summary).toHaveLength(2);
    expect(out.summary[0]).toContain('weather!", and the fulfilment record');
    expect(out.summaryClaimIds).toEqual(["c1", "c2"]);
  });

  it("names the text it failed on when repair cannot help", () => {
    expect(() => parseJson('{"a": 1 "b": 2}')).toThrow(/near: /);
  });
});

describe("callers share the repair", () => {
  it("extractReturnWindow keeps a window whose source sentence carries quotes", async () => {
    const { extractReturnWindow } = await import("../counsel/policyTerms");
    const policy = 'Du kannst Artikel innerhalb von 30 Tagen nach Erhalt der Ware zurückgeben ("Widerrufsfrist").';
    const reply = `{"returnsOffered": true, "windowDays": 30, "windowStartsAt": "delivery", "sourceSentence": "${policy}"}`;
    const out = await extractReturnWindow(policy, async () => reply);
    expect(out?.windowDays).toBe(30);
  });
});
