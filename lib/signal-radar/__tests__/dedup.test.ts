import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCategoryDedup,
  checkClusterDedup,
  circuitBreakerTripped,
} from "@/lib/signal-radar/alerts";

interface QuerySpy {
  table: string;
  filters: Array<[string, unknown]>;
  count: number;
}

function makeMockClient(returnCount: number) {
  const spy: QuerySpy = { table: "", filters: [], count: returnCount };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((k: unknown, v: unknown) => {
    spy.filters.push(["eq", { k, v }]);
    return builder;
  });
  builder.gt = vi.fn((k: unknown, v: unknown) => {
    spy.filters.push(["gt", { k, v }]);
    return builder;
  });
  builder.then = (resolve: (r: { count: number }) => unknown) =>
    resolve({ count: returnCount });
  const client = {
    from: vi.fn((t: string) => {
      spy.table = t;
      return builder;
    }),
  };
  return { client, spy };
}

const baseDecision = {
  kind: "immediate" as const,
  category_dedup_key: "immediate:transparency_frustration:reddit:r/shopify",
  cluster_dedup_key: "immediate:cluster:abc",
  category_cooldown_hours: 4,
  cluster_cooldown_hours: 24,
  reason: "transparency_frustration",
};

beforeEach(() => vi.useRealTimers());

describe("checkCategoryDedup", () => {
  it("returns true when a recent alert exists", async () => {
    const { client } = makeMockClient(1);
    // @ts-expect-error mock client
    const tripped = await checkCategoryDedup(client, baseDecision);
    expect(tripped).toBe(true);
  });

  it("returns false when no recent alerts exist", async () => {
    const { client } = makeMockClient(0);
    // @ts-expect-error mock client
    const tripped = await checkCategoryDedup(client, baseDecision);
    expect(tripped).toBe(false);
  });

  it("skips entirely when category_cooldown_hours is null (migration_intent path)", async () => {
    const { client, spy } = makeMockClient(99);
    const migrationDecision = { ...baseDecision, category_cooldown_hours: null };
    // @ts-expect-error mock client
    const tripped = await checkCategoryDedup(client, migrationDecision);
    expect(tripped).toBe(false);
    expect(spy.table).toBe("");
  });
});

describe("checkClusterDedup", () => {
  it("checks the cluster key when present", async () => {
    const { client, spy } = makeMockClient(1);
    // @ts-expect-error mock client
    const tripped = await checkClusterDedup(client, baseDecision);
    expect(tripped).toBe(true);
    expect(spy.filters.some((f) => JSON.stringify(f).includes("cluster_dedup_key"))).toBe(
      true
    );
  });

  it("returns false when cluster_dedup_key is null", async () => {
    const { client, spy } = makeMockClient(99);
    // @ts-expect-error mock client
    const tripped = await checkClusterDedup(client, {
      ...baseDecision,
      cluster_dedup_key: null,
    });
    expect(tripped).toBe(false);
    expect(spy.table).toBe("");
  });
});

describe("circuitBreakerTripped", () => {
  it("trips at 10+ immediates in last hour", async () => {
    const { client } = makeMockClient(10);
    // @ts-expect-error mock client
    expect(await circuitBreakerTripped(client)).toBe(true);
  });

  it("does not trip at 9", async () => {
    const { client } = makeMockClient(9);
    // @ts-expect-error mock client
    expect(await circuitBreakerTripped(client)).toBe(false);
  });
});
