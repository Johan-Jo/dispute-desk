/**
 * The daily self-heal for defence packages that failed on an INFRASTRUCTURE
 * error (`lib/defence/failedPackageSelfHeal.ts`).
 *
 * The class this closes: Cay #14784 failed twice on `llm_error` (the
 * five-`cache_control`-block API refusal) on 2026-09-24; the fix reached prod
 * 09-26; nothing re-asked, and the case sat on a failed latest package until a
 * human rebuilt it on 09-28, three days before its deadline.
 *
 * The hazard it must not reopen: a regeneration LOOP. So the tests pin, in
 * order: which codes are retried (never `validation_failed`), the streak bound,
 * the settle time, the budget deferral, the run cap, and that the route wires it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const maybeEnqueueDefencePackage = vi.fn();
const readGenerationBudget = vi.fn();
const logAuditEvent = vi.fn();

vi.mock("@/lib/defence/enqueue", () => ({
  maybeEnqueueDefencePackage: (...a: unknown[]) => maybeEnqueueDefencePackage(...a),
}));
vi.mock("@/lib/defence/generationBudget", () => ({
  readGenerationBudget: (...a: unknown[]) => readGenerationBudget(...a),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: (...a: unknown[]) => logAuditEvent(...a),
}));

import {
  decideSelfHeal,
  runFailedPackageSelfHeal,
  TRANSIENT_FAILURE_CODES,
  MAX_TRANSIENT_STREAK,
  MIN_FAILURE_AGE_MS,
  SELF_HEAL_RUN_CAP,
  type PackageVersionRow,
} from "@/lib/defence/failedPackageSelfHeal";
import { evaluateGenerationGuard } from "@/lib/defence/latestPackageGenerationGuard";
import { CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";
import { VALIDATOR_VERSION } from "@/lib/defence/validateNarrative";
import { COMPOSITION_VERSION } from "@/lib/defence/pdf/thesisTemplates";

const NOW = new Date("2026-09-28T06:00:00Z");
const LONG_AGO = "2026-09-24T12:36:47Z";

function row(version: number, over: Partial<PackageVersionRow> = {}): PackageVersionRow {
  return {
    id: `pkg-${version}`,
    version,
    status: "failed",
    failure_code: "llm_error",
    updated_at: LONG_AGO,
    ...over,
  };
}

describe("which failures are retried", () => {
  it("retries only pipe failures — never a verdict on the letter", () => {
    expect([...TRANSIENT_FAILURE_CODES].sort()).toEqual(["daily_cap_reached", "llm_error"]);
    expect(TRANSIENT_FAILURE_CODES).not.toContain("validation_failed");
    expect(TRANSIENT_FAILURE_CODES).not.toContain("pdf_render_failed");
  });

  it("Cay #14784's shape — two llm_error failures above stale drafts — is retried", () => {
    const d = decideSelfHeal([row(6), row(5), row(4, { status: "stale", failure_code: null })], NOW);
    expect(d).toEqual({ retry: true, failedPackageId: "pkg-6", failureCode: "llm_error", streak: 2 });
  });

  it("daily_cap_reached is retried", () => {
    const d = decideSelfHeal([row(3, { failure_code: "daily_cap_reached" })], NOW);
    expect(d.retry).toBe(true);
  });

  it("validation_failed is left to a human", () => {
    const d = decideSelfHeal([row(2, { failure_code: "validation_failed" })], NOW);
    expect(d).toMatchObject({ retry: false, reason: "failure_not_transient" });
  });

  it("a non-failed latest is not touched", () => {
    expect(decideSelfHeal([row(7, { status: "draft", failure_code: null }), row(6)], NOW)).toMatchObject({
      retry: false,
      reason: "latest_not_failed",
    });
    expect(decideSelfHeal([], NOW)).toMatchObject({ retry: false, reason: "no_packages" });
  });

  it("orders by version, not by array position", () => {
    const d = decideSelfHeal([row(5), row(7, { status: "draft", failure_code: null }), row(6)], NOW);
    expect(d).toMatchObject({ retry: false, reason: "latest_not_failed" });
  });
});

describe("the bounds", () => {
  it(`stops after ${MAX_TRANSIENT_STREAK} consecutive transient failures`, () => {
    const rows = Array.from({ length: MAX_TRANSIENT_STREAK }, (_, i) => row(10 - i));
    expect(decideSelfHeal(rows, NOW)).toMatchObject({ retry: false, reason: "streak_exhausted" });
  });

  it("mixed transient codes count toward the same streak", () => {
    const rows = [row(9), row(8, { failure_code: "daily_cap_reached" }), row(7)];
    expect(decideSelfHeal(rows, NOW)).toMatchObject({ retry: false, reason: "streak_exhausted" });
  });

  it("a validation failure below breaks the streak but the latest still decides", () => {
    const rows = [row(9), row(8, { failure_code: "validation_failed" }), row(7)];
    expect(decideSelfHeal(rows, NOW)).toMatchObject({ retry: true, streak: 1 });
  });

  it("leaves a failure younger than the settle time alone", () => {
    const fresh = new Date(NOW.getTime() - MIN_FAILURE_AGE_MS + 60_000).toISOString();
    expect(decideSelfHeal([row(4, { updated_at: fresh })], NOW)).toMatchObject({
      retry: false,
      reason: "too_recent",
    });
    expect(decideSelfHeal([row(4, { updated_at: null })], NOW)).toMatchObject({
      retry: false,
      reason: "too_recent",
    });
  });
});

/* The sweep relies on the guard ALLOWING a transient failure row: `markFailed`
 * writes no `prompt_version` for `llm_error` / `daily_cap_reached`, and the
 * guard reads NULL as "moved". If either side changes, the sweep would enqueue
 * into a guard that refuses it — pin the pair. */
