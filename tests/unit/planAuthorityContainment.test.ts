/**
 * P5 — keep argument authority where it belongs.
 *
 * ── WHAT THIS GUARD IS, AND WHAT IT IS NOT ───────────────────────────
 *
 * This is the SUPPLEMENTARY half of the defence. It would NOT have caught
 * the drift it was written for: the four surfaces that contradicted the plan
 * had zero references to `allowedFactCategories` — that is precisely why
 * they drifted. They re-derived the same answer from `category` + `payload`,
 * which no grep can see.
 *
 * The primary defence is behavioural: `planProjectionAgreement.test.ts` and
 * `documentProvenance.test.ts`. This file adds the cheap structural check on
 * top, catching the OTHER failure mode — a future consumer that reaches for
 * the reason module's allow-list directly instead of asking the plan.
 *
 * ── DECLARING vs CONSUMING ───────────────────────────────────────────
 *
 * A naive "nothing may name `allowedFactCategories`" rule is wrong: the
 * reason modules DECLARE the list, the registry aggregates it, the type
 * defines it, and the narrative writer legitimately receives the merged
 * version. The rule has to separate those from a new consumer deciding
 * evidence disposition on its own.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SYMBOL = "allowedFactCategories";

/**
 * Files permitted to name the symbol, by role.
 *
 * Written out rather than pattern-matched loosely, so adding an entry is a
 * visible diff a reviewer has to approve — the same reasoning as the
 * cron-gate enumeration test.
 */
const ALLOWED_PREFIXES = [
  // DECLARE — the modules that own the lists, plus the registry and type.
  "lib/defence/reasonCodes/",
  "lib/defence/types.ts",
  // CONSUME — the plan derives from it; the package and narrative writer
  // receive it through the plan's own pipeline.
  "lib/argument/plan/",
  "lib/defence/package/",
  "lib/defence/narrativeWriter.ts",
  "lib/defence/alwaysAdmissible.ts",
  // READ-ONLY / DISPLAY — admin surfaces that show module config. They make
  // no evidence decision; listed explicitly so a real consumer cannot hide
  // among them.
  "lib/defence/admin-queries.ts",
  "lib/defence/promptModuleGuidanceKeys.ts",
  "app/api/admin/defence-package/prompt-modules/",
  // Admin prompt-module inspector. Serialises the module's own config for
  // display; makes no evidence decision. Found by this guard on its first
  // run — it was missing from the plan's hand-written audit, which is the
  // argument for having the guard.
  "app/admin/defence-package/prompts/",
];

const SCAN_DIRS = ["lib", "app", "components"];
const SKIP_DIR = new Set(["node_modules", ".next", "__tests__", "__fixtures__"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function repoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

describe("P5 — argument authority containment", () => {
  it("no NEW module decides evidence disposition from allowedFactCategories", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const abs of walk(join(ROOT, dir))) {
        const rel = repoPath(abs);
        if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        const src = readFileSync(abs, "utf8");
        if (src.includes(SYMBOL)) offenders.push(rel);
      }
    }

    expect(
      offenders.sort(),
      `these files name \`${SYMBOL}\` outside the declare/consume allow-list. ` +
        `If one genuinely needs argument authority, it should read the ` +
        `CaseArgumentPlan instead — see docs/plans/plan-projection-drift.plan.md.`,
    ).toEqual([]);
  });

  it("the allow-list itself stays honest — every prefix still exists", () => {
    // A stale prefix silently widens the guard: it would keep permitting a
    // path that has since been renamed into something unguarded.
    const all = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map(repoPath);
    for (const prefix of ALLOWED_PREFIXES) {
      const matched = all.some((f) => f.startsWith(prefix));
      expect(matched, `allow-list prefix no longer matches anything: ${prefix}`).toBe(
        true,
      );
    }
  });
});
