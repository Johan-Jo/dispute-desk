/**
 * Recovery cleanup for E2E fixture rows whose owning test crashed
 * before `cleanup()` ran. Goes through the
 * `delete_e2e_fixture_dispute(uuid)` RPC (added in migration
 * 20260509140000), which is the only path that can delete
 * audit_events rows seeded during the test (see
 * docs/technical.md § *E2E fixtures and audit immutability*).
 *
 * Replaces the older `cleanup-e2e-fixture-disputes.mjs` /
 * `cleanup-e2e-fixtures-with-audit.mjs` scripts, which (a) couldn't
 * touch audit_events without a direct Postgres password, and
 * (b) silently failed on FK violations even when they did run.
 *
 * Usage:
 *   node scripts/cleanup-e2e-orphans.mjs            # dry run
 *   node scripts/cleanup-e2e-orphans.mjs --apply    # delete via RPC
 *   node scripts/cleanup-e2e-orphans.mjs --apply --shop <domain>
 */
import { getServiceClient } from "./lib/supabase.mjs";

const TEST_GID_PREFIX = "gid://shopify/ShopifyPaymentsDispute/test-";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const shopIdx = args.indexOf("--shop");
const shopDomain = shopIdx !== -1 ? args[shopIdx + 1] : null;

const sb = getServiceClient();

let q = sb
  .from("disputes")
  .select("id, shop_id, dispute_gid, amount, reason, created_at")
  .like("dispute_gid", `${TEST_GID_PREFIX}%`);

if (shopDomain) {
  const { data: shops, error: sErr } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("shop_domain", shopDomain);
  if (sErr) {
    console.error("shops lookup:", sErr.message);
    process.exit(1);
  }
  if (!shops?.length) {
    console.error("Shop not found:", shopDomain);
    process.exit(1);
  }
  q = q.eq("shop_id", shops[0].id);
}

const { data: orphans, error: dErr } = await q;
if (dErr) {
  console.error("disputes query:", dErr.message);
  process.exit(1);
}

console.log(
  `Found ${orphans.length} E2E fixture dispute(s)${shopDomain ? ` for ${shopDomain}` : ""}.`,
);
for (const r of orphans.slice(0, 30)) {
  console.log(
    `  ${r.dispute_gid}  amt=${r.amount}  reason=${r.reason}  created=${r.created_at}`,
  );
}
if (orphans.length > 30) console.log(`  …and ${orphans.length - 30} more`);

if (!orphans.length) process.exit(0);
if (!apply) {
  console.log("\nDry run — pass --apply to delete via RPC.");
  process.exit(0);
}

console.log("\nDeleting via delete_e2e_fixture_dispute RPC…");
let totals = { audits: 0, jobs: 0, packs: 0, disputes: 0 };
let failures = 0;
for (const r of orphans) {
  const { data, error } = await sb.rpc("delete_e2e_fixture_dispute", {
    p_dispute_id: r.id,
  });
  if (error) {
    console.error(`  ${r.dispute_gid}: ${error.message}`);
    failures++;
    continue;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row) {
    totals.audits += row.audits_deleted ?? 0;
    totals.jobs += row.jobs_deleted ?? 0;
    totals.packs += row.packs_deleted ?? 0;
    totals.disputes += row.disputes_deleted ?? 0;
  }
}
console.log(
  `\nDone. disputes=${totals.disputes} packs=${totals.packs} jobs=${totals.jobs} audit_events=${totals.audits} failures=${failures}`,
);
process.exit(failures ? 1 : 0);
