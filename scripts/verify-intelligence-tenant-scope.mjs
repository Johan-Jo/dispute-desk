#!/usr/bin/env node
/**
 * CI guard (design §4.1): the intelligence analytical layer may be reached ONLY
 * through lib/intelligence/db/tenantScope.ts (which requires a shopId). Because
 * the service role bypasses RLS, a stray `.from("intel_...")` or a direct call
 * to the audit RPC elsewhere would be an app-level tenant-isolation hole.
 *
 * Fails the build if any file other than the DAL references an intel_* view or
 * the intel_data_quality_audit RPC.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED = ["lib/intelligence/db/tenantScope.ts"];
// Patterns that must not appear outside the DAL. The migration + this script +
// design doc are excluded by directory filters below.
const FORBIDDEN = [
  /\.from\(\s*["'`]intel_(order|dispute|evidence|event)_records["'`]/,
  /\.rpc\(\s*["'`]intel_data_quality_audit["'`]/,
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "supabase", "docs", "scripts"]);
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full);
      continue;
    }
    if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
    if (ALLOWED.includes(rel)) continue;
    const src = readFileSync(full, "utf8");
    for (const pat of FORBIDDEN) {
      if (pat.test(src)) offenders.push(`${rel} :: ${pat}`);
    }
  }
}

walk(join(ROOT, "lib"));
walk(join(ROOT, "app"));

if (offenders.length > 0) {
  console.error("Intelligence tenant-scope violation — access intel_* only via lib/intelligence/db/tenantScope.ts:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("intelligence tenant-scope guard: OK (no direct intel_* access outside the DAL)");
