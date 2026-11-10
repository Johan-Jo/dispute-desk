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
import { OWNER_BYPASS_PATTERNS, PATTERNS, scanSource, scanTree, type ScanPattern } from "./rawReadScan";
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

  it("plan 3.4 patterns: every entry is `open` (names the removing PR) or `allowed`", () => {
    for (const b of BASELINE.filter((x) => OWNER_BYPASS_PATTERNS.includes(x.pattern))) {
      expect(["open", "allowed"], `${b.file} ${b.pattern}`).toContain(b.category);
      if (b.category === "open") expect(b.removedBy, `${b.file} ${b.pattern}`).toMatch(/^PR \d/);
    }
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
    savedToShopifyAt: `const s = !!pack?.savedToShopifyAt;`,
    "appliedRule.mode": `const m = data.appliedRule?.mode;`,
    "orderSituation.refund": `const r = d.orderSituation?.refund;`,
    "bankIncludedFacts(": `const f = bankIncludedFacts(rows);`,
    FACT_CATEGORY_FIELD: `const x = FACT_CATEGORY_FIELD[c];`,
    DELIVERY_CONFIRMED: `const y = DELIVERY_CONFIRMED.has(p);`,
  };

  for (const p of Object.keys(PATTERNS) as ScanPattern[]) {
    it(`reports a planted ${p}`, () => {
      expect(scanSource(planted[p])[p] ?? 0).toBeGreaterThanOrEqual(1);
    });
  }

  it("reports string-literal returnStatus too", () => {
    expect(scanSource(`pick("returnStatus")`).returnStatus).toBe(1);
  });

  describe("per-pattern scope and owner allow-list (plan 3.4)", () => {
    const planted = `const s = !!pack?.savedToShopifyAt; const m = data.appliedRule?.mode;`;
    it("reports a plan 3.4 pattern inside the dispute page scope", () => {
      expect(scanSource(planted, "app/(embedded)/app/disputes/[id]/record/new.ts")).toEqual({
        savedToShopifyAt: 1,
        "appliedRule.mode": 1,
      });
      expect(scanSource(planted, "lib/disputes/disputeRecord.ts")).toEqual({ savedToShopifyAt: 1, "appliedRule.mode": 1 });
    });
    it("does not report it outside its scope", () => {
      expect(scanSource(planted, "components/ui/other.tsx")).toEqual({});
      expect(scanSource(planted, "app/(embedded)/app/settings/page.tsx")).toEqual({});
    });
    it("does not report it in an owner (allow-listed) file", () => {
      expect(scanSource(planted, "app/api/disputes/[id]/workspace/route.ts")).toEqual({});
      expect(scanSource(planted, "lib/disputes/presentation/resolveLifecycle.ts")).toEqual({});
      expect(scanSource(planted, "lib/disputes/workspacePayload/enrich.ts")).toEqual({});
    });
    it("legacy patterns keep their whole-root scope", () => {
      expect(scanSource(`const k = "noReturn";`, "components/ui/other.tsx")).toEqual({ "literal:noReturn": 1 });
    });
    it("a planted bypass inside record/** is found by the tree scan function", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rawread-scope-"));
      try {
        const rel = "app/(embedded)/app/disputes/[id]/record/bypass.ts";
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), "export const x = (p) => p.savedToShopifyAt;");
        expect(scanTree(dir)[`${rel}::savedToShopifyAt`]).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
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
