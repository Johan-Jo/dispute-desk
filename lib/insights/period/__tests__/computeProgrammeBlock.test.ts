import { describe, expect, it } from "vitest";
import { computeProgrammeBlock, programmeMonthFor } from "../computeProgrammeBlock";

interface Dispute {
  id: string;
  phase: "chargeback" | "inquiry";
  network_reason_code: string | null;
  final_outcome: string | null;
  order_gid: string | null;
  initiated_at: string;
}

interface World {
  /** Head counts keyed by "card:<from>" / "unknown:<from>". */
  counts: Record<string, number>;
  disputes: Dispute[];
  methodByGid: Record<string, string | null>;
  failOn?: string;
}

/**
 * A minimal PostgREST stand-in: it honours the filters this module uses,
 * caps an un-ranged page at 1000 rows like the real API, and records which
 * column each dispute query filtered on.
 */
function fakeSb(world: World) {
  const log: string[] = [];
  function builder(table: string) {
    const f: Record<string, unknown> = {};
    let head = false;
    let range: [number, number] | null = null;
    const b: Record<string, unknown> = {
      select(_c: string, opts?: { head?: boolean }) {
        head = !!opts?.head;
        return b;
      },
      eq(c: string, v: unknown) { f[`eq:${c}`] = v; return b; },
      gte(c: string, v: unknown) { f[`gte:${c}`] = v; log.push(`${table}.gte.${c}`); return b; },
      lt(c: string, v: unknown) { f[`lt:${c}`] = v; return b; },
      in(c: string, v: unknown) { f[`in:${c}`] = v; return b; },
      is(c: string, v: unknown) { f[`is:${c}`] = v; return b; },
      order() { return b; },
      range(a: number, z: number) { range = [a, z]; return b; },
      then(resolve: (r: unknown) => void) {
        if (world.failOn === table) return resolve({ data: null, count: null, error: { message: "boom" } });
        if (table === "shopify_orders" && head) {
          const from = String(f["gte:created_at_shopify"]).slice(0, 10);
          const kind = f["is:payment_method"] === null ? "unknown" : "card";
          return resolve({ count: world.counts[`${kind}:${from}`] ?? 0, error: null });
        }
        if (table === "shopify_orders") {
          const gids = f["in:shopify_order_id"] as string[];
          return resolve({
            data: gids.map((g) => ({ shopify_order_id: g, payment_method: world.methodByGid[g] ?? null })),
            error: null,
          });
        }
        if (table === "disputes") {
          const from = String(f["gte:initiated_at"]);
          const to = String(f["lt:initiated_at"]);
          const rows = world.disputes.filter((d) => d.initiated_at >= from && d.initiated_at < to);
          const [a, z] = range ?? [0, 999];
          return resolve({ data: rows.slice(a, Math.min(z + 1, a + 1000)), error: null });
        }
        if (table === "evidence_packs") return resolve({ data: [], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  }
  return { sb: { from: (t: string) => builder(t) } as never, log };
}

const SEP = "2026-09-01";
const cb = (i: number, extra: Partial<Dispute> = {}): Dispute => ({
  id: `d${i}`,
  phase: "chargeback",
  network_reason_code: "10.4",
  final_outcome: null,
  order_gid: `o${i}`,
  initiated_at: "2026-09-10T00:00:00Z",
  ...extra,
});

describe("computeProgrammeBlock", () => {
  it("blume-box September: 4 card chargebacks / 2,686 card orders = 0.00149, healthy", async () => {
    const disputes = [cb(1), cb(2), cb(3, { network_reason_code: "4837" }), cb(4, { network_reason_code: "4853" })];
    const { sb } = fakeSb({
      counts: { "card:2026-09-01": 2686, "card:2026-08-01": 3274, "unknown:2026-09-01": 1282 },
      disputes,
      methodByGid: { o1: "card", o2: "shopify_pay", o3: "apple_pay", o4: "card" },
    });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardDisputeRatio).toBe(0.00149);
    expect(b.cardChargebackCount).toBe(4);
    expect(b.visaChargebackCount).toBe(2);
    expect(b.mcChargebackCount).toBe(2);
    expect(b.ecmRatio).toBe(0.00061);
    expect(b.vampSeverity).toBe("healthy");
    expect(b.ecmSeverity).toBe("healthy");
    expect(b.cardFramingApplies).toBe(true);
  });

  it("excludes inquiries from the numerator", async () => {
    const { sb } = fakeSb({
      counts: { "card:2026-09-01": 1000, "card:2026-08-01": 1000 },
      disputes: [cb(1), cb(2, { phase: "inquiry" }), cb(3, { phase: "inquiry" })],
      methodByGid: { o1: "card", o2: "card", o3: "card" },
    });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardChargebackCount).toBe(1);
    expect(b.cardDisputeRatio).toBe(0.001);
  });

  // A dispute's `created_at` is when OUR row was inserted; a history import
  // backfills old disputes with a recent created_at. Only initiated_at counts.
  it("filters disputes by initiated_at, so backfilled history is not this month", async () => {
    const { sb, log } = fakeSb({
      counts: { "card:2026-09-01": 1000, "card:2026-08-01": 1000 },
      disputes: [cb(1), cb(2, { initiated_at: "2026-04-02T00:00:00Z" })],
      methodByGid: { o1: "card", o2: "card" },
    });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardChargebackCount).toBe(1);
    expect(log).toContain("disputes.gte.initiated_at");
    expect(log).not.toContain("disputes.gte.created_at");
  });

  it("returns null, never 0, below 50 card settled orders", async () => {
    const { sb } = fakeSb({
      counts: { "card:2026-09-01": 1, "card:2026-08-01": 0 },
      disputes: [cb(1)],
      methodByGid: { o1: "card" },
    });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardDisputeRatio).toBeNull();
    expect(b.ecmRatio).toBeNull();
    expect(b.vampSeverity).toBeNull();
  });

  it("throws on any query error", async () => {
    const { sb } = fakeSb({ counts: {}, disputes: [], methodByGid: {}, failOn: "disputes" });
    await expect(computeProgrammeBlock(sb, "shop", SEP)).rejects.toThrow(/disputes/);
  });

  it("paginates past the 1000-row cap", async () => {
    const disputes = Array.from({ length: 2500 }, (_, i) => cb(i));
    const methodByGid = Object.fromEntries(disputes.map((d) => [d.order_gid, "card"]));
    const { sb } = fakeSb({ counts: { "card:2026-09-01": 100_000, "card:2026-08-01": 100_000 }, disputes, methodByGid });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardChargebackCount).toBe(2500);
  });

  it("rounds ratios once to 5 decimals", async () => {
    // 14,446 / 10,000,000 = 0.0014446 → 0.00144
    const disputes = Array.from({ length: 14_446 }, (_, i) => cb(i));
    const methodByGid = Object.fromEntries(disputes.map((d) => [d.order_gid, "card"]));
    const { sb } = fakeSb({ counts: { "card:2026-09-01": 10_000_000, "card:2026-08-01": 10_000_000 }, disputes, methodByGid });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardDisputeRatio).toBe(0.00144);
  });

  // Mein Maison / cay-collective: most disputes are PayPal or Klarna, but
  // they take ~1,000 / ~750 card orders a month. Visa and Mastercard measure
  // those card payments, so the card verdict must show (0% here), never
  // "not applicable".
  it("applies the card programmes whenever there is card volume, whatever the dispute mix", async () => {
    const { sb } = fakeSb({
      counts: { "card:2026-09-01": 752, "card:2026-08-01": 512 },
      disputes: [cb(1, { phase: "inquiry" }), cb(2, { phase: "inquiry" }), cb(3, { phase: "inquiry" })],
      methodByGid: { o1: "klarna", o2: "klarna", o3: "klarna" },
    });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardFramingApplies).toBe(true);
    expect(b.cardDisputeRatio).toBe(0);
    expect(b.vampSeverity).toBe("healthy");
    expect(b.cardDisputeShare).toBe(0);
  });

  it("does not apply below 50 card orders", async () => {
    const { sb } = fakeSb({ counts: { "card:2026-09-01": 10, "card:2026-08-01": 10 }, disputes: [], methodByGid: {} });
    const b = await computeProgrammeBlock(sb, "shop", SEP);
    expect(b.cardFramingApplies).toBe(false);
  });
});

describe("programmeMonthFor", () => {
  it("turns a failure into an explicit error state", async () => {
    const { sb } = fakeSb({ counts: {}, disputes: [], methodByGid: {}, failOn: "shopify_orders" });
    const p = await programmeMonthFor(sb, "shop", SEP, new Date("2026-10-02T00:00:00Z"));
    expect(p).toEqual({ status: "error", periodMonth: SEP });
  });

  it("labels the month provisional before the 8th", async () => {
    const { sb } = fakeSb({ counts: { "card:2026-09-01": 100, "card:2026-08-01": 100 }, disputes: [], methodByGid: {} });
    const p = await programmeMonthFor(sb, "shop", SEP, new Date("2026-10-02T00:00:00Z"));
    expect(p.status).toBe("ok");
    if (p.status === "ok") {
      expect(p.periodState).toBe("provisional");
      expect(p.finalOn).toBe("2026-10-08T00:00:00.000Z");
    }
  });
});
