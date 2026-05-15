/**
 * Seed a synthetic HIGH-risk fulfilled FRAUDULENT dispute for end-to-end
 * testing of the Phase 2 risk-weakness cap.
 *
 * What this script does:
 *   1. Picks an existing fulfilled HIGH-risk INVESTIGATE order from
 *      shopify_orders that does NOT already have a dispute attached.
 *   2. Inserts a synthetic disputes row (SEED-prefixed GID) pointing
 *      at that order, reason = FRAUDULENT.
 *   3. Inserts a queued evidence_packs row.
 *   4. Enqueues a build_pack job.
 *
 * The production job runner (Vercel cron) then picks up the job and
 * runs buildPack → evaluateAndMaybeAutoSave. Because the surasvenne
 * FRAUDULENT rule is mode=auto and the cap fires (HIGH + INVESTIGATE +
 * fulfilled), the pack lands in park_for_review with
 * park_cause="risk_weakness". This triggers:
 *
 *   - parked_for_review audit event with park_cause: "risk_weakness"
 *   - Review email with parkReason: "risk_weakness" to team email
 *   - Embedded UI banner ("Auto-submit held — high-risk order flagged
 *     before fulfillment") above the Case Summary card
 *
 * Usage:
 *   node scripts/seed-risk-weakness-test-dispute.mjs --shop surasvenne.myshopify.com
 *   node scripts/seed-risk-weakness-test-dispute.mjs --shop-id <uuid>
 *
 * Cleanup:
 *   node scripts/seed-risk-weakness-test-dispute.mjs --shop surasvenne.myshopify.com --cleanup
 */

import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const { Client } = pg;

const WARNING_BANNER = `
⚠️  Seeding synthetic risk-weakness test dispute.
    This dispute DOES NOT exist in Shopify. SEED-prefixed GID, never mirrored.
    Triggers the Phase 2 cap; expect a review email + embedded banner.
`;

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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { shop: null, shopId: null, cleanup: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shop" && args[i + 1]) {
      out.shop = args[++i];
    } else if (args[i] === "--shop-id" && args[i + 1]) {
      out.shopId = args[++i];
    } else if (args[i] === "--cleanup") {
      out.cleanup = true;
    }
  }
  return out;
}

