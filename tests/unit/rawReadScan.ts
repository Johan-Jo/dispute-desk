/**
 * Raw-read scanner (single-source architecture audit, PR 3).
 *
 * Finds independent re-interpretations of the return / refund record in
 * merchant-facing source. The single answer lives in
 * lib/packs/effectiveChecklist.ts, lib/packs/noReturnApplicability.ts and
 * lib/disputes/refundStatement.ts; any other reader must be baselined with a reason.
 *
 * Shared by rawReadScan.test.ts (real tree + meta-test) so both use one code path.
 */
import fs from "node:fs";
import path from "node:path";

export type ScanPattern =
  | "literal:no_return_initiated"
  | "literal:noReturn"
  | "returnStatus"
  | "select:checklist_v2"
  | "totals.refunded";

export const PATTERNS: Record<ScanPattern, RegExp> = {
  "literal:no_return_initiated": /["'`]no_return_initiated["'`]/g,
  "literal:noReturn": /["'`]noReturn["'`]/g,
  // string literal "returnStatus" OR property access .returnStatus / ?.returnStatus
  returnStatus: /["'`]returnStatus["'`]|\.returnStatus\b/g,
  // .select("...checklist_v2...") raw checklist column read
  "select:checklist_v2": /\.select\(\s*["'`][^"'`]*checklist_v2/g,
  "totals.refunded": /\btotals\??\.refunded\b/g,
};

/** Merchant-facing roots (repo-relative, forward slashes). */
export const SCAN_ROOTS = [
  "app/(embedded)",
  "app/api",
  "components",
  "lib/disputes",
  "lib/argument",
] as const;

const EXCLUDED_DIRS = new Set(["__tests__", "node_modules", ".next", "messages"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/** Remove // and /* *\/ comments so prose mentions are not counted as reads. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Count pattern hits in one source string. Returns only patterns with count > 0. */
export function scanSource(src: string): Partial<Record<ScanPattern, number>> {
  const code = stripComments(src);
  const out: Partial<Record<ScanPattern, number>> = {};
  for (const [name, re] of Object.entries(PATTERNS) as [ScanPattern, RegExp][]) {
    const n = (code.match(new RegExp(re.source, re.flags)) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

function walk(dir: string, acc: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (
      EXTENSIONS.has(path.extname(e.name)) &&
      !/\.(test|spec)\.[tj]sx?$/.test(e.name)
    ) {
      acc.push(path.join(dir, e.name));
    }
  }
}

/** Scan the real tree. Keys are `file::pattern` -> count (line-agnostic). */
export function scanTree(repoRoot: string): Record<string, number> {
  const files: string[] = [];
  for (const r of SCAN_ROOTS) walk(path.join(repoRoot, r), files);
  const out: Record<string, number> = {};
  for (const f of files.sort()) {
    const rel = path.relative(repoRoot, f).split(path.sep).join("/");
    const hits = scanSource(fs.readFileSync(f, "utf8"));
    for (const [p, n] of Object.entries(hits)) out[`${rel}::${p}`] = n as number;
  }
  return out;
}
