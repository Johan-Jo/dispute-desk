/**
 * Run supabase/seed.sql against the database.
 * Uses SUPABASE_URL_POSTGRES from .env.local.
 *
 * Usage: node scripts/run-seed.mjs
 */

import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const { Client } = pg;

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    console.error(".env.local not found");
    process.exit(1);
  }
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

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL_POSTGRES;
  if (!url) {
    console.error("SUPABASE_URL_POSTGRES not set in .env.local");
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected. Running supabase/seed.sql ...");

  const seedPath = join(process.cwd(), "supabase", "seed.sql");
  const sql = readFileSync(seedPath, "utf-8");
  await client.query(sql);
  await client.end();
  console.log("Seed completed (shop + disputes).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
