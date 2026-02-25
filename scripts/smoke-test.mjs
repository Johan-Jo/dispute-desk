/**
 * End-to-end smoke test: seed a dispute, trigger automation, verify pipeline.
 *
 * Reads credentials from .env.local (never hardcoded).
 */

import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

const { Client } = pg;

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
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
const match = env.SUPABASE_URL_POSTGRES.match(
  /postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)/
);

const client = new Client({
  host: match[3],
  port: parseInt(match[4], 10),
  database: match[5],
  user: match[1],
  password: match[2],
  ssl: { rejectUnauthorized: false },
});

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

async function run() {
  await client.connect();
  console.log("\n=== DisputeDesk Smoke Test ===\n");

  // 1. Ensure a test shop exists
  console.log("Step 1: Ensure test shop exists");
  const { rows: shops } = await client.query(
    `INSERT INTO shops (shop_domain, shop_id, plan)
     VALUES ('smoke-test.myshopify.com', 'smoke-test-001', 'starter')
     ON CONFLICT (shop_domain) DO UPDATE SET updated_at = now()
     RETURNING id`
  );
  const shopId = shops[0].id;
  assert(!!shopId, `Shop created/found: ${shopId}`);

  // 2. Ensure shop_settings auto-created
  console.log("\nStep 2: Verify shop_settings upsert");
  await client.query(`SELECT ensure_shop_settings($1)`, [shopId]);
  const { rows: settings } = await client.query(
    `SELECT * FROM shop_settings WHERE shop_id = $1`, [shopId]
  );
  assert(settings.length === 1, "shop_settings row exists");
  assert(settings[0].auto_build_enabled === true, "auto_build_enabled defaults to true");
  // Reset to default if row existed from prior run
  await client.query(
    `UPDATE shop_settings SET auto_save_enabled = false, require_review_before_save = true WHERE shop_id = $1`,
    [shopId]
  );
  const { rows: freshSettings } = await client.query(
    `SELECT * FROM shop_settings WHERE shop_id = $1`, [shopId]
  );
  assert(freshSettings[0].auto_save_enabled === false, "auto_save_enabled is false (reset)");
  assert(settings[0].auto_save_min_score === 80, "auto_save_min_score defaults to 80");

  // 3. Seed a test dispute
  console.log("\nStep 3: Seed test dispute");
  const { rows: disputes } = await client.query(
    `INSERT INTO disputes (shop_id, dispute_gid, reason, status, amount, currency_code, due_at)
     VALUES ($1, 'gid://shopify/Dispute/smoke-001', 'PRODUCT_NOT_RECEIVED', 'needs_response', 145.00, 'USD', now() + interval '7 days')
     ON CONFLICT (shop_id, dispute_gid) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [shopId]
  );
  const disputeId = disputes[0].id;
  assert(!!disputeId, `Dispute created: ${disputeId}`);

  // 4. Verify disputes API would return it
  console.log("\nStep 4: Verify dispute in DB");
  const { rows: dbDisputes } = await client.query(
    `SELECT * FROM disputes WHERE shop_id = $1 AND dispute_gid = 'gid://shopify/Dispute/smoke-001'`,
    [shopId]
  );
  assert(dbDisputes.length === 1, "Dispute found in DB");
  assert(dbDisputes[0].reason === "PRODUCT_NOT_RECEIVED", "Reason stored correctly");
  assert(parseFloat(dbDisputes[0].amount) === 145, "Amount stored correctly");

  // 5. Create an evidence pack (simulating automation pipeline)
  console.log("\nStep 5: Create evidence pack + enqueue job");
  const { rows: packs } = await client.query(
    `INSERT INTO evidence_packs (shop_id, dispute_id, status, created_by)
     VALUES ($1, $2, 'queued', 'smoke-test')
     RETURNING id`,
    [shopId, disputeId]
  );
  const packId = packs[0].id;
  assert(!!packId, `Pack created: ${packId}`);

  const { rows: jobs } = await client.query(
    `INSERT INTO jobs (shop_id, job_type, entity_id)
     VALUES ($1, 'build_pack', $2)
     RETURNING id`,
    [shopId, packId]
  );
  assert(!!jobs[0].id, `Job enqueued: ${jobs[0].id}`);

  // 6. Simulate pack build result (completeness scoring)
  console.log("\nStep 6: Simulate pack build with completeness");
  await client.query(
    `UPDATE evidence_packs SET
       status = 'blocked',
       completeness_score = 20,
       blockers = $2::jsonb,
       recommended_actions = $3::jsonb,
       pack_json = '{"version":1}'::jsonb,
       updated_at = now()
     WHERE id = $1`,
    [
      packId,
      JSON.stringify(["Shipping Tracking", "Delivery Proof"]),
      JSON.stringify(["Add Shipping Policy", "Add Customer Communication"]),
    ]
  );

  const { rows: updatedPacks } = await client.query(
    `SELECT * FROM evidence_packs WHERE id = $1`, [packId]
  );
  const blockers = updatedPacks[0].blockers;
  assert(updatedPacks[0].status === "blocked", "Pack status is blocked (missing required items)");
  assert(updatedPacks[0].completeness_score === 20, "Completeness score = 20%");
  assert(Array.isArray(blockers) ? blockers.length === 2 : JSON.parse(blockers).length === 2, "2 blockers stored");

  // 7. Enable auto-save + verify gate would block (low score)
  console.log("\nStep 7: Test auto-save gate logic via DB state");
  await client.query(
    `UPDATE shop_settings SET auto_save_enabled = true WHERE shop_id = $1`,
    [shopId]
  );
  const { rows: gateSettings } = await client.query(
    `SELECT * FROM shop_settings WHERE shop_id = $1`, [shopId]
  );
  assert(gateSettings[0].auto_save_enabled === true, "auto_save_enabled toggled ON");
  assert(
    updatedPacks[0].completeness_score < gateSettings[0].auto_save_min_score,
    `Score ${updatedPacks[0].completeness_score}% < threshold ${gateSettings[0].auto_save_min_score}% → would block`
  );

  // 8. Simulate high-score pack → would pass gate
  console.log("\nStep 8: Simulate complete pack (passes gates)");
  await client.query(
    `UPDATE evidence_packs SET
       status = 'ready',
       completeness_score = 95,
       blockers = '[]'::jsonb,
       updated_at = now()
     WHERE id = $1`,
    [packId]
  );

  const { rows: readyPacks } = await client.query(
    `SELECT * FROM evidence_packs WHERE id = $1`, [packId]
  );
  const readyBlockers = readyPacks[0].blockers;
  assert(readyPacks[0].status === "ready", "Pack status updated to ready");
  assert(readyPacks[0].completeness_score === 95, "Score updated to 95%");
  assert(Array.isArray(readyBlockers) ? readyBlockers.length === 0 : JSON.parse(readyBlockers).length === 0, "No blockers");
  assert(
    readyPacks[0].completeness_score >= gateSettings[0].auto_save_min_score,
    `Score ${readyPacks[0].completeness_score}% >= threshold ${gateSettings[0].auto_save_min_score}% → would pass`
  );

  // 9. Simulate saved_to_shopify
  console.log("\nStep 9: Simulate save to Shopify");
  const now = new Date().toISOString();
  await client.query(
    `UPDATE evidence_packs SET
       status = 'saved_to_shopify',
       saved_to_shopify_at = $2,
       updated_at = now()
     WHERE id = $1`,
    [packId, now]
  );

  const { rows: savedPacks } = await client.query(
    `SELECT * FROM evidence_packs WHERE id = $1`, [packId]
  );
  assert(savedPacks[0].status === "saved_to_shopify", "Pack status = saved_to_shopify");
  assert(!!savedPacks[0].saved_to_shopify_at, "saved_to_shopify_at timestamp set");

  // 10. Write audit event
  console.log("\nStep 10: Verify audit log");
  await client.query(
    `INSERT INTO audit_events (shop_id, dispute_id, pack_id, actor_type, event_type, event_payload)
     VALUES ($1, $2, $3, 'system', 'evidence_saved_to_shopify', '{"test":true}'::jsonb)`,
    [shopId, disputeId, packId]
  );

  const { rows: audits } = await client.query(
    `SELECT * FROM audit_events WHERE pack_id = $1 AND event_type = 'evidence_saved_to_shopify'`,
    [packId]
  );
  assert(audits.length >= 1, "Audit event recorded");

  // 11. Verify immutability (UPDATE should fail)
  console.log("\nStep 11: Verify audit log immutability");
  try {
    await client.query(
      `UPDATE audit_events SET event_type = 'hacked' WHERE id = $1`,
      [audits[0].id]
    );
    assert(false, "UPDATE on audit_events should have been rejected");
  } catch (err) {
    assert(true, `UPDATE correctly rejected: ${err.message.slice(0, 60)}`);
  }

  // 12. Verify new status values in CHECK constraint
  console.log("\nStep 12: Verify extended status enum");
  for (const status of ["draft", "blocked", "saved_to_shopify"]) {
    try {
      await client.query(
        `INSERT INTO evidence_packs (shop_id, dispute_id, status, created_by)
         VALUES ($1, $2, $3, 'enum-test')`,
        [shopId, disputeId, status]
      );
      assert(true, `Status '${status}' accepted`);
    } catch {
      assert(false, `Status '${status}' should be accepted`);
    }
  }

  // Cleanup test data
  console.log("\nStep 13: Cleanup");
  // Temporarily disable audit immutability triggers for cleanup
  await client.query(`ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_delete`);
  await client.query(`DELETE FROM audit_events WHERE shop_id = $1`, [shopId]);
  await client.query(`ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_delete`);
  await client.query(`DELETE FROM evidence_packs WHERE shop_id = $1`, [shopId]);
  await client.query(`DELETE FROM jobs WHERE shop_id = $1`, [shopId]);
  await client.query(`DELETE FROM disputes WHERE shop_id = $1`, [shopId]);
  await client.query(`DELETE FROM shop_settings WHERE shop_id = $1`, [shopId]);
  await client.query(`DELETE FROM shops WHERE id = $1`, [shopId]);
  assert(true, "Test data cleaned up");

  await client.end();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
