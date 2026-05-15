import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { gzipSync } from "node:zlib";
import { AwsClient } from "aws4fetch";

export const runtime = "nodejs";
// Vercel Pro: 300s ceiling. Free: 60s. The dump for our current
// row volume runs in under 30s.
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/db-backup
 *
 * Logical data-only backup to Cloudflare R2.
 *
 * Why this exists (and what it is NOT)
 * ------------------------------------
 * Replaces the GitHub Actions workflow that kept failing auth against
 * the Supabase pooler from runner IPs. Vercel egress is IPv6-capable
 * so we connect to the direct DB endpoint via the `pg` Node client.
 *
 * **This is NOT a `pg_dump`.** Vercel's runtime has no pg_dump binary.
 * This writes a logical, data-only SQL file:
 *
 *   - For every table in the `public` schema we own (excluding
 *     migrations + helper tables), emit a TRUNCATE + INSERT statements
 *     with all rows.
 *   - Schema (tables, indexes, functions, RLS policies) is NOT in
 *     this file. Restore recipe: spin up a fresh Supabase project,
 *     run `npm run db:migrate` against it (replays
 *     supabase/migrations/), then run `psql -f <this-dump>.sql`.
 *
 * For Free-tier Supabase this is a reasonable backup: it survives
 * a Supabase org-level compromise (separate R2 account), it has
 * 30-day retention (vs Supabase's 1-day), and the data is the part
 * that's actually expensive to lose. Code/schema lives in git.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Required env vars. Use the direct DB URL (IPv6-capable) since
  // we're in Vercel, not the pooler — same one as SUPABASE_URL_POSTGRES.
  const dbUrl = process.env.SUPABASE_URL_POSTGRES;
  if (!dbUrl) {
    return NextResponse.json(
      { error: "SUPABASE_URL_POSTGRES not set" },
      { status: 500 },
    );
  }

  const r2AccountId = process.env.R2_ACCOUNT_ID;
  const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const r2Bucket = process.env.R2_BUCKET;
  if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket) {
    return NextResponse.json(
      {
        error:
          "Missing one of R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET",
      },
      { status: 500 },
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `disputedesk-${stamp}.sql.gz`;

  // Connect to Postgres.
  const client = new Client({
    connectionString: dbUrl,
    // Supabase requires TLS; node-pg accepts plain `true` to enable
    // it and rejects only if the cert chain can't be verified.
    ssl: { rejectUnauthorized: false },
    // The DB is reachable but slow handshakes happen — give the
    // route the slack it needs without burning the whole 300s.
    connectionTimeoutMillis: 30_000,
  });

  await client.connect();

  let sql = "";
  let tableCount = 0;
  let rowCount = 0;

  try {
    // List every table in the public schema. Exclude views and the
    // internal migrations table — we re-run migrations on restore so
    // we don't need to round-trip migration history through a dump.
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('_migrations', 'schema_migrations')
      ORDER BY table_name
    `);

    sql += `-- DisputeDesk logical backup\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- Source: ${new URL(dbUrl).hostname}\n`;
    sql += `-- Tables: ${tables.rows.length}\n`;
    sql += `--\n`;
    sql += `-- Restore: into a fresh Supabase project after running\n`;
    sql += `--   npm run db:migrate (replays supabase/migrations/),\n`;
    sql += `--   then: psql "$TARGET_DB_URL" -f <this-file>.sql\n`;
    sql += `--\n\n`;
    sql += `BEGIN;\n\n`;
    // Disable triggers + FK checks during the load so we can insert
    // in any order. RESET'd at the end.
    sql += `SET session_replication_role = 'replica';\n\n`;

    for (const { table_name } of tables.rows) {
      const cols = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table_name],
      );
      const colNames = cols.rows.map((c) => `"${c.column_name}"`);
      if (colNames.length === 0) continue;

      // Quote the table name in case it ever collides with a keyword.
      const data = await client.query(
        `SELECT ${colNames.join(", ")} FROM "${table_name}"`,
      );
      tableCount++;

      sql += `-- ${table_name}: ${data.rows.length} rows\n`;
      sql += `TRUNCATE TABLE "${table_name}" CASCADE;\n`;
      if (data.rows.length === 0) {
        sql += `\n`;
        continue;
      }

      for (const row of data.rows) {
        const values = colNames.map((c) => formatValue(row[c.slice(1, -1)]));
        sql += `INSERT INTO "${table_name}" (${colNames.join(", ")}) VALUES (${values.join(", ")});\n`;
        rowCount++;
      }
      sql += `\n`;
    }

    sql += `SET session_replication_role = 'origin';\n\n`;
    sql += `COMMIT;\n`;
  } finally {
    await client.end();
  }

  const gzipped = gzipSync(Buffer.from(sql, "utf8"), { level: 9 });

  // Upload to R2 via S3-compatible API.
  const r2 = new AwsClient({
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
  const putResp = await r2.fetch(`${endpoint}/${r2Bucket}/${key}`, {
    method: "PUT",
    body: gzipped,
    headers: { "Content-Type": "application/gzip" },
  });
  if (!putResp.ok) {
    return NextResponse.json(
      { error: `R2 upload failed: ${putResp.status} ${await putResp.text()}` },
      { status: 500 },
    );
  }

  // Retention: list and delete anything older than 30 days. R2
  // supports lifecycle rules too — moving this into the bucket
  // config is a follow-up.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const listResp = await r2.fetch(
    `${endpoint}/${r2Bucket}?list-type=2&max-keys=1000`,
    { method: "GET" },
  );
  let pruned = 0;
  if (listResp.ok) {
    const body = await listResp.text();
    // Parse the S3 ListObjectsV2 XML response. Cheap regex-based —
    // R2 returns standard S3 XML and we only need <Key> + <LastModified>.
    const items = [...body.matchAll(/<Key>([^<]+)<\/Key>\s*<LastModified>([^<]+)<\/LastModified>/g)];
    for (const m of items) {
      const objKey = m[1];
      const lm = new Date(m[2]);
      if (lm < cutoff) {
        const del = await r2.fetch(`${endpoint}/${r2Bucket}/${objKey}`, {
          method: "DELETE",
        });
        if (del.ok) pruned++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    key,
    bucket: r2Bucket,
    tables: tableCount,
    rows: rowCount,
    sqlBytes: sql.length,
    gzipBytes: gzipped.byteLength,
    pruned,
  });
}

/** Format a JS value as a Postgres SQL literal. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    return Number.isFinite(v) ? String(v) : "NULL";
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  if (Array.isArray(v)) {
    // Postgres array literal: '{val,val,...}' — node-pg returns JS arrays
    // for array columns. Each element is escaped the same way.
    const inner = v.map((x) => formatArrayElem(x)).join(",");
    return `'{${inner}}'::text[]`;
  }
  if (typeof v === "object") {
    // jsonb / json columns come back as parsed JS objects.
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  // string fallback (also covers UUID, varchar, text, etc.)
  return `'${String(v).replace(/'/g, "''")}'`;
}

function formatArrayElem(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Quote and escape per Postgres array literal rules (double-quote
  // strings, escape internal quotes with \").
  return `"${String(v).replace(/"/g, '\\"')}"`;
}
