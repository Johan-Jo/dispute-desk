/**
 * Guards the credit-arrival replay.
 *
 * The class defect this closes: a dispute that took the `quota_exceeded`
 * pipeline exit can never retry, because the dispatcher's `withEffectDedup`
 * claim is written before the effect runs. Credits arriving later left 63
 * live disputes on `6a8848-dd` permanently pack-less (prod, 2026-08-29).
 *
 * The structural invariant is the last test: every path that puts credits in
 * the ledger MUST go through `grantCredits`, which is where the sweep is
 * scheduled. A new grant path that inserts directly would silently reopen
 * the gap.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const enqueueJob = vi.fn();
const from = vi.fn();

vi.mock("@/lib/jobs/claimJobs", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJob(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ from }),
}));

import {
  findBlockedBuildCandidates,
  scheduleBlockedBuildReplay,
  isHistoricalImportRunning,
  replayBlockedBuilds,
  REPLAY_CANDIDATE_CAP,
} from "@/lib/billing/replayBlockedBuilds";

/** Minimal PostgREST-ish builder: every filter returns `this`, and the
 *  chain resolves to whatever the test queued for that table. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gt", "order", "limit", "not"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

beforeEach(() => {
  enqueueJob.mockReset();
  from.mockReset();
});

describe("findBlockedBuildCandidates", () => {
  it("returns open, pack-less disputes with a live deadline", async () => {
    from.mockImplementation((table: string) => {
      if (table === "disputes") {
        return builder({ data: [{ id: "d1" }, { id: "d2" }], error: null });
      }
      // d1 already has a live pack; d2 does not.
      return builder({ data: [{ dispute_id: "d1" }], error: null });
    });

    const out = await findBlockedBuildCandidates("shop-1");
    expect(out).toEqual([{ disputeId: "d2", shopId: "shop-1" }]);
  });

  it("returns nothing when every candidate already has a pack", async () => {
    from.mockImplementation((table: string) =>
      table === "disputes"
        ? builder({ data: [{ id: "d1" }], error: null })
        : builder({ data: [{ dispute_id: "d1" }], error: null }),
    );

    expect(await findBlockedBuildCandidates("shop-1")).toEqual([]);
  });

  it("throws rather than silently returning [] when the query fails", async () => {
    from.mockImplementation(() =>
      builder({ data: null, error: { message: "boom" } }),
    );

    await expect(findBlockedBuildCandidates("shop-1")).rejects.toThrow(/boom/);
  });
});

describe("scheduleBlockedBuildReplay", () => {
  it("enqueues one deduped sweep per grant reference", async () => {
    enqueueJob.mockResolvedValue("job-1");

    await scheduleBlockedBuildReplay({ shopId: "shop-1", reference: "topup-9" });

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        jobType: "replay_blocked_builds",
        dedupeKey: "replay_blocked_builds:shop-1:topup-9",
      }),
    );
  });

  it("swallows a duplicate-key race instead of failing the grant", async () => {
    enqueueJob.mockRejectedValue(new Error('duplicate key value 23505'));

    await expect(
      scheduleBlockedBuildReplay({ shopId: "shop-1", reference: "topup-9" }),
    ).resolves.toBeUndefined();
  });

  it("never throws into the caller's billing path", async () => {
    enqueueJob.mockRejectedValue(new Error("database offline"));

    await expect(
      scheduleBlockedBuildReplay({ shopId: "shop-1", reference: "r" }),
    ).resolves.toBeUndefined();
  });
});

describe("historical-import deferral", () => {
  /** Pack evidence is computed FROM shopify_orders, so a mid-backfill build
   *  silently undercounts prior-order history — the argument that wins these
   *  cases. Caught on 6a8848-dd before it corrupted 56 packs. */
  function shopWithStatus(status: string | null) {
    return () =>
      builder({
        data: status === null ? null : { historical_import_status: status },
        error: null,
      });
  }

  it("defers while the order backfill is in_progress", async () => {
    from.mockImplementation(shopWithStatus("in_progress"));
    expect(await isHistoricalImportRunning("shop-1")).toBe(true);
  });

  it.each(["complete", "not_started", "failed"])(
    "does NOT defer when status is %s",
    async (status) => {
      from.mockImplementation(shopWithStatus(status));
      expect(await isHistoricalImportRunning("shop-1")).toBe(false);
    },
  );

  it("treats a missing shop row as not-running rather than blocking forever", async () => {
    from.mockImplementation(shopWithStatus(null));
    expect(await isHistoricalImportRunning("shop-1")).toBe(false);
  });

  it("returns deferredForImport without enqueuing anything mid-backfill", async () => {
    const inserted: unknown[] = [];
    from.mockImplementation((table: string) => {
      if (table === "shops") return shopWithStatus("in_progress")();
      if (table === "audit_events") {
        return { insert: (row: unknown) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        } };
      }
      return builder({ data: [], error: null });
    });

    const summary = await replayBlockedBuilds("shop-1");

    expect(summary.deferredForImport).toBe(true);
    expect(summary.candidates).toBe(0);
    expect(summary.enqueued).toBe(0);
    expect(inserted).toHaveLength(1);
  });
});

describe("structural invariant: grantCredits is the only ledger entry point", () => {
  const ROOTS = ["lib", "app", "scripts"];

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        walk(full, acc);
      } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no module inserts into pack_credits_ledger except grantCredits", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, "utf-8");
        if (!src.includes("pack_credits_ledger")) continue;
        // consumePack.ts owns grantCredits itself.
        if (file.replace(/\\/g, "/").endsWith("lib/billing/consumePack.ts")) {
          continue;
        }
        // A read (select) against the ledger is fine; an insert is not,
        // because it would bypass the credit-arrival replay.
        const insertsIntoLedger =
          /from\(\s*["']pack_credits_ledger["']\s*\)[\s\S]{0,120}?\.insert\(/.test(
            src,
          );
        if (insertsIntoLedger) offenders.push(file);
      }
    }

    expect(
      offenders,
      `These modules insert credits without going through grantCredits, so ` +
        `the blocked-build replay will not fire and disputes blocked on quota ` +
        `will stay permanently pack-less:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("re-fires the sweep when the order backfill completes", () => {
    // The deferral above is only safe because something wakes the sweep
    // back up. The credit grant that would have triggered it already
    // happened hours earlier, so without this call a deferred shop is
    // stranded exactly like the bug this module fixes.
    const src = readFileSync("lib/disputes/backfillOrders.ts", "utf-8");
    const completeBlock = src.slice(src.indexOf('historical_import_status: "complete"'));

    expect(
      completeBlock.includes("scheduleBlockedBuildReplay"),
      "backfillShopOrders must call scheduleBlockedBuildReplay when it flips " +
        "the shop to `complete` — otherwise a sweep deferred mid-backfill " +
        "never runs and the disputes stay permanently pack-less.",
    ).toBe(true);
  });

  it("keeps the candidate cap bounded", () => {
    expect(REPLAY_CANDIDATE_CAP).toBeGreaterThan(0);
    expect(REPLAY_CANDIDATE_CAP).toBeLessThanOrEqual(500);
  });
});
