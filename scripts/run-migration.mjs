import pg from "pg";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const { Client } = pg;

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    vars[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return vars;
}

const env = loadEnv();
const pgUrl = env.SUPABASE_URL_POSTGRES;
if (!pgUrl) {
  console.error("SUPABASE_URL_POSTGRES not found in .env.local");
  process.exit(1);
}

// Parse the connection string manually to handle special characters in password
const match = pgUrl.match(
  /postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)/
);
if (!match) {
  console.error("Could not parse SUPABASE_URL_POSTGRES");
  process.exit(1);
}

const client = new Client({
  host: match[3],
  port: parseInt(match[4], 10),
  database: match[5],
  user: match[1],
  password: match[2],
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