describe("contract with evaluateGenerationGuard", () => {
  it("a transient failure row as markFailed writes it is retryable under current versions", () => {
    const v = evaluateGenerationGuard(
      {
        id: "pkg-6",
        version: 6,
        status: "failed",
        validation_status: null,
        failure_code: "llm_error",
        prompt_version: null,
        validator_version: VALIDATOR_VERSION,
        composition_version: null,
        evidence_hash: "h",
      },
      {
        promptVersion: CURRENT_PROMPT_VERSION,
        validatorVersion: VALIDATOR_VERSION,
        compositionVersion: COMPOSITION_VERSION,
        evidenceHash: "h",
      },
    );
    expect(v.blocked).toBe(false);
  });

  it("markFailed passes no prompt version on the transient paths", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/jobs/handlers/buildDefencePackageJob.ts"),
      "utf8",
    );
    const transientCalls = src
      .split("\n")
      .filter((l) => /markFailed\(/.test(l) && /"(llm_error|daily_cap_reached)"/.test(l));
    expect(transientCalls.length).toBeGreaterThan(0);
    for (const l of transientCalls) {
      // markFailed(sb, pkg, reason, code, retriable) — five args, no promptVersion.
      expect(l).toMatch(/"(llm_error|daily_cap_reached)",\s*true\)/);
    }
  });
});

/* ── the sweep ─────────────────────────────────────────────────────── */

