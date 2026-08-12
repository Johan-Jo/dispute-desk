/**
 * A human-gated rejection is not an input to automation.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────
 *
 * 2026-08-11: a `build_pack` was enqueued for `1cc88617`, whose newest package
 * was `failed` / `validation_failed`. `maybeEnqueueDefencePackage` has no
 * opinion about failed rows — it skips an idempotent draft, stales a diverging
 * draft, and otherwise inserts `latest.version + 1`. It inserted v4 and
 * enqueued a regeneration, which failed the same way.
 *
 * The case was protected by a MANUAL instruction. The instruction held for one
 * batch, then the batch's selection basis changed and the protection did not
 * travel with it. A rule that lives in someone's head is not a guard.
 *
 * ── WHAT IS ASSERTED, AND WHERE ───────────────────────────────────────
 *
 * The predicate is asserted directly, but the load-bearing assertions run the
 * REAL `maybeEnqueueDefencePackage` against a stubbed client and prove ZERO
 * side effects: no insert into `defence_packages`, no insert into `jobs`, no
 * update of any kind. Asserting the predicate alone would have passed on
 * 11 August too — the predicate did not exist, and that is precisely why the
 * incident happened at the call site.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { maybeEnqueueDefencePackage } from "@/lib/defence/enqueue";
import {
  evaluateGenerationGuard,
  generationBlockPayload,
} from "@/lib/defence/latestPackageGenerationGuard";
import { computeEvidenceHash } from "@/lib/defence/computeEvidenceHash";
import { CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";
import { VALIDATOR_VERSION } from "@/lib/defence/validateNarrative";

const mockSb = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);

/* ── 1. The predicate ────────────────────────────────────────────────── */

describe("evaluateGenerationGuard", () => {
  it("blocks status = failed", () => {
    const v = evaluateGenerationGuard({ id: "p3", version: 3, status: "failed" });
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe("latest_package_failed");
    expect(v.blockingVersion).toBe(3);
    expect(v.blockingPackageId).toBe("p3");
  });

  it("blocks validation_status = failed even when status disagrees", () => {
    /* A half-written failure. Resuming generation over it would be acting on
     * whichever half happens to be convenient. */
    const v = evaluateGenerationGuard({ id: "p3", version: 3, status: "draft", validation_status: "failed" });
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe("latest_package_validation_failed");
  });

  it("carries the recorded failure code, never an inferred one", () => {
    const v = evaluateGenerationGuard({
      id: "p3", version: 3, status: "failed", failure_code: "validation_failed",
    });
    expect(v.failureCode).toBe("validation_failed");
    expect(generationBlockPayload(v)).toMatchObject({
      skipped: true,
      skip_reason: "latest_package_failed",
      blocking_version: 3,
      failure_code: "validation_failed",
      resolution: "human_action_required",
    });
  });

  it("allows every non-failed status in the real union", () => {
    // `stale` matters most: it is the ordinary "inputs moved, rebuild me"
    // state, and blocking it would stop the pre-activation rebuild entirely.
    for (const status of ["draft", "stale", "final", "submitted", "superseded", "skipped"]) {
      expect(evaluateGenerationGuard({ id: "p1", version: 1, status }).blocked).toBe(false);
    }
  });

  it("allows when there is no previous package at all", () => {
    expect(evaluateGenerationGuard(null).blocked).toBe(false);
    expect(evaluateGenerationGuard(undefined).blocked).toBe(false);
  });
});

/* ── 2. The REAL entry point, and its side effects ───────────────────── */

interface Harness {
  packageInsert: ReturnType<typeof vi.fn>;
  packageUpdate: ReturnType<typeof vi.fn>;
  jobsInsert: ReturnType<typeof vi.fn>;
}

function setup(latest: Record<string, unknown> | null): Harness {
  const packageInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "new", version: 9 }, error: null }),
    }),
  });
  const packageUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: "pack-1",
            shop_id: "shop-1",
            dispute_id: "case-1",
            status: "ready",
            completeness_score: 80,
            pack_json: { sections: [], coverage: { state: "not_covered" } },
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: latest, error: null }),
        insert: packageInsert,
        update: packageUpdate,
      };
    }
    if (table === "jobs") return { insert: jobsInsert };
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    };
  });

  mockSb.mockReturnValue({ from } as never);
  return { packageInsert, packageUpdate, jobsInsert };
}

beforeEach(() => vi.clearAllMocks());

