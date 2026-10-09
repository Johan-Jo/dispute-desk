/**
 * An in-memory stand-in for the tables `maintainShopMonths`, its enqueue
 * helper, the materialize job and the calculate-ratios cron read and write.
 * Filters are applied for `eq` and `in`, which is all those callers use.
 */

export interface World {
  shops: Array<Record<string, unknown>>;
  /** `ratio_snapshots` rows; tests push to it from the `persistShopMonth` mock. */
  records: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  firstOrder: string | null;
  /** Tables read, in order. */
  reads: string[];
}

export function makeWorld(init: Partial<World> = {}): World {
  return { shops: [], records: [], jobs: [], alerts: [], sessions: [], firstOrder: null, reads: [], ...init };
}

export function fakeClient(world: World) {
  const from = (table: string) => {
    world.reads.push(table);
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let head = false;
    let inserted: Record<string, unknown> | null = null;

    const source = (): Array<Record<string, unknown>> =>
      table === "shops"
        ? world.shops
        : table === "ratio_snapshots"
          ? world.records
          : table === "jobs"
            ? world.jobs
            : table === "insights_ops_alerts"
              ? world.alerts
              : table === "shop_sessions"
                ? world.sessions
                : table === "shopify_orders"
                  ? world.firstOrder
                    ? [{ shop_id: "*", created_at_shopify: world.firstOrder }]
                    : []
                  : [];
    const matches = () =>
      source().filter(
        (row) =>
          eqs.every(([col, val]) => row[col] === undefined || row[col] === "*" || row[col] === val) &&
          ins.every(([col, vals]) => row[col] === undefined || vals.includes(row[col])),
      );

    const b: Record<string, unknown> = {};
    b.select = (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true;
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      eqs.push([col, val]);
      return b;
    };
    b.in = (col: string, vals: unknown[]) => {
      ins.push([col, vals]);
      return b;
    };
    for (const m of ["is", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: matches()[0] ?? null, error: null });
    b.single = async () =>
      inserted ? { data: inserted, error: null } : { data: matches()[0] ?? null, error: null };
    b.insert = (row: Record<string, unknown>) => {
      inserted = { id: `job-${world.jobs.length + 1}`, ...row };
      world.jobs.push(inserted);
      return b;
    };
    b.upsert = (row: Record<string, unknown>) => ({
      select: async () => {
        const seen = world.alerts.some(
          (a) => a.shop_id === row.shop_id && a.alert_key === row.alert_key && a.period_month === row.period_month,
        );
        if (!seen) world.alerts.push(row);
        return { data: seen ? [] : [{ id: "a" }], error: null };
      },
    });
    b.then = (resolve: (r: unknown) => void) => {
      const rows = matches();
      resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, error: null });
    };
    return b;
  };
  return { from } as never;
}

/** A stored month row as `maintainShopMonths` selects it. */
export function record(month: string, over: Record<string, unknown> = {}) {
  return {
    shop_id: "s1",
    period_month: month,
    stable_at: "2026-01-01T00:00:00Z",
    metrics_version: 4,
    coverage: "full",
    card_chargeback_count: 1,
    visa_chargeback_count: 1,
    mc_chargeback_count: 0,
    card_dispute_ratio: 0.001,
    mc_ecm_ratio: 0,
    card_framing_applies: true,
    ...over,
  };
}

/** What `computeShopMonth` returns, as far as these callers look. */
export const computed = (month: string, cb = 1) =>
  ({
    programme: {
      periodMonth: month,
      cardChargebackCount: cb,
      visaChargebackCount: cb,
      mcChargebackCount: 0,
      cardDisputeRatio: 0.001,
      ecmRatio: 0,
      cardFramingApplies: true,
    },
    operational: {},
    checkpoints: [],
  }) as never;

/** The 12 months ending September 2026. */
export const WINDOW_12 = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 10),
);

export const SHOP = {
  id: "s1",
  shop_domain: "new-shop.myshopify.com",
  uninstalled_at: null,
  historical_import_status: "complete",
  historical_import_completed_at: "2026-10-09T10:00:00Z",
  historical_import_since_date: null,
};

export const syncJob = (status: string) => ({ shop_id: "s1", job_type: "sync_disputes", status });
