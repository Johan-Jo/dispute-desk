/**
 * Raw-read scan (single-source architecture audit, PR 3; release criterion 10).
 *
 * Merchant surfaces must not re-interpret the return/refund record on their own.
 * This test scans the roots in SCAN_ROOTS (app/(embedded), app/api, components,
 * lib/disputes, lib/argument; excluding __tests__, node_modules, .next, messages
 * and test files) for: "no_return_initiated", "noReturn", "returnStatus" (literal
 * or property access), .select("...checklist_v2...") and totals.refunded.
 * Every hit must be in rawReadScan.baseline.ts with a reason. Stale entries fail too.
 * docs/technical.md has the how-to-update paragraph.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PATTERNS, scanSource, scanTree, type ScanPattern } from "./rawReadScan";
import { BASELINE } from "./rawReadScan.baseline";

const REPO = path.resolve(__dirname, "../..");
const key = (file: string, pattern: string) => `${file}::${pattern}`;

describe("raw-read scan: real tree vs baseline", () => {
  const actual = scanTree(REPO);
  const baselineKeys = new Set(BASELINE.map((b) => key(b.file, b.pattern)));

  it("every baseline entry has a reason of at least 20 characters", () => {
    for (const b of BASELINE) {
      expect(b.reason.trim().length, `${b.file} ${b.pattern}`).toBeGreaterThanOrEqual(20);
    }
  });

  it("baseline has no duplicate keys", () => {
    expect(baselineKeys.size).toBe(BASELINE.length);
  });

  it("no unbaselined raw read (route it through the single source or baseline it with a reason)", () => {
    const offenders = Object.entries(actual)
      .filter(([k]) => !baselineKeys.has(k))
      .map(([k, n]) => `${k} x${n}`);
    expect(offenders).toEqual([]);
  });

  it("no baseline entry is stale or has a changed count (delete or re-justify it)", () => {
    const stale = BASELINE.filter((b) => actual[key(b.file, b.pattern)] !== b.count).map(
      (b) => `${key(b.file, b.pattern)} baseline=${b.count} actual=${actual[key(b.file, b.pattern)] ?? 0}`,
    );
    expect(stale).toEqual([]);
  });
});

describe("raw-read scan: meta-test (the scanner is real)", () => {
  const planted: Record<ScanPattern, string> = {
    "literal:no_return_initiated": `const f = "no_return_initiated";`,
    "literal:noReturn": `const k = 'noReturn';`,
    returnStatus: `const s = order.returnStatus === "NO_RETURN";`,
    "select:checklist_v2": `sb.from("evidence_packs").select("id, checklist_v2");`,
    "totals.refunded": `const r = order.totals?.refunded;`,
  };

  for (const p of Object.keys(PATTERNS) as ScanPattern[]) {
    it(`reports a planted ${p}`, () => {
      expect(scanSource(planted[p])[p] ?? 0).toBeGreaterThanOrEqual(1);
    });
  }

  it("reports string-literal returnStatus too", () => {
    expect(scanSource(`pick("returnStatus")`).returnStatus).toBe(1);
  });

  it("reports zero for a clean string", () => {
    expect(
      scanSource(`import { x } from "@/lib/disputes/refundStatement";\nconst a = resolveOrderSituation(o);`),
    ).toEqual({});
  });

  it("ignores mentions in comments", () => {
    expect(scanSource(`// no_return_initiated returnStatus "noReturn"\n/* totals.refunded */`)).toEqual({});
  });

  it("a planted file on disk is found by the same scanning function", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rawread-"));
    try {
      const f = path.join(dir, "bypass.ts");
      fs.writeFileSync(f, Object.values(planted).join("\n"));
      const hits = scanSource(fs.readFileSync(f, "utf8"));
      expect(Object.keys(hits).sort()).toEqual(Object.keys(PATTERNS).sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
