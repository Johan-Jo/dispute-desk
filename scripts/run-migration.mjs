import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

const { Client } = pg;

config({ path: join(process.cwd(), ".env.local") });
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
      console.error(`  FAIL  ${file}: ${err.message}`);
    }
  }

  await client.end();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
