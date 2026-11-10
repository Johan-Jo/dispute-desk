/**
 * Raw-read scanner (single-source architecture audit, PR 3; extended by the
 * dispute-page single-source plan 3.4).
 *
 * Finds independent re-interpretations of an owner's field in merchant-facing
 * source. The single answers live in lib/packs/effectiveChecklist.ts,
 * lib/packs/noReturnApplicability.ts, lib/disputes/refundStatement.ts and
 * lib/disputes/presentation/**; any other reader must be baselined with a reason.
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
  | "totals.refunded"
  // Plan 3.4: owner-bypass patterns, scoped to the dispute page and the record builder.
  | "savedToShopifyAt"
  | "appliedRule.mode"
  | "orderSituation.refund"
  | "bankIncludedFacts("
  | "FACT_CATEGORY_FIELD"
  | "DELIVERY_CONFIRMED";

/**
 * A pattern, the repo-relative paths it applies to (a path ending in "/" is a
 * directory prefix, anything else an exact file), and the owner paths exempt
 * from it (the places that are SUPPOSED to read the raw field).
 */
export interface PatternSpec {
  re: RegExp;
  scope: readonly string[];
  allow: readonly string[];
}

/** Merchant-facing roots (repo-relative, forward slashes). */
export const SCAN_ROOTS = [
  "app/(embedded)",
  "app/api",
  "components",
  "lib/disputes",
  "lib/argument",
] as const;

/** Legacy patterns apply to every scan root, as before. */
const ALL_ROOTS: readonly string[] = SCAN_ROOTS.map((r) => `${r}/`);
/** The dispute page and the record builder: where a second reader of an owner's field must not appear. */
const DISPUTE_PAGE_SCOPE: readonly string[] = ["app/(embedded)/app/disputes/", "lib/disputes/disputeRecord.ts"];
/** The owners of the raw fields: the workspace route, the presentation model, the payload enrichment. */
const OWNERS: readonly string[] = [
  "app/api/disputes/[id]/workspace/route.ts",
  "lib/disputes/presentation/",
  "lib/disputes/workspacePayload/",
];

export const PATTERN_SPECS: Record<ScanPattern, PatternSpec> = {
  "literal:no_return_initiated": { re: /["'`]no_return_initiated["'`]/g, scope: ALL_ROOTS, allow: [] },
  "literal:noReturn": { re: /["'`]noReturn["'`]/g, scope: ALL_ROOTS, allow: [] },
  // string literal "returnStatus" OR property access .returnStatus / ?.returnStatus
  returnStatus: { re: /["'`]returnStatus["'`]|\.returnStatus\b/g, scope: ALL_ROOTS, allow: [] },
  // .select("...checklist_v2...") raw checklist column read
  "select:checklist_v2": { re: /\.select\(\s*["'`][^"'`]*checklist_v2/g, scope: ALL_ROOTS, allow: [] },
  "totals.refunded": { re: /\btotals\??\.refunded\b/g, scope: ALL_ROOTS, allow: [] },
  savedToShopifyAt: { re: /\bsavedToShopifyAt\b/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
  "appliedRule.mode": { re: /appliedRule\??\.mode/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
  "orderSituation.refund": { re: /orderSituation\??\.refund\b/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
  "bankIncludedFacts(": { re: /\bbankIncludedFacts\(/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
  FACT_CATEGORY_FIELD: { re: /\bFACT_CATEGORY_FIELD\b/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
  DELIVERY_CONFIRMED: { re: /\bDELIVERY_CONFIRMED\b/g, scope: DISPUTE_PAGE_SCOPE, allow: OWNERS },
};

export const PATTERNS: Record<ScanPattern, RegExp> = Object.fromEntries(
  Object.entries(PATTERN_SPECS).map(([k, v]) => [k, v.re]),
) as Record<ScanPattern, RegExp>;

/** Patterns added by plan 3.4: their baseline entries are classified `open` (names the removing PR) or `allowed`. */
export const OWNER_BYPASS_PATTERNS: readonly ScanPattern[] = [
  "savedToShopifyAt",
  "appliedRule.mode",
  "orderSituation.refund",
  "bankIncludedFacts(",
  "FACT_CATEGORY_FIELD",
  "DELIVERY_CONFIRMED",
];

const within = (rel: string, paths: readonly string[]) =>
  paths.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

const EXCLUDED_DIRS = new Set(["__tests__", "node_modules", ".next", "messages"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/** Remove // and /* *\/ comments so prose mentions are not counted as reads. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Count pattern hits in one source string. Returns only patterns with count > 0.
 * With `relPath`, each pattern applies only inside its scope and outside its
 * owner allow-list; without it (scanner unit tests) every pattern applies.
 */
export function scanSource(src: string, relPath?: string): Partial<Record<ScanPattern, number>> {
  const code = stripComments(src);
  const out: Partial<Record<ScanPattern, number>> = {};
  for (const [name, spec] of Object.entries(PATTERN_SPECS) as [ScanPattern, PatternSpec][]) {
    if (relPath !== undefined && (!within(relPath, spec.scope) || within(relPath, spec.allow))) continue;
    const n = (code.match(new RegExp(spec.re.source, spec.re.flags)) ?? []).length;
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
    const hits = scanSource(fs.readFileSync(f, "utf8"), rel);
    for (const [p, n] of Object.entries(hits)) out[`${rel}::${p}`] = n as number;
  }
  return out;
}