type Result = { data: unknown; error: unknown };
function builder(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gt", "gte", "order", "limit", "not"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

/** defence_packages is read twice: the failed-row scan, then per-dispute versions. */
function fakeSb(opts: {
  failedDisputeIds: string[];
  disputes: Array<{ id: string; shop_id: string; due_at: string }>;
  versions: Record<string, PackageVersionRow[]>;
}) {
  let dpCalls = 0;
  const disputeOrder = opts.disputes.map((d) => d.id);
  return {
    from: (table: string) => {
      if (table === "defence_packages") {
        dpCalls += 1;
        if (dpCalls === 1) {
          return builder({ data: opts.failedDisputeIds.map((id) => ({ dispute_id: id })), error: null });
        }
        const id = disputeOrder[dpCalls - 2];
        return builder({ data: opts.versions[id] ?? [], error: null });
      }
      if (table === "disputes") return builder({ data: opts.disputes, error: null });
      if (table === "evidence_packs") return builder({ data: { id: "pack-1" }, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  maybeEnqueueDefencePackage.mockReset();
  readGenerationBudget.mockReset();
  logAuditEvent.mockReset();
  readGenerationBudget.mockResolvedValue({ exhausted: false });
  maybeEnqueueDefencePackage.mockResolvedValue({
    enqueued: true,
    reason: "new_draft",
    packageId: "new",
    version: 7,
    status: "draft",
  });
});

describe("runFailedPackageSelfHeal", () => {
  it("re-asks the canonical enqueue for a retryable case and audits it", async () => {
    const sb = fakeSb({
      failedDisputeIds: ["d1"],
      disputes: [{ id: "d1", shop_id: "s1", due_at: "2026-10-01T23:00:00Z" }],
      versions: { d1: [row(6), row(5)] },
    });
    const out = await runFailedPackageSelfHeal(sb, NOW);
    expect(out.enqueued).toBe(1);
    expect(maybeEnqueueDefencePackage).toHaveBeenCalledWith("pack-1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "auto_build_enqueued",
        eventPayload: expect.objectContaining({
          trigger: "failed_package_self_heal",
          failedPackageId: "pkg-6",
          transientStreak: 2,
        }),
      }),
    );
  });

  it("reports an exhausted streak instead of retrying", async () => {
    const sb = fakeSb({
      failedDisputeIds: ["d1"],
      disputes: [{ id: "d1", shop_id: "s1", due_at: "2026-10-01T23:00:00Z" }],
      versions: { d1: [row(7), row(6), row(5)] },
    });
    const out = await runFailedPackageSelfHeal(sb, NOW);
    expect(out.enqueued).toBe(0);
    expect(out.streakExhausted).toEqual(["d1"]);
    expect(maybeEnqueueDefencePackage).not.toHaveBeenCalled();
  });

  it("defers a shop whose generation budget is spent", async () => {
    readGenerationBudget.mockResolvedValue({ exhausted: true });
    const sb = fakeSb({
      failedDisputeIds: ["d1"],
      disputes: [{ id: "d1", shop_id: "s1", due_at: "2026-10-01T23:00:00Z" }],
      versions: { d1: [row(3, { failure_code: "daily_cap_reached" })] },
    });
    const out = await runFailedPackageSelfHeal(sb, NOW);
    expect(out.deferredBudget).toBe(1);
    expect(maybeEnqueueDefencePackage).not.toHaveBeenCalled();
  });

  it("skips disputes the caller already rebuilt", async () => {
    const sb = fakeSb({ failedDisputeIds: ["d1"], disputes: [], versions: {} });
    const out = await runFailedPackageSelfHeal(sb, NOW, new Set(["d1"]));
    expect(out.candidates).toBe(0);
    expect(maybeEnqueueDefencePackage).not.toHaveBeenCalled();
  });

  it("records a guard refusal as a skip, not an enqueue", async () => {
    maybeEnqueueDefencePackage.mockResolvedValue({
      enqueued: false,
      reason: "latest_package_failed",
      packageId: null,
      version: null,
      status: null,
    });
    const sb = fakeSb({
      failedDisputeIds: ["d1"],
      disputes: [{ id: "d1", shop_id: "s1", due_at: "2026-10-01T23:00:00Z" }],
      versions: { d1: [row(6)] },
    });
    const out = await runFailedPackageSelfHeal(sb, NOW);
    expect(out.enqueued).toBe(0);
    expect(out.skippedByReason).toEqual({ enqueue_latest_package_failed: 1 });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it(`enqueues at most ${SELF_HEAL_RUN_CAP} per run`, async () => {
    const n = SELF_HEAL_RUN_CAP + 3;
    const ids = Array.from({ length: n }, (_, i) => `d${i}`);
    const sb = fakeSb({
      failedDisputeIds: ids,
      disputes: ids.map((id) => ({ id, shop_id: "s1", due_at: "2026-10-01T23:00:00Z" })),
      versions: Object.fromEntries(ids.map((id) => [id, [row(2)]])),
    });
    const out = await runFailedPackageSelfHeal(sb, NOW);
    expect(out.enqueued).toBe(SELF_HEAL_RUN_CAP);
    expect(out.deferredRunCap).toBe(3);
  });
});

describe("wiring", () => {
  it("the deadline-rebuild cron runs the self-heal pass and excludes what it rebuilt", () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/cron/defence-package-deadline-rebuild/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/runFailedPackageSelfHeal\(sb, now, rebuiltDisputeIds\)/);
    // It must still run when no dispute is due today — no early return before it.
    expect(src).not.toMatch(/if \(!disputes\?\.length\) \{\s*return/);
  });
});
