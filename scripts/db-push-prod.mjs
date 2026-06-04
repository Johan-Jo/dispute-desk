#!/usr/bin/env node
/**
 * Manual production database migration push.
 *
 * Usage:
 *   APP_ENV=production npm run db:push:prod
 *
 * Or directly:
 *   APP_ENV=production node scripts/db-push-prod.mjs
 *
 * What it does:
 *   1. Refuses to start unless APP_ENV=production.
 *   2. Confirms the linked Supabase project (reads supabase/.temp/linked-project.json).
 *   3. Lists migrations that have NOT yet been applied on the prod project.
 *   4. Prints the expected delta and waits for the operator to type a
 *      specific confirmation phrase.
 *   5. Runs `supabase db push --linked` against the prod project.
 *   6. Appends an entry to docs/runbooks/prod-release-log.md with timestamp,
 *      git SHA, and the migration filenames that were applied.
 *
 * Hard guarantees:
 *   - Will NEVER run against a non-prod project (linked-project ref must match
 *     the known prod ref recorded here).
 *   - Will NEVER run via CI (the confirmation prompt is interactive — TTY-only).
 *   - Will NEVER skip the release-log append step (logged BEFORE the push, then
 *     finalized with the outcome).
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §9.3.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { config as loadEnv } from "dotenv";

// ─── Constants ─────────────────────────────────────────────────────────

// Known prod project refs over time. The CURRENT one is whatever is at
// position 0. Older refs are kept here so this script recognizes the
// "old → new" transition after the Pro migration cutover without
// requiring a code change at the moment of cutover.
//
// To rotate: prepend the new ref at the top of this array AS PART OF
// THE CUTOVER COMMIT. The script then accepts both during the cutover
// holdback period, and you can drop the old one in a follow-up.
const KNOWN_PROD_PROJECT_REFS = [
  "aokhplydttxtebvbeuzc", // current prod (Pro tier, post-2026-05-28 cutover)
  // Legacy Free-tier prod ref `sddzuglxdnkhcnjmcpbj` dropped 2026-06-04 —
  // the cutover holdback period is long over and that project is now an idle
  // leftover, NOT dev (dev runs on `vrpkgudqmpyunekrkpnc`). Keeping it here
  // would wrongly let a prod migration push target the dead project.
];

const RELEASE_LOG = "docs/runbooks/prod-release-log.md";
const CONFIRM_PHRASE = "yes push to prod";

// ─── Pre-flight checks ─────────────────────────────────────────────────

loadEnv({ path: resolve(process.cwd(), ".env.production.local"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

if (process.env.APP_ENV !== "production") {
  die(
    `APP_ENV is "${process.env.APP_ENV || "(unset)"}". This script writes to production and refuses to run ` +
      `without APP_ENV=production set explicitly. Re-run as:\n\n` +
      `  APP_ENV=production npm run db:push:prod\n`,
  );
}

if (!process.stdout.isTTY) {
  die(
    `STDOUT is not a TTY. This script requires an interactive terminal — running it via CI / cron / ` +
      `piped output is forbidden. Re-run from a real terminal.`,
  );
}

const linkedPath = resolve(process.cwd(), "supabase/.temp/linked-project.json");
if (!existsSync(linkedPath)) {
  die(
    `supabase/.temp/linked-project.json not found. Run \`npx supabase link --project-ref <ref>\` against ` +
      `the prod project first, then re-run this script.`,
  );
}

const linked = JSON.parse(readFileSync(linkedPath, "utf8"));
const linkedRef = linked.ref;
if (!KNOWN_PROD_PROJECT_REFS.includes(linkedRef)) {
  die(
    `Linked Supabase project ref is "${linkedRef}", which is NOT in the known-prod list ` +
      `(${KNOWN_PROD_PROJECT_REFS.join(", ")}). Either:\n` +
      `  - You're linked to the wrong project: re-link with \`npx supabase link --project-ref <prod-ref>\`\n` +
      `  - The prod ref rotated (cutover): update KNOWN_PROD_PROJECT_REFS in this script first.\n`,
  );
}

// ─── Compute migration delta (local vs remote) ─────────────────────────

const localMigrations = readdirSync(resolve(process.cwd(), "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

let remoteRaw = "";
try {
  remoteRaw = execSync("npx supabase migration list --linked", {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
} catch (err) {
  die(
    `Failed to list remote migrations: ${err.message}\n` +
      `Common cause: not logged in (run \`npx supabase login\` first) or DB password not set.`,
  );
}

// Parse the remote migration list (CLI prints a table; we just need the version strings)
const remoteVersions = new Set(
  remoteRaw
    .split("\n")
    .map((l) => l.trim().match(/^[│|]?\s*(\d{14}|\d{3})\s/))
    .filter(Boolean)
    .map((m) => m[1]),
);

// Local migration "version" = the leading digits of the filename
function versionOf(filename) {
  const m = filename.match(/^(\d+)_/);
  return m ? m[1] : null;
}

const pendingFiles = localMigrations.filter((f) => {
  const v = versionOf(f);
  return v && !remoteVersions.has(v);
});

// ─── Print summary + confirmation prompt ───────────────────────────────

const gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const isoNow = new Date().toISOString();

console.log("");
console.log("═".repeat(72));
console.log("  PROD DATABASE MIGRATION PUSH");
console.log("═".repeat(72));
console.log("");
console.log(`  Target Supabase project: ${linkedRef}`);
console.log(`  Local repo state:        ${gitSha.slice(0, 7)} on ${branch}`);
console.log(`  UTC timestamp:           ${isoNow}`);
console.log(`  Local migrations total:  ${localMigrations.length}`);
console.log(`  Already applied (remote): ${remoteVersions.size}`);
console.log(`  Pending to push:         ${pendingFiles.length}`);
console.log("");

if (pendingFiles.length === 0) {
  console.log("  Nothing to push — prod is already at HEAD. Exiting.");
  console.log("");
  process.exit(0);
}

console.log("  Migrations that will be applied:");
for (const f of pendingFiles) console.log(`    + ${f}`);
console.log("");

if (branch !== "master") {
  console.log(`  ⚠  You are on branch "${branch}", not master.`);
  console.log(`     Production migrations are normally pushed from master after a PR merge.`);
  console.log("");
}

console.log(`  Type exactly:  ${CONFIRM_PHRASE}`);
console.log(`  Anything else aborts.`);
console.log("");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((res) => rl.question("> ", res));
rl.close();

if (answer.trim() !== CONFIRM_PHRASE) {
  console.log("");
  console.log("  Aborted. No migrations were pushed.");
  console.log("");
  process.exit(1);
}

// ─── Append release-log "starting" entry BEFORE the push ───────────────

const logEntryStart = `

### ${isoNow} — db:push:prod started

- **Operator:** $(git config user.name || echo $USER)
- **Target ref:** \`${linkedRef}\`
- **Git SHA:** \`${gitSha.slice(0, 7)}\` (${branch})
- **Pending migrations (${pendingFiles.length}):**
${pendingFiles.map((f) => `  - ${f}`).join("\n")}
- **Status:** STARTED (will be amended with outcome after push)
`;
appendFileSync(resolve(process.cwd(), RELEASE_LOG), logEntryStart);

// ─── Run supabase db push --linked ─────────────────────────────────────

console.log("");
console.log("  Running: npx supabase db push --linked --yes --include-all");
console.log("");

const child = spawn("npx", ["supabase", "db", "push", "--linked", "--yes", "--include-all"], {
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => {
  const finishedAt = new Date().toISOString();
  const outcomeEntry = `

### ${finishedAt} — db:push:prod ${code === 0 ? "SUCCEEDED" : "FAILED"}

- **Target ref:** \`${linkedRef}\`
- **Git SHA:** \`${gitSha.slice(0, 7)}\`
- **Migrations applied:** ${pendingFiles.length}
${pendingFiles.map((f) => `  - ${f}`).join("\n")}
- **Exit code:** ${code}
${code !== 0 ? "- **NEXT STEPS:** Consult docs/runbooks/prod-rollback.md immediately. Do NOT re-run this script without first verifying remote state — partial pushes leave the DB in an intermediate state." : ""}
`;
  appendFileSync(resolve(process.cwd(), RELEASE_LOG), outcomeEntry);
  console.log("");
  console.log(`  Release log entry appended to ${RELEASE_LOG}`);
  console.log("");
  process.exit(code);
});

// ─── helpers ────────────────────────────────────────────────────────────

function die(msg) {
  console.error("");
  console.error("[db-push-prod] " + msg);
  console.error("");
  process.exit(1);
}
