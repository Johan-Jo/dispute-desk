/**
 * A failed build may not stand in for the package.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────
 *
 * blume-box dispute 11051073729 (USD 120, FRAUDULENT/4837, due
 * 2026-08-14T23:00Z) held defence package v4: `validation_status='ok'`, PDF
 * rendered, and explicitly held by the pipeline to be filed at its deadline
 * (`auto_save_blocked` → `hold_for_deadline`, verdict `eligible`). At 06:03 on
 * the deadline morning the pre-deadline rebuild cron regenerated it; v5 failed
 * narrative validation twice and landed `failed` with no PDF. At 08:01 the
 * deadline cron read "the latest row", found v5, and filed NOTHING.
 *
 * Twelve disputes were in that shape fleet-wide when it was measured, one of
 * them already lost. The bug is one line, repeated at every filing site:
 *
 *   .order("version", { ascending: false }).limit(1)
 *
 * — which conflates "the highest version number" with "the package we would
 * file". `lib/defence/candidateVersions.ts` is the single answer to the second
 * question, and this file keeps it single.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  candidateVersions,
  isAbortedBuild,
  latestCandidate,
} from "@/lib/defence/candidateVersions";

const row = (version: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: `v${version}`,
  version,
  status,
  ...extra,
});

describe("latestCandidate", () => {
  it("looks past a failed build to the last package that was actually built", () => {
    /* The production shape, exactly: v5 failed on the deadline morning, v4 was
     * validated and PDF-rendered two days earlier. */
    const r = latestCandidate([
      row(5, "failed"),
      row(4, "stale"),
      row(3, "stale"),
      row(2, "draft"),
      row(1, "stale"),
    ]);
    expect(r.candidate?.version).toBe(4);
    expect(r.abortedNewer.map((a) => a.version)).toEqual([5]);
  });

  it("reports EVERY aborted build above the candidate, newest first", () => {
    const r = latestCandidate([row(7, "failed"), row(6, "failed"), row(5, "draft")]);
    expect(r.candidate?.version).toBe(5);
    expect(r.abortedNewer.map((a) => a.version)).toEqual([7, 6]);
  });

  it("takes the top row when it is a real candidate — no fallback", () => {
    const r = latestCandidate([row(5, "final"), row(4, "stale")]);
    expect(r.candidate?.version).toBe(5);
    expect(r.abortedNewer).toEqual([]);
  });

  it("does NOT look past a `skipped` row", () => {
    /* `skipped` is a decision — covered by Shopify Protect, or no bank-eligible
     * facts. Falling back past one would file a package for a case the pipeline
     * deliberately left alone, which is the opposite of the fix. */
    const r = latestCandidate([row(5, "skipped"), row(4, "final")]);
    expect(r.candidate?.version).toBe(5);
  });

  it("does NOT look past a refused-but-real candidate", () => {
    /* The forbidden search is "the newest SAFE version". A candidate the
     * content gate refuses stops the filing; only an ABORTED BUILD is skipped,
     * because it was never a version of the argument. This helper cannot tell
     * safe from unsafe and must not try — it hands `stale` v5 back and lets the
     * safety gate refuse it. */
    const r = latestCandidate([row(5, "stale"), row(4, "final")]);
    expect(r.candidate?.version).toBe(5);
  });

  it("returns no candidate when every row is a failed build", () => {
    const r = latestCandidate([row(2, "failed"), row(1, "failed")]);
    expect(r.candidate).toBeNull();
    expect(r.abortedNewer.map((a) => a.version)).toEqual([2, 1]);
  });

  it("returns no candidate, and no aborted builds, for an empty case", () => {
    expect(latestCandidate([])).toEqual({
      candidate: null,
      abortedNewer: [],
      ambiguous: false,
    });
  });

  it("flags a tie at the top version rather than picking silently", () => {
    const r = latestCandidate([
      { id: "a", version: 4, status: "draft" },
      { id: "b", version: 4, status: "draft" },
    ]);
    expect(r.ambiguous).toBe(true);
  });

  it("does not depend on the input already being sorted", () => {
    const r = latestCandidate([row(1, "stale"), row(5, "failed"), row(4, "final")]);
    expect(r.candidate?.version).toBe(4);
  });
});

describe("candidateVersions", () => {
  it("drops failed builds and orders newest first", () => {
    expect(
      candidateVersions([row(3, "draft"), row(5, "failed"), row(4, "stale")]).map(
        (r) => r.version,
      ),
    ).toEqual([4, 3]);
  });

  it("keeps every other lifecycle state", () => {
    const statuses = ["draft", "final", "stale", "skipped", "submitted", "superseded"];
    expect(
      candidateVersions(statuses.map((s, i) => row(i + 1, s))).map((r) => r.status),
    ).toHaveLength(statuses.length);
  });
});

describe("isAbortedBuild", () => {
  it("is true for `failed` and nothing else", () => {
    expect(isAbortedBuild("failed")).toBe(true);
    for (const s of ["draft", "final", "stale", "skipped", "submitted", "superseded", null]) {
      expect(isAbortedBuild(s), `${s} must not be treated as an aborted build`).toBe(false);
    }
  });
});

/* ── THE INVARIANT ────────────────────────────────────────────────────
 *
 * Fixing the six known call sites does not close the class; the seventh one
 * someone writes next month does. Any production module that orders
 * `defence_packages` by version is answering "which package?" and must go
 * through `candidateVersions.ts`.
 */

/**
 * Modules allowed to order `defence_packages` by version directly.
 *
 * An EXACT set with a stated reason each, not a list that may only shrink: the
 * point is that a reader can check every exemption is asking a different
 * question from "which package would we file".
 */
const ALLOWED = new Set([
  // The owner.
  "lib/defence/candidateVersions.ts",
  /* The version COUNTER. It must keep counting aborted builds — numbering the
   * next build off the highest CANDIDATE would reuse a version already taken by
   * a failed row and collide. Different question, correct query. */
  "lib/defence/enqueue.ts",
  /* Loads all versions for the canonical selector and filters through
   * `candidateVersions` on the very next line. */
  "lib/defence/package/loadFileableSelection.ts",
  /* "The last SUBMITTED package", for the material-change comparison. Filtered
   * to `status='submitted'`, which a failed build can never be. */
  "lib/automation/rebuildOutcome.ts",
  /* The generation guard's `priorLatest`. It exists to STOP a rebuild that
   * would repeat a failed generation, so it must see `failed` rows — reading
   * past them is the retry loop it prevents. */
  "lib/jobs/handlers/buildDefencePackageJob.ts",
  /* The workspace card reports the latest BUILD ATTEMPT for the current pack,
   * failures included, because a merchant whose rebuild failed has to see that
   * it failed. It is not choosing what to file. */
  "app/api/disputes/[id]/workspace/route.ts",
]);

const SKIP_DIR_SEGMENTS = ["node_modules", "__tests__", ".next"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_SEGMENTS.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no second answer to 'which defence package'", () => {
  it("routes every version-ordered query through candidateVersions.ts", () => {
    const root = process.cwd();
    const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))];

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes('from("defence_packages")')) continue;
      // The shape that means "which package?": a version ordering on this table.
      if (!/\.order\(\s*["']version["']/.test(src)) continue;
      const rel = relative(root, file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      offenders.push(rel);
    }

    expect(
      offenders,
      `These modules order defence_packages by version directly. "The highest ` +
        `version" is not "the package we would file" — a failed build takes a ` +
        `version number without producing a package. Use fetchCandidateRows + ` +
        `latestCandidate from lib/defence/candidateVersions.ts.`,
    ).toEqual([]);
  });
});
