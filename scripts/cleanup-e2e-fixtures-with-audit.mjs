/**
 * One-shot deep cleanup for orphan E2E fixture rows + their audit_events.
 *
 * Why this exists:
 *   `audit_events` is append-only (BEFORE DELETE/UPDATE triggers raise),
 *   and its FKs to disputes/evidence_packs use NO ACTION. So the only
 *   way to remove orphan E2E fixture data fully is to temporarily disable
 *   the immutability triggers, delete in dependency order, and re-enable.
 *
 * Scope: deletes ONLY rows whose dispute_gid matches
 *   gid://shopify/ShopifyPaymentsDispute/test-<uuid>
 * (the pattern hardcoded in e2e/helpers/dbFixtures.ts).
 *
 * Wraps everything in a single transaction; if anything goes wrong the
 * triggers will be restored on rollback.
 *
 * Usage:
 *   node scripts/cleanup-e2e-fixtures-with-audit.mjs            # dry run (counts only)
 *   node scripts/cleanup-e2e-fixtures-with-audit.mjs --apply    # execute
 */
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

const TEST_GID_PATTERN = "gid://shopify/ShopifyPaymentsDispute/test-%";

const apply = process.argv.includes("--apply");

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  const vars = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    vars[t.slice(0, i)] = t.slice(i + 1);
  }
  return vars;
}

const env = loadEnv();
const url = env.SUPABASE_URL_POSTGRES;
if (!url) {
  console.error("SUPABASE_URL_POSTGRES not set");
  process.exit(1);
}

const m = url.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
if (!m) { console.error("bad SUPABASE_URL_POSTGRES"); process.exit(1); }

const client = new pg.Client({
  host: m[3],
  port: parseInt(m[4], 10),
  database: m[5],
  user: m[1],
  password: decodeURIComponent(m[2]),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected.");

try {
  await client.query("BEGIN");

  const { rows: orphans } = await client.query(
    `SELECT id, dispute_gid, amount, reason, created_at
       FROM disputes
      WHERE dispute_gid LIKE $1
      ORDER BY created_at`,
    [TEST_GID_PATTERN],
  );
  console.log(`Orphan disputes: ${orphans.length}`);
  for (const r of orphans) {
    console.log(`  ${r.dispute_gid}  amt=${r.amount}  reason=${r.reason}`);
  }
  if (!orphans.length) { await client.query("ROLLBACK"); process.exit(0); }
  const disputeIds = orphans.map(r => r.id);

  const { rows: packs } = await client.query(
    `SELECT id FROM evidence_packs WHERE dispute_id = ANY($1::uuid[])`,
    [disputeIds],
  );
  const packIds = packs.map(p => p.id);
  console.log(`Linked evidence_packs: ${packIds.length}`);

  const { rows: aeByDispute } = await client.query(
    `SELECT COUNT(*)::int AS n FROM audit_events WHERE dispute_id = ANY($1::uuid[])`,
    [disputeIds],
  );
  const { rows: aeByPack } = await client.query(
    packIds.length
      ? `SELECT COUNT(*)::int AS n FROM audit_events WHERE pack_id = ANY($1::uuid[])`
      : `SELECT 0::int AS n`,
    packIds.length ? [packIds] : [],
  );
  console.log(`audit_events (dispute_id match): ${aeByDispute[0].n}`);
  console.log(`audit_events (pack_id match):    ${aeByPack[0].n}`);

  if (!apply) {
    console.log("\nDry run — pass --apply to execute.");
    await client.query("ROLLBACK");
    process.exit(0);
  }

  console.log("\nDisabling audit_events immutability triggers…");
  await client.query(`ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_delete`);
  await client.query(`ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_update`);

  const { rowCount: aeDispDel } = await client.query(
    `DELETE FROM audit_events WHERE dispute_id = ANY($1::uuid[])`,
    [disputeIds],
  );
  console.log(`Deleted audit_events (dispute_id): ${aeDispDel}`);

  if (packIds.length) {
    const { rowCount: aePackDel } = await client.query(
      `DELETE FROM audit_events WHERE pack_id = ANY($1::uuid[])`,
      [packIds],
    );
    console.log(`Deleted audit_events (pack_id):    ${aePackDel}`);
  }

  console.log("Re-enabling audit_events triggers…");
  await client.query(`ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_delete`);
  await client.query(`ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_update`);

  const { rowCount: jobDel } = await client.query(
    packIds.length
      ? `DELETE FROM jobs WHERE entity_id = ANY($1::uuid[])`
      : `SELECT 0`,
    packIds.length ? [packIds] : undefined,
  );
  console.log(`Deleted jobs: ${jobDel ?? 0}`);

  if (packIds.length) {
    const { rowCount: pDel } = await client.query(
      `DELETE FROM evidence_packs WHERE id = ANY($1::uuid[])`,
      [packIds],
    );
    console.log(`Deleted evidence_packs: ${pDel}`);
  }

  const { rowCount: dDel } = await client.query(
    `DELETE FROM disputes WHERE id = ANY($1::uuid[])`,
    [disputeIds],
  );
  console.log(`Deleted disputes: ${dDel}`);

  // Sanity: triggers still in place?
  const { rows: trg } = await client.query(
    `SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid = 'audit_events'::regclass
        AND tgname IN ('trg_audit_no_delete','trg_audit_no_update')`,
  );
  console.log("Trigger state after re-enable:", trg);
  for (const t of trg) {
    if (t.tgenabled !== "O") {
      throw new Error(`Trigger ${t.tgname} not in 'enabled' state (tgenabled=${t.tgenabled})`);
    }
  }

  await client.query("COMMIT");
  console.log("\nCOMMIT — done.");
} catch (e) {
  console.error("ERROR:", e.message);
  try { await client.query("ROLLBACK"); console.log("Rolled back."); } catch {}
  process.exit(1);
} finally {
  await client.end();
}
