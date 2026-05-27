#!/usr/bin/env node
/**
 * scripts/verify-migration-parity.mjs
 *
 * Verifies the set of migrations in `supabase/migrations/` exactly
 * matches what's applied on the linked Supabase project (dev under
 * normal local workflow).
 *
 * What it catches:
 *   - A new migration file added to the repo but never `db push`ed → dev
 *     drift before the change reaches prod.
 *   - A migration applied directly on Supabase (via Dashboard SQL editor)
 *     that isn't tracked in the repo → reverse drift.
 *
 * Where it runs:
 *   - As a `release:verify` step on the developer's machine. Skips
 *     gracefully when Supabase CLI isn't linked / isn't logged in (so
 *     CI environments that don't have Supabase auth don't block the
 *     verifier).
 *
 * What it does NOT do:
 *   - Talk to production. Production migration parity is verified by
 *     `scripts/db-push-prod.mjs` at release time.
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §9.2 (items 3, 4).
 */

import { execSync } from "node:child_process";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const LINKED_PATH = resolve(process.cwd(), "supabase/.temp/linked-project.json");

function info(msg) {
  console.log(`[migration-parity] ${msg}`);
}
function warn(msg) {
  console.warn(`[migration-parity] ⚠ ${msg}`);
}
function fail(msg) {
  console.error(`[migration-parity] ✗ ${msg}`);
  process.exit(1);
}

// Pre-flight: skip cleanly if there's no linked project (CI, fresh checkout).
if (!existsSync(LINKED_PATH)) {
  info("supabase/.temp/linked-project.json not found — skipping parity check.");
  info("To run this check, link a Supabase project with `npx supabase link --project-ref <dev-ref>`.");
  process.exit(0);
}

const linkedRef = JSON.parse(readFileSync(LINKED_PATH, "utf8")).ref;

// Local migration filenames (sorted, .sql only)
const localFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function versionOf(filename) {
  // Filenames are either NNN_name.sql or YYYYMMDDHHMMSS_name.sql
  const m = filename.match(/^(\d+)_/);
  return m ? m[1] : null;
}

const localVersions = new Set();
for (const f of localFiles) {
  const v = versionOf(f);
  if (v) localVersions.add(v);
}

info(`Linked project: ${linkedRef}`);
info(`Local migration files: ${localFiles.length} (${localVersions.size} unique versions)`);

// Pull remote applied list
let remoteRaw;
try {
  remoteRaw = execSync("npx supabase migration list --linked", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch (err) {
  const stderr = err.stderr?.toString() || "";
  if (/access token|not logged in|unauthorized/i.test(stderr)) {
    warn(`Supabase CLI not logged in — skipping parity check. Run \`npx supabase login\` then retry.`);
    process.exit(0);
  }
  if (/no linked project/i.test(stderr)) {
    warn(`Linked-project file exists but CLI reports no link — skipping. Re-run \`npx supabase link --project-ref ${linkedRef}\`.`);
    process.exit(0);
  }
  fail(`\`supabase migration list --linked\` failed:\n${stderr || err.message}`);
}

const remoteVersions = new Set(
  remoteRaw
    .split("\n")
    .map((l) => l.trim().match(/^[│|]?\s*(\d{14}|\d{3})\s/))
    .filter(Boolean)
    .map((m) => m[1]),
);

info(`Remote applied versions: ${remoteVersions.size}`);

const localNotRemote = [...localVersions].filter((v) => !remoteVersions.has(v)).sort();
const remoteNotLocal = [...remoteVersions].filter((v) => !localVersions.has(v)).sort();

if (localNotRemote.length === 0 && remoteNotLocal.length === 0) {
  info(`✓ parity (${localVersions.size} versions match)`);
  process.exit(0);
}

console.error("");
console.error("[migration-parity] ✗ migration set drift");
if (localNotRemote.length) {
  console.error(`  ${localNotRemote.length} in repo but not applied on ${linkedRef}:`);
  for (const v of localNotRemote.slice(0, 20)) console.error(`    + ${v}`);
  if (localNotRemote.length > 20) console.error(`    … and ${localNotRemote.length - 20} more`);
  console.error("");
  console.error("  Fix: run `npm run db:migrate` to apply them to the linked project.");
}
if (remoteNotLocal.length) {
  console.error(`  ${remoteNotLocal.length} on ${linkedRef} but not in repo:`);
  for (const v of remoteNotLocal.slice(0, 20)) console.error(`    - ${v}`);
  if (remoteNotLocal.length > 20) console.error(`    … and ${remoteNotLocal.length - 20} more`);
  console.error("");
  console.error("  Fix: someone applied a migration directly via Dashboard. Pull that change");
  console.error("       into the repo as a new migration file, or remove the row from");
  console.error("       supabase_migrations.schema_migrations if the change shouldn't be tracked.");
}
console.error("");
process.exit(1);
