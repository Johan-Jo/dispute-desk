/**
 * CI INVARIANT I4 (docs/plans/insights-single-source.plan.md): one threshold
 * table, one month selector, and no Insights rate computed from disputes
 * filtered by `created_at`.
 *
 * WHY. On 2026-10-02 one merchant was shown three VAMP numbers: 5.31%
 * "breach" (an inline copy that filtered disputes by `created_at`, our
 * insert time, so a history import counted every backfilled dispute as
 * recent), 0.90% "approaching" in the email (a rolling 90-day window), and a
 * third from a 0.65%/1.00% threshold table that disagreed with the 0.9%/1.5%
 * one on the same page. The real calendar-month figure was 0.15%.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCOPE = [
  "lib/insights",
  "lib/liabilityShift/ratios",
  "app/api/dashboard/insights",
  "app/api/ratios",
  "app/api/cron/monthly-digest",
  "app/(embedded)/app/insights",
  "lib/email",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCOPE.flatMap((d) => walk(d));
const rel = (f: string) => f.split(path.sep).join("/");

describe("I4 — Insights programme figures have one source", () => {
  it("scans the expected files", () => {
    expect(files.some((f) => rel(f) === "lib/insights/programmeThresholds.ts")).toBe(true);
  });

  it("no rate is computed from disputes filtered by created_at", () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return /from\(\s*"disputes"\s*\)[\s\S]{0,400}?\.(gte|gt|lt|lte)\(\s*"created_at"/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("VAMP/ECM thresholds are defined only in programmeThresholds.ts", () => {
    const offenders = files.filter((f) => {
      if (rel(f) === "lib/insights/programmeThresholds.ts") return false;
      const src = fs.readFileSync(f, "utf8");
      return /(VAMP|ECM|HECM)[A-Z_]*\s*=\s*[0-9.]+/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the statement month is chosen only in lib/insights/period/months.ts", () => {
    const offenders = files.filter((f) => {
      if (rel(f) === "lib/insights/period/months.ts") return false;
      const src = fs.readFileSync(f, "utf8");
      return /ratio_snapshots[\s\S]{0,300}?order\(\s*"period_month"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)[\s\S]{0,80}?limit\(\s*1\s*\)/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  // I6: one writer. A second writer is how four numbers for one month came
  // to exist; persist_shop_month locks, hashes, logs and upserts together.
  it("ratio_snapshots is written only through persistShopMonth", () => {
    const all = ["lib", "app", "scripts"].flatMap((d) => walk(d));
    const direct = all.filter((f) =>
      /from\(\s*"ratio_snapshots"\s*\)[\s\S]{0,200}?\.(upsert|insert|update|delete)\(/.test(
        fs.readFileSync(f, "utf8"),
      ),
    );
    expect(direct.map(rel)).toEqual([]);
    const rpc = all.filter(
      (f) =>
        rel(f) !== "lib/insights/period/persistShopMonth.ts" &&
        /rpc\(\s*"persist_shop_month"/.test(fs.readFileSync(f, "utf8")),
    );
    expect(rpc.map(rel)).toEqual([]);
  });
});