async function main() {
  const { shop, shopId, cleanup } = parseArgs();
  if (!shop && !shopId) {
    console.error("Usage: --shop <domain> or --shop-id <uuid>");
    process.exit(1);
  }

  const env = loadEnv();
  const url = env.SUPABASE_URL_POSTGRES;
  if (!url) {
    console.error("SUPABASE_URL_POSTGRES not set in .env.local");
    process.exit(1);
  }

  if (!cleanup) console.warn(WARNING_BANNER);

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    let resolvedShopId;
    if (shopId) {
      const { rows } = await client.query("SELECT id FROM shops WHERE id = $1", [shopId]);
      if (rows.length === 0) throw new Error(`Shop not found: ${shopId}`);
      resolvedShopId = rows[0].id;
    } else {
      const { rows } = await client.query("SELECT id FROM shops WHERE shop_domain = $1", [shop]);
      if (rows.length === 0) throw new Error(`Shop not found: ${shop}`);
      resolvedShopId = rows[0].id;
    }

    if (cleanup) {
      // Cleanup any prior risk-weakness test rows. We tag the dispute
      // with a recognisable marker in dispute_gid so cleanup is safe.
      const { rows: ds } = await client.query(
        `SELECT id FROM disputes WHERE shop_id = $1 AND dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/SEED-rw-test-%'`,
        [resolvedShopId],
      );
      const disputeIds = ds.map((r) => r.id);
      if (disputeIds.length === 0) {
        console.log("No risk-weakness test disputes to clean up.");
        return;
      }
      // Soft cleanup: audit_events is append-only and protects its
      // pack_id / dispute_id FKs, so we cannot hard-delete. Instead
      // archive the pack and close the dispute so they disappear
      // from active dashboards while preserving the audit trail.
      await client.query(
        `DELETE FROM jobs WHERE entity_id IN (SELECT id::text FROM evidence_packs WHERE dispute_id = ANY($1))`,
        [disputeIds],
      );
      await client.query(
        `UPDATE evidence_packs SET status = 'archived', updated_at = now() WHERE dispute_id = ANY($1)`,
        [disputeIds],
      );
      const { rowCount } = await client.query(
        `UPDATE disputes SET status = 'lost', updated_at = now() WHERE id = ANY($1)`,
        [disputeIds],
      );
      console.log(
        `Soft-cleaned ${rowCount} risk-weakness test dispute(s): pack archived, dispute marked lost. Audit trail preserved.`,
      );
      return;
    }

    // Find a candidate fulfilled HIGH-risk INVESTIGATE order with no existing dispute.
    const { rows: orders } = await client.query(
      `SELECT so.shopify_order_id, so.order_total, so.currency, so.fulfilled_at
       FROM shopify_orders so
       WHERE so.shop_id = $1
         AND so.risk_level_initial = 'HIGH'
         AND so.risk_recommendation_initial = 'INVESTIGATE'
         AND so.fulfilled_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM disputes d
           WHERE d.shop_id = so.shop_id AND d.order_gid = so.shopify_order_id
         )
       ORDER BY so.fulfilled_at DESC
       LIMIT 1`,
      [resolvedShopId],
    );
    if (orders.length === 0) {
      throw new Error("No fulfilled HIGH-risk INVESTIGATE order without a dispute is available for this shop. Run cleanup or seed more orders.");
    }
    const order = orders[0];
    console.log(`Using order: ${order.shopify_order_id} (${order.order_total} ${order.currency}, fulfilled ${order.fulfilled_at.toISOString()})`);

    // Insert the synthetic dispute. SEED-rw-test- prefix is the
    // cleanup discriminator; do not use 'seed-' so we don't collide
    // with the generic synthetic-disputes script.
    const disputeId = randomUUID();
    const disputeGid = `gid://shopify/ShopifyPaymentsDispute/SEED-rw-test-${disputeId}`;
    await client.query(
      `INSERT INTO disputes (
         id, shop_id, dispute_gid, reason, status, amount, currency_code,
         order_gid, due_at, phase, created_at, updated_at
       ) VALUES ($1, $2, $3, 'FRAUDULENT', 'needs_response', $4, $5, $6,
         now() + interval '7 days', 'chargeback', now(), now())`,
      [disputeId, resolvedShopId, disputeGid, order.order_total, order.currency, order.shopify_order_id],
    );
    console.log(`Created dispute: ${disputeId}`);

    // Insert a queued evidence_packs row. The build_pack job handler
    // resolves the rule (which is FRAUDULENT → auto on surasvenne),
    // runs buildPack, and then evaluateAndMaybeAutoSave fires the cap.
    const packId = randomUUID();
    await client.query(
      `INSERT INTO evidence_packs (
         id, shop_id, dispute_id, status, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, 'queued', 'automation', now(), now())`,
      [packId, resolvedShopId, disputeId],
    );
    console.log(`Created pack: ${packId} (queued)`);

    // Enqueue build_pack job. The Vercel cron picks this up — typically
    // within ~1 minute. Once the build completes:
    //   - evaluateAndMaybeAutoSave routes through the auto + moderate
    //     park branch because the risk-weakness cap fired.
    //   - parked_for_review event_payload.park_cause = "risk_weakness"
    //   - The deferred review email is sent with parkReason="risk_weakness".
    //   - The embedded banner shows on the Overview tab next time you
    //     visit the dispute.
    // status defaults to 'queued' per the column default — same as
    // what lib/automation/pipeline.ts does when enqueueing a job.
    await client.query(
      `INSERT INTO jobs (shop_id, job_type, entity_id) VALUES ($1, 'build_pack', $2)`,
      [resolvedShopId, packId],
    );
    console.log("Enqueued build_pack job. Vercel cron will pick it up (~1 min).");

    console.log("\nWhat to watch for:");
    console.log(`  - Open: https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/disputedesk-1/app/disputes/${disputeId}`);
    console.log(`  - Email: should land in your team email inbox (review variant with risk-weakness callout).`);
    console.log(`  - Banner: 'Auto-submit held — high-risk order flagged before fulfillment' above Case Summary card.`);
    console.log(`\nCleanup when done: node scripts/seed-risk-weakness-test-dispute.mjs --shop ${shop || ""} --cleanup`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});
