import { describe, it, expect } from "vitest";
import { applyTermLock } from "@/lib/resources/generation/termLock";

function art(over: Record<string, unknown> = {}) {
  return {
    title: "t",
    excerpt: "e",
    slug: "s",
    meta_title: "mt",
    meta_description: "md",
    body_json: { mainHtml: "<p>x</p>", keyTakeaways: [], faq: [], disclaimer: "" },
    ...over,
  } as any;
}

describe("applyTermLock — sv-SE chargeback", () => {
  it("replaces återbetalningskrav with chargeback, preserving case", () => {
    const a = art({ body_json: { mainHtml: "<p>Ett återbetalningskrav är dyrt. Återbetalningskrav igen.</p>", keyTakeaways: [], faq: [], disclaimer: "" } });
    const r = applyTermLock(a, "sv-SE");
    expect(r.changed).toBe(true);
    expect(a.body_json.mainHtml).toBe("<p>Ett chargeback är dyrt. Chargeback igen.</p>");
  });

  it("keeps compound/inflection tails (stem-only match)", () => {
    const a = art({ body_json: { mainHtml: "<p>återbetalningskravsfrekvens och återbetalningskravet</p>", keyTakeaways: [], faq: [], disclaimer: "" } });
    applyTermLock(a, "sv-SE");
    expect(a.body_json.mainHtml).toBe("<p>chargebacksfrekvens och chargebacket</p>");
  });

  it("fixes the slug (ASCII form)", () => {
    const a = art({ slug: "aterbetalningskrav-representment-spelbok" });
    applyTermLock(a, "sv-SE");
    expect(a.slug).toBe("chargeback-representment-spelbok");
  });

  it("fixes title, excerpt, meta, faq, keyTakeaways", () => {
    const a = art({
      title: "Återbetalningskrav guide",
      excerpt: "om återbetalningskrav",
      meta_title: "Återbetalningskrav",
      body_json: { mainHtml: "<p>ok</p>", keyTakeaways: ["hantera återbetalningskrav"], faq: [{ q: "Vad är återbetalningskrav?", a: "Ett återbetalningskrav." }], disclaimer: "" },
    });
    applyTermLock(a, "sv-SE");
    expect(a.title).toBe("Chargeback guide");
    expect(a.excerpt).toBe("om chargeback");
    expect(a.meta_title).toBe("Chargeback");
    expect(a.body_json.keyTakeaways[0]).toBe("hantera chargeback");
    expect(a.body_json.faq[0].q).toBe("Vad är chargeback?");
    expect(a.body_json.faq[0].a).toBe("Ett chargeback.");
  });

  it("is a no-op for en-US and other locales with no rules", () => {
    const a = art({ body_json: { mainHtml: "<p>chargeback återbetalningskrav</p>", keyTakeaways: [], faq: [], disclaimer: "" } });
    const r = applyTermLock(a, "en-US");
    expect(r.changed).toBe(false);
    expect(a.body_json.mainHtml).toContain("återbetalningskrav"); // untouched
  });
});
