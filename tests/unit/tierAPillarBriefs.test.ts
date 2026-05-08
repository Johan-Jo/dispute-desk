import { describe, it, expect } from "vitest";
import {
  TIER_A_PILLAR_BRIEFS,
  upsertTierAPillarBriefs,
} from "@/lib/resources/seeding/tierAPillarBriefs";

describe("TIER_A_PILLAR_BRIEFS — content sanity", () => {
  it("ships exactly the three pillars specified by PR 6", () => {
    expect(TIER_A_PILLAR_BRIEFS).toHaveLength(3);
    const slugs = TIER_A_PILLAR_BRIEFS.map((b) => b.proposed_slug).sort();
    expect(slugs).toEqual([
      "chargeback-evidence-guide-shopify-merchants",
      "shopify-chargebacks-complete-merchant-guide",
      "shopify-fraud-chargebacks-explained",
    ]);
  });

  it("every brief targets the full multi-locale set", () => {
    for (const b of TIER_A_PILLAR_BRIEFS) {
      expect(b.target_locale_set).toEqual([
        "en-US",
        "de-DE",
        "fr-FR",
        "es-ES",
        "pt-BR",
        "sv-SE",
      ]);
    }
  });

  it("every brief has a real summary and notes (no placeholders)", () => {
    for (const b of TIER_A_PILLAR_BRIEFS) {
      expect(b.summary.length).toBeGreaterThan(80);
      expect(b.notes.length).toBeGreaterThan(200);
      expect(b.notes).not.toMatch(/TODO|TBD/);
    }
  });

  it("every brief encodes Tier A target_word_range in notes", () => {
    for (const b of TIER_A_PILLAR_BRIEFS) {
      const parsed = JSON.parse(b.notes);
      expect(parsed.target_word_range).toMatch(/3[5-9]\d{2}.+5\d{3} words/);
      expect(parsed.complexity).toBe("high");
      expect(parsed.page_role).toBe("pillar");
    }
  });

  it("every brief has Shopify-specific must_cover items", () => {
    for (const b of TIER_A_PILLAR_BRIEFS) {
      const parsed = JSON.parse(b.notes);
      expect(Array.isArray(parsed.must_cover)).toBe(true);
      expect(parsed.must_cover.length).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(parsed.shopify_specifics)).toBe(true);
      expect(parsed.shopify_specifics.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ── upsertTierAPillarBriefs — DB interaction with mocked client ── */

type FakeRow = { id: string; proposed_slug: string };

interface CallLog {
  lookups: string[];
  inserts: Record<string, unknown>[];
  updates: Array<{ id: string; payload: Record<string, unknown> }>;
}

function buildSupabaseStub(initialRows: FakeRow[]): {
  client: Parameters<typeof upsertTierAPillarBriefs>[1];
  log: CallLog;
} {
  const log: CallLog = { lookups: [], inserts: [], updates: [] };
  const rows = [...initialRows];
  const state = { mode: "" as "lookup" | "insert" | "update" | "", pendingPayload: null as null | Record<string, unknown>, eqId: "" };

  const lookupChain = {
    eq(_col: string, val: string) {
      if (state.mode === "lookup") log.lookups.push(val);
      state.eqId = val;
      return this;
    },
    async maybeSingle() {
      const found = rows.find((r) => r.proposed_slug === state.eqId);
      return { data: found ?? null, error: null };
    },
    select() {
      return { single: async () => ({ data: { id: `new-${rows.length + 1}` }, error: null }) };
    },
  };

  const updateChain = {
    eq(_col: string, val: string) {
      log.updates.push({ id: val, payload: state.pendingPayload as Record<string, unknown> });
      state.pendingPayload = null;
      return Promise.resolve({ error: null });
    },
  };

  const client = {
    from() {
      return {
        select() {
          state.mode = "lookup";
          return lookupChain;
        },
        update(payload: Record<string, unknown>) {
          state.mode = "update";
          state.pendingPayload = payload;
          return updateChain;
        },
        insert(payload: Record<string, unknown>) {
          state.mode = "insert";
          log.inserts.push(payload);
          return {
            select() {
              return {
                async single() {
                  const id = `new-${log.inserts.length}`;
                  rows.push({ id, proposed_slug: payload.proposed_slug as string });
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof upsertTierAPillarBriefs>[1];

  return { client, log };
}

describe("upsertTierAPillarBriefs", () => {
  it("inserts all 3 briefs when the table is empty", async () => {
    const { client, log } = buildSupabaseStub([]);
    const result = await upsertTierAPillarBriefs(undefined, client);
    expect(result.inserted).toHaveLength(3);
    expect(result.updated).toHaveLength(0);
    expect(log.inserts).toHaveLength(3);
  });

  it("updates existing rows when slugs already exist (idempotency)", async () => {
    const existing: FakeRow[] = [
      { id: "old-1", proposed_slug: "shopify-chargebacks-complete-merchant-guide" },
      { id: "old-2", proposed_slug: "shopify-fraud-chargebacks-explained" },
    ];
    const { client, log } = buildSupabaseStub(existing);
    const result = await upsertTierAPillarBriefs(undefined, client);
    expect(result.inserted).toHaveLength(1); // only the evidence pillar is new
    expect(result.updated).toHaveLength(2);
    expect(log.updates.map((u) => u.id).sort()).toEqual(["old-1", "old-2"]);
  });

  it("every insert payload carries Tier A flags", async () => {
    const { client, log } = buildSupabaseStub([]);
    await upsertTierAPillarBriefs(undefined, client);
    for (const payload of log.inserts) {
      expect(payload.tier_override).toBe("A");
      expect(payload.archetype).toBe("authority_pillar");
      expect(payload.is_hub_article).toBe(true);
      expect(payload.autopilot_approved).toBe(true);
      expect(payload.content_type).toBe("pillar_page");
      expect(payload.status).toBe("brief_ready");
      expect(payload.priority_score).toBe(1000);
    }
  });
});
