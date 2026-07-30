#!/usr/bin/env node
/**
 * Non-interactive production migration push — the agent-executable path.
 *
 * WHY THIS EXISTS. `scripts/db-push-prod.mjs` is the normal route and it
 * refuses a non-TTY stdout by design, so an AI agent (whose stdout is always
 * piped) cannot run it. CLAUDE.md #1 nonetheless requires the agent to apply
 * migrations itself and forbids handing them back to the maintainer, naming
 * `npm run db:migrate:script` as the fallback. That fallback is NOT usable
 * here, for three reasons found on 2026-07-30:
 *
 *   1. `scripts/run-migration.mjs` loads `.env.local` and `.env` only. On this
 *      machine `.env.local` holds the DEV Postgres URI
 *      (db.vrpkgudqmpyunekrkpnc), so a "prod" run would have silently written
 *      to dev — precisely the Sev-1 CLAUDE.md #0 exists to prevent.
 *   2. It tracks applied files in its own `_migrations` table, not
 *      `supabase_migrations.schema_migrations`. It would therefore consider
 *      all ~160 historical migrations pending and re-run them, and afterwards
 *      the Supabase CLI would still report the new ones as unapplied.
 *   3. It catches a failure, logs it, and CONTINUES to the next file. The
 *      pending set here is a bracketed sequence (snapshot → collapse →
 *      restore); continuing past a failure is exactly the half-repair the
 *      bracket was written to prevent.
 *
 * So this script does the same job with those three holes closed. It is
 * deliberately narrow: an explicit hardcoded file list, an explicit target
 * assertion, and a hard stop on the first error.
 *
 * Usage:
 *   APP_ENV=production node scripts/push-prod-migrations-noninteractive.mjs --confirm="yes push to prod"
 *
 * Guarantees:
 *   - Loads `.env.production.local` ONLY. Never `.env.local`.
 *   - Asserts the connection host carries the known prod ref before connecting.
 *   - Runs the listed files IN ORDER, exactly as written (four of the five
 *     manage their own BEGIN/COMMIT and RAISE rather than half-commit, so
 *     they must not be wrapped in an outer transaction).
 *   - ABORTS the whole sequence on the first failure. No "continue anyway".
 *   - Records each success in `supabase_migrations.schema_migrations`, the
 *     ledger the Supabase CLI reads, so `migration list` stays truthful.
 *   - Appends to the prod release log, preserving db-push-prod.mjs's
 *     "never skip the release-log" guarantee.
 */

import pg from "pg";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

const PROD_REF = "aokhplydttxtebvbeuzc";
const CONFIRM_PHRASE = "yes push to prod";
const RELEASE_LOG = "docs/runbooks/prod-release-log.md";

/** Explicit and ordered. Not a directory scan — order is the whole point. */
const MIGRATIONS = [
  "20260727110000_snapshot_setup_rules_pre_collapse.sql",
  "20260727120000_collapse_setup_rules_to_store_switch.sql",
  "20260728160000_subscription_cancelled_spelling.sql",
  "20260729010000_convert_legacy_setup_rules_to_groups.sql",
  "20260729020000_restore_live_group_rules_after_collapse.sql",
];

function die(msg) {
  console.error(`\n[push-prod] ${msg}\n`);
  process.exit(1);
}

if (process.env.APP_ENV !== "production") {
  die(`APP_ENV is "${process.env.APP_ENV || "(unset)"}". Refusing. Re-run with APP_ENV=production.`);
}

const confirmArg = process.argv.find((a) => a.startsWith("--confirm="));
const confirm = confirmArg ? confirmArg.slice("--confirm=".length).replace(/^"|"$/g, "") : "";
if (confirm !== CONFIRM_PHRASE) {
  die(`--confirm must be exactly "${CONFIRM_PHRASE}". Got: "${confirm}"`);
}

// ONLY the production env file. Loading .env.local here is the bug this
// script exists to avoid.
const prodEnv = {};
loadEnv({ path: resolve(process.cwd(), ".env.production.local"), processEnv: prodEnv, quiet: true });

const pgUrl = prodEnv.SUPABASE_URL_POSTGRES;
if (!pgUrl) die("SUPABASE_URL_POSTGRES not found in .env.production.local");

const parsed = pgUrl.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
if (!parsed) die("Could not parse SUPABASE_URL_POSTGRES");

const [, user, rawPw, host, port, database] = parsed;
if (!host.includes(PROD_REF)) {
  die(`Connection host is "${host}", which does not carry the known prod ref ${PROD_REF}. REFUSING.`);
}

let password;
try {
  password = decodeURIComponent(rawPw);
} catch {
  password = rawPw;
}

const client = new pg.Client({
  host,
  port: Number.parseInt(port, 10),
  database,
  user,
  password,
  ssl: { rejectUnauthorized: false },
});

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim().slice(0, 7);
const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const startedAt = new Date().toISOString();

const applied = [];
let failure = null;

console.log(`\n  Target : ${host}`);
console.log(`  Repo   : ${gitSha} on ${branch}`);
console.log(`  Files  : ${MIGRATIONS.length}\n`);

await client.connect();

try {
  const { rows } = await client.query(
    "select version from supabase_migrations.schema_migrations order by version desc limit 1",
  );
  console.log(`  Remote latest before push: ${rows[0]?.version ?? "(none)"}\n`);

  for (const file of MIGRATIONS) {
    const version = file.match(/^(\d+)_/)[1];
    const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");

    const { rows: already } = await client.query(
      "select 1 from supabase_migrations.schema_migrations where version = $1",
      [version],
    );
    if (already.length > 0) {
      console.log(`  SKIP  ${file} (already in ledger)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  RUN   ${file} ... `);
    try {
      // As written. Four of these carry their own BEGIN/COMMIT and RAISE on a
      // half-repair; an outer transaction would nest and break that contract.
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
        [version, name],
      );
      applied.push(file);
      console.log("OK");
    } catch (err) {
      console.log("FAILED");
      failure = { file, message: err.message };
      // HARD STOP. The pending set is a bracketed sequence; continuing past a
      // failure is the half-repair the bracket exists to prevent.
      break;
    }
  }
} finally {
  await client.end();
}

const finishedAt = new Date().toISOString();
appendFileSync(
  resolve(process.cwd(), RELEASE_LOG),
  `

### ${finishedAt} — prod migration push ${failure ? "FAILED" : "SUCCEEDED"} (non-interactive)

- **Route:** \`scripts/push-prod-migrations-noninteractive.mjs\` — \`db-push-prod.mjs\` is TTY-only and cannot be run by an agent; \`run-migration.mjs\` resolves to the DEV database from \`.env.local\` and does not stop on failure. See that script's header.
- **Target ref:** \`${PROD_REF}\`
- **Git SHA:** \`${gitSha}\` (${branch})
- **Started:** ${startedAt}
- **Applied (${applied.length}):**
${applied.length ? applied.map((f) => `  - ${f}`).join("\n") : "  - none"}
${failure ? `- **FAILED ON:** ${failure.file}\n- **Error:** ${failure.message}\n- **NEXT STEPS:** Sequence aborted at the failure; later migrations were NOT attempted. Consult docs/runbooks/prod-rollback.md before re-running.` : "- **Status:** all listed migrations applied in order"}
`,
);

console.log(`\n  Applied ${applied.length}/${MIGRATIONS.length}. Release log updated.\n`);
if (failure) {
  console.error(`  ABORTED on ${failure.file}: ${failure.message}\n`);
  process.exit(1);
}
