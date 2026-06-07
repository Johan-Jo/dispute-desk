import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Supabase service client so the lib reads a fixed en-US source and
// records writes, without a real DB.
const enSource = {
  title: "Chargeback Lifecycle and How to Respond",
  excerpt: "What happens when a chargeback hits, and how to respond.",
  meta_title: "Chargeback lifecycle",
  meta_description: "How chargebacks work and how merchants respond.",
  route_kind: "resources",
  content_items: { content_type: "cluster_article" },
  body_json: {
    mainHtml: '<h2>Intro</h2><p>A chargeback is a forced reversal. Issue a refund instead when appropriate.</p>',
    keyTakeaways: ["Respond to the chargeback before the deadline."],
    faq: [{ q: "What is a chargeback?", a: "A forced reversal of a card payment." }],
    disclaimer: "Informational only.",
  },
};

const writes: Array<{ op: "insert" | "update"; row: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table !== "content_localizations") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: function () { return this; },
          maybeSingle: async () => {
            // First call in the lib is the en-US source fetch; subsequent
            // existence checks return no row (so the lib inserts).
            if (!(globalThis as Record<string, unknown>).__enServed) {
              (globalThis as Record<string, unknown>).__enServed = true;
              return { data: enSource };
            }
            return { data: null };
          },
        }),
        insert: async (row: Record<string, unknown>) => { writes.push({ op: "insert", row }); return { error: null }; },
        update: (row: Record<string, unknown>) => ({ eq: async () => { writes.push({ op: "update", row }); return { error: null }; } }),
      };
    },
  }),
}));

import { translateArticleLocales } from "@/lib/resources/generation/translateViaDeepL";

describe("translateArticleLocales (DeepL English-first translation)", () => {
  beforeEach(() => {
    writes.length = 0;
    delete (globalThis as Record<string, unknown>).__enServed;
    process.env.DEEPL_API_KEY = "test-key:fx";
    // DeepL mock: echoes the input but lowercases the sentinel token to prove the
    // restore is case-insensitive, and returns a fixed translation for the body.
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as { text: string[] };
      const translations = payload.text.map((t) => ({
        // Simulate DeepL: keep the opaque token (possibly recased), wrap in es-ish text.
        text: t.replace(/QZXTERMZZ/g, "qzxtermzz").replace(/QZXTERMZZS/g, "qzxtermzzs"),
      }));
      return { ok: true, json: async () => ({ translations }) } as unknown as Response;
    }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("inserts + publishes es-ES with the chargeback term locked to 'contracargo'", async () => {
    const res = await translateArticleLocales("item-1", { locales: ["es-ES"], publish: true });
    expect(res.outcomes[0].status).toBe("inserted");

    const insert = writes.find((w) => w.op === "insert");
    expect(insert).toBeTruthy();
    const row = insert!.row;
    // Sentinel restored to the locale term; no leftover token.
    expect(String(row.body_json && (row.body_json as { mainHtml: string }).mainHtml)).toContain("contracargo");
    expect(JSON.stringify(row)).not.toMatch(/qzxtermzz/i);
    // Legitimate "refund" wording is NOT replaced (it never had the token).
    expect(String((row.body_json as { mainHtml: string }).mainHtml)).toContain("refund");
    // Published.
    expect(row.is_published).toBe(true);
    expect(row.locale).toBe("es-ES");
  });

  it("capitalizes the first letter of a translated title", async () => {
    // Make DeepL return a lowercase-leading title.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_u: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as { text: string[] };
      return { ok: true, json: async () => ({ translations: payload.text.map((t, i) => ({ text: i === 0 ? "qzxtermzz: ciclo de vida" : t })) }) } as unknown as Response;
    });
    const res = await translateArticleLocales("item-1", { locales: ["es-ES"], publish: true });
    expect(res.outcomes[0].status).toBe("inserted");
    const row = writes.find((w) => w.op === "insert")!.row;
    expect(String(row.title)).toBe("Contracargo: ciclo de vida"); // restored + capitalized
  });

  it("fails gracefully when DEEPL_API_KEY is missing", async () => {
    delete process.env.DEEPL_API_KEY;
    const res = await translateArticleLocales("item-1", { locales: ["de-DE"] });
    expect(res.outcomes[0].status).toBe("failed");
    expect(res.outcomes[0].error).toMatch(/DEEPL_API_KEY/);
  });
});