describe("maybeEnqueueDefencePackage — blocked, with ZERO side effects", () => {
  /* Built under EXACTLY the rules in force now — the only shape that still
   * blocks after 2026-08-12. A failure recorded under superseded rules (or
   * before the versions were recorded at all) is a new attempt, not a repeat,
   * and is covered by `failedPackageSelfHeal.test.ts`.
   *
   * The versions are read from the modules rather than hardcoded so a bump
   * cannot silently turn these fixtures into "something changed" and quietly
   * stop exercising the blocked path. */
  const CURRENT_RULES = {
    prompt_version: CURRENT_PROMPT_VERSION,
    validator_version: VALIDATOR_VERSION,
    /* The hash the stubbed pack (empty sections, no items) actually produces,
     * computed with the real function rather than hardcoded — a wrong literal
     * would read as "evidence changed", allow the retry, and silently stop
     * these assertions from exercising the blocked path at all. */
    evidence_hash: computeEvidenceHash({
      approvedFacts: [],
      manualEvidence: [],
      reasonCode: null,
    }),
  };

  const BLOCKING = [
    { label: "status = failed", row: { id: "p3", version: 3, status: "failed", failure_code: "validation_failed", validation_status: "failed", ...CURRENT_RULES } },
    { label: "validation_status = failed", row: { id: "p3", version: 3, status: "draft", validation_status: "failed", ...CURRENT_RULES } },
  ];

  for (const { label, row } of BLOCKING) {
    it(`${label}: no package, no version, no job, no update`, async () => {
      const h = setup(row);
      const result = await maybeEnqueueDefencePackage("pack-1");

      expect(result.enqueued).toBe(false);
      // No new package or version.
      expect(h.packageInsert).not.toHaveBeenCalled();
      // No supersession or any other mutation of the existing row.
      expect(h.packageUpdate).not.toHaveBeenCalled();
      // No generation job — and therefore no finalization and no Shopify save,
      // both of which are downstream of a build that never runs.
      expect(h.jobsInsert).not.toHaveBeenCalled();
    });

    it(`${label}: records a structured skip reason for audit`, async () => {
      setup(row);
      await maybeEnqueueDefencePackage("pack-1");
      const call = mockAudit.mock.calls.find(
        (c) => (c[0] as { eventType?: string }).eventType === "defence_package_generation_skipped",
      );
      expect(call, "no audit row was written for the skip").toBeDefined();
      const payload = (call![0] as { eventPayload: Record<string, unknown> }).eventPayload;
      expect(payload.skipped).toBe(true);
      expect(String(payload.skip_reason)).toMatch(/latest_package_(failed|validation_failed)/);
      expect(payload.blocking_version).toBe(3);
      expect(payload.resolution).toBe("human_action_required");
    });

    it(`${label}: the existing failed package is left exactly as it is`, async () => {
      // Not deleted, not retried, not superseded, not rewritten.
      const h = setup(row);
      await maybeEnqueueDefencePackage("pack-1");
      expect(h.packageUpdate).not.toHaveBeenCalled();
      expect(h.packageInsert).not.toHaveBeenCalled();
    });
  }
});

/* ── 3. Normal behaviour is preserved ────────────────────────────────── */

describe("maybeEnqueueDefencePackage — still generates when it should", () => {
  it("no previous package → generates", async () => {
    const h = setup(null);
    const r = await maybeEnqueueDefencePackage("pack-1");
    expect(r.enqueued).toBe(true);
    expect(h.packageInsert).toHaveBeenCalled();
    expect(h.jobsInsert).toHaveBeenCalled();
  });

  it("latest is STALE → generates (the ordinary rebuild path)", async () => {
    /* Guard the guard. Without this, every assertion above would be satisfied
     * by a change that simply stopped generating anything — which would halt
     * the pre-activation rebuild and look like a passing test suite. */
    const h = setup({ id: "p2", version: 2, status: "stale", validation_status: "ok" });
    const r = await maybeEnqueueDefencePackage("pack-1");
    expect(r.enqueued).toBe(true);
    expect(h.packageInsert).toHaveBeenCalled();
    expect(h.jobsInsert).toHaveBeenCalled();
  });

  it("an OLDER failure does not block once the latest is eligible", async () => {
    /* The query orders by version desc and takes one row, so `latest` IS the
     * newest. A case that failed at v3 and was regenerated to a healthy v4 has
     * had its rejection resolved, and must not stay blocked forever. */
    const h = setup({ id: "p4", version: 4, status: "final", validation_status: "ok" });
    const r = await maybeEnqueueDefencePackage("pack-1");
    expect(r.enqueued).toBe(true);
    expect(h.packageInsert).toHaveBeenCalled();
  });
});

/* ── 4. One owner, no second interpretation ──────────────────────────── */

describe("the status logic is not duplicated", () => {
  it("the ops rebuild script mirrors the predicate and says so", async () => {
    /* The script enqueues `build_pack` directly, so the enqueue guard only
     * stops the second half of the chain; it must exclude the case itself.
     * It is a .mjs ops script and cannot import the TS predicate, so the
     * mirror is explicit — and pinned here so the two cannot drift silently. */
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(__dirname, "../../scripts/cp-pre-activation-rebuild.mjs"),
      "utf8",
    );
    expect(src).toMatch(/status === "failed" \|\| validation === "failed"/);
    expect(src).toMatch(/latestPackageGuardParity/);
  });

  it("the worker re-checks the version BENEATH an already-enqueued draft", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(__dirname, "../../lib/jobs/handlers/buildDefencePackageJob.ts"),
      "utf8",
    );
    expect(src).toMatch(/evaluateGenerationGuard\(priorLatest\)/);
    // Declines without marking the draft failed — it is not defective.
    expect(src).toMatch(/generation_blocked: \$\{priorGuard\.reason\}/);
  });
});
