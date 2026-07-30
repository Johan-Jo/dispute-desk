import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

const { Client } = pg;

/**
 * Known project refs, so a resolved connection can be checked against the
 * target the caller actually asked for. Same values as CLAUDE.md §0 and
 * scripts/guard-db-target.mjs.
 */
const KNOWN_REFS = {
  prod: "aokhplydttxtebvbeuzc",
  dev: "vrpkgudqmpyunekrkpnc",
};

/**
 * `--target=dev|prod` is REQUIRED.
 *
 * Until 2026-07-30 this script loaded `.env.local` unconditionally and ran
 * whatever it found. On a machine where `.env.local` holds the DEV URI — the
 * normal setup — an operator following CLAUDE.md §1's "use db:migrate:script
 * for prod when the CLI can't" would have silently migrated DEV while
 * believing they were on prod. That is the exact Sev-1 §0 exists to prevent,
 * sitting inside the remedy §1 recommends. Caught during the 2026-07-30 prod
 * release, before it was run.
 *
 * The target now selects the env file AND is asserted against the resolved
 * host, so a mismatch is a hard failure rather than a silent wrong-DB write.
 */
const targetArg = process.argv.find((a) => a.startsWith("--target="));
const target = targetArg ? targetArg.slice("--target=".length) : null;
if (!target || !(target in KNOWN_REFS)) {
  console.error(
    "\n[run-migration] --target=dev|prod is required.\n\n" +
      "  This script used to default to .env.local, which on most machines is DEV.\n" +
      "  Naming the target explicitly is what stops a prod migration landing on dev.\n\n" +
      "  Examples:\n" +
      "    node scripts/run-migration.mjs --target=dev\n" +
      "    APP_ENV=production node scripts/run-migration.mjs --target=prod 20260729\n",
  );
  process.exit(1);
}

if (target === "prod" && process.env.APP_ENV !== "production") {
  console.error(
    "\n[run-migration] --target=prod also requires APP_ENV=production. Refusing.\n",
  );
  process.exit(1);
}

// Load ONLY the env file matching the requested target.
config({
  path: join(process.cwd(), target === "prod" ? ".env.production.local" : ".env.local"),
});
config({ path: join(process.cwd(), ".env") });

/**
 * SUPABASE_URL is the API URL (https://<ref>.supabase.co), not Postgres.
 * Either set SUPABASE_URL_POSTGRES (full URI), or SUPABASE_URL + SUPABASE_DB_PASSWORD.
 */
function resolvePostgresUrl() {
  const direct = process.env.SUPABASE_URL_POSTGRES;
  if (direct) return direct;

  const apiUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!apiUrl || !dbPassword) return null;

  const m = apiUrl.trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!m) return null;
  const ref = m[1];
  const user = "postgres";
  const host = `db.${ref}.supabase.co`;
  const port = 5432;
  const database = "postgres";
  const encoded = encodeURIComponent(dbPassword);
  return `postgresql://${user}:${encoded}@${host}:${port}/${database}`;
}

const pgUrl = resolvePostgresUrl();
if (!pgUrl) {
  console.error(
    "Database URL not configured. Use one of:\n" +
      "  • SUPABASE_URL_POSTGRES=postgresql://… (URI from Supabase → Database → Connection string), or\n" +
      "  • SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_DB_PASSWORD (database password from the same page).\n" +
      "See .env.example.",
  );
  process.exit(1);
}

// Parse the connection string manually to handle special characters in password
const match = pgUrl.match(
  /^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/,
);
if (!match) {
  console.error("Could not parse Postgres connection string");
  process.exit(1);
}

// The assertion that makes --target load-bearing rather than decorative: the
// host we are about to connect to must carry the ref for the target the caller
// named. Without this, a stale or hand-edited env file silently wins.
const expectedRef = KNOWN_REFS[target];
if (!match[3].includes(expectedRef)) {
  console.error(
    `\n[run-migration] --target=${target} expects ref ${expectedRef}, but the resolved ` +
      `host is "${match[3]}".\n\n` +
      `  Refusing to run. Fix the connection string in ` +
      `${target === "prod" ? ".env.production.local" : ".env.local"}, or correct --target.\n`,
  );
  process.exit(1);
}
console.log(`[run-migration] target=${target} host=${match[3]} — ref matches. Proceeding.`);

let rawPassword = match[2];
try {
  rawPassword = decodeURIComponent(match[2]);
} catch {
  rawPassword = match[2];
}

const client = new Client({
  host: match[3],
  port: parseInt(match[4], 10),
  database: match[5],
  user: match[1],
  password: rawPassword,
  ssl: { rejectUnauthorized: false },
});

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const filter = process.argv[2] || null;

async function run() {
  await client.connect();
  console.log("Connected to Supabase Postgres");

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await client.query("SELECT name FROM _migrations");
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (filter && !file.startsWith(filter)) continue;
    if (appliedSet.has(file)) {
      console.log(`  SKIP  ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`  RUN   ${file} ...`);
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      console.log(`  OK    ${file}`);
    } catch (err) {
      // ABORT, never continue. Migrations are frequently ordered — the
      // 2026-07-30 prod set was a snapshot → collapse → restore bracket where
      // running the collapse and skipping the restore switches off live
      // merchants' automation. Continuing past a failure produces exactly the
      // half-applied state the bracket exists to prevent.
      console.error(`  FAIL  ${file}: ${err.message}`);
      console.error(
        `\n[run-migration] ABORTED at ${file}. Later migrations were NOT attempted.\n` +
          `  Verify remote state before re-running — see docs/runbooks/prod-rollback.md.\n`,
      );
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
