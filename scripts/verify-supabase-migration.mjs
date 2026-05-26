#!/usr/bin/env node
/**
 * scripts/verify-supabase-migration.mjs
 *
 * Compares two Supabase Postgres connections and reports:
 *   - Schema parity: tables present in each project's public schema (and diff).
 *   - Data parity: row count per table.
 *
 * Used for:
 *   - Phase −1 §1 backup verification (compare prod source against the
 *     restored scratch destination on sentinel tables).
 *   - The Pro-migration cutover Step 4 (confirm restored data matches source
 *     row-for-row before flipping Vercel env vars).
 *
 * Inputs come from `.env.production.local` at the repo root (gitignored).
 * Two connection strings expected:
 *   OLD_SUPABASE_URL_POSTGRES   — source (existing prod / pre-migration)
 *   NEW_SUPABASE_URL_POSTGRES   — destination (new Pro project / restored backup)
 *
 * Override via CLI flags if needed:
 *   --source=postgresql://...     overrides OLD_SUPABASE_URL_POSTGRES
 *   --target=postgresql://...     overrides NEW_SUPABASE_URL_POSTGRES
 *   --schema-only                 skip row counts; just compare table sets
 *   --tables=t1,t2,t3             limit to a comma-separated table list
 *                                 (sentinel mode for the backup check)
 *
 * Exit codes:
 *   0  — schemas match and (unless --schema-only) row counts match exactly.
 *   1  — any mismatch or connection error.
 *
 * Reference: docs/runbooks/supabase-pro-migration.md §0.5 + Step 4.
 */

import { Client } from "pg";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.production.local");
if (existsSync(ENV_FILE)) {
  loadDotenv({ path: ENV_FILE });
} else {
  console.warn(
    `[verify-supabase-migration] ${ENV_FILE} not found — relying on shell env vars only.`,
  );
}

const args = parseArgs(process.argv.slice(2));
const source = args.source ?? process.env.OLD_SUPABASE_URL_POSTGRES;
const target = args.target ?? process.env.NEW_SUPABASE_URL_POSTGRES;
if (!source) die("missing source — set OLD_SUPABASE_URL_POSTGRES or pass --source=...");
if (!target) die("missing target — set NEW_SUPABASE_URL_POSTGRES or pass --target=...");

if (source === target) {
  die("source and target are the same connection string — refuse to verify (probably a typo).");
}

const tablesFilter = args.tables
  ? new Set(args.tables.split(",").map((t) => t.trim()).filter(Boolean))
  : null;

const schemaOnly = args["schema-only"] === true;

const SENTINEL_TABLES = ["shops", "disputes", "evidence_packs"];

async function main() {
  console.log("[verify-supabase-migration] connecting…");
  const src = new Client({ connectionString: source, ssl: { rejectUnauthorized: false } });
  const tgt = new Client({ connectionString: target, ssl: { rejectUnauthorized: false } });
  await src.connect();
  await tgt.connect();

  try {
    const srcHost = hostOf(source);
    const tgtHost = hostOf(target);
    console.log(`  source:  ${srcHost}`);
    console.log(`  target:  ${tgtHost}`);
    console.log("");

    const srcTables = await listPublicTables(src);
    const tgtTables = await listPublicTables(tgt);

    const onlyInSrc = srcTables.filter((t) => !tgtTables.includes(t));
    const onlyInTgt = tgtTables.filter((t) => !srcTables.includes(t));
    const both = srcTables.filter((t) => tgtTables.includes(t));

    if (onlyInSrc.length || onlyInTgt.length) {
      console.error(`[verify-supabase-migration] SCHEMA MISMATCH`);
      if (onlyInSrc.length) console.error(`  only in source: ${onlyInSrc.join(", ")}`);
      if (onlyInTgt.length) console.error(`  only in target: ${onlyInTgt.join(", ")}`);
      process.exit(1);
    }
    console.log(`[verify-supabase-migration] ✓ schema parity (${both.length} tables in public)`);

    if (schemaOnly) {
      console.log("[verify-supabase-migration] --schema-only specified, skipping row counts.");
      return;
    }

    const tablesToCheck = tablesFilter
      ? both.filter((t) => tablesFilter.has(t))
      : both;

    if (tablesToCheck.length === 0) {
      die("no tables to check — --tables filter excluded everything.");
    }

    console.log("");
    console.log(
      "  " +
        "table".padEnd(40) +
        "source".padStart(12) +
        "target".padStart(12) +
        "delta".padStart(10),
    );
    console.log("  " + "─".repeat(74));

    let mismatches = 0;
    for (const table of tablesToCheck) {
      const [srcCount, tgtCount] = await Promise.all([
        countRows(src, table),
        countRows(tgt, table),
      ]);
      const delta = tgtCount - srcCount;
      const ok = delta === 0;
      const flag = ok ? " " : "✗";
      const isSentinel = SENTINEL_TABLES.includes(table);
      const label = isSentinel ? `${table}  ←sentinel` : table;
      const line =
        `${flag} ` +
        label.padEnd(40) +
        String(srcCount).padStart(12) +
        String(tgtCount).padStart(12) +
        String(delta).padStart(10);
      console.log("  " + line);
      if (!ok) mismatches++;
    }

    console.log("");
    if (mismatches > 0) {
      console.error(
        `[verify-supabase-migration] ✗ ${mismatches} table${mismatches === 1 ? "" : "s"} mismatch`,
      );
      process.exit(1);
    }
    console.log("[verify-supabase-migration] ✓ all row counts match");
  } finally {
    await src.end();
    await tgt.end();
  }
}

async function listPublicTables(client) {
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_migrations', 'schema_migrations')
    ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
}

async function countRows(client, table) {
  const res = await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`);
  return Number(res.rows[0].n);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        out[a.slice(2)] = true;
      } else {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      }
    }
  }
  return out;
}

function hostOf(connStr) {
  try {
    return new URL(connStr).host;
  } catch {
    return "(unparseable)";
  }
}

function die(msg) {
  console.error(`[verify-supabase-migration] ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[verify-supabase-migration] crashed:", err.message);
  process.exit(1);
});
