/**
 * One-shot cleanup for orphan E2E fixture rows left by `e2e/helpers/dbFixtures.ts`
 * when a spec crashed before `cleanup()` ran. Targets ONLY rows whose
 * `dispute_gid` matches `gid://shopify/ShopifyPaymentsDispute/test-<uuid>` —
 * never touches real Shopify-mirrored disputes.
 *
 * Usage:
 *   node scripts/cleanup-e2e-fixture-disputes.mjs                # dry run
 *   node scripts/cleanup-e2e-fixture-disputes.mjs --apply        # delete
 *   node scripts/cleanup-e2e-fixture-disputes.mjs --shop <domain> [--apply]
 *
 * Deletes in dependency order: jobs → evidence_packs → disputes.
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
  if (sErr) { console.error("shops lookup:", sErr.message); process.exit(1); }
  if (!shops?.length) { console.error("Shop not found:", shopDomain); process.exit(1); }
  q = q.eq("shop_id", shops[0].id);
}

const { data: orphans, error: dErr } = await q;
if (dErr) { console.error("disputes query:", dErr.message); process.exit(1); }

console.log(`Found ${orphans.length} E2E fixture dispute(s)${shopDomain ? ` for ${shopDomain}` : ""}.`);
for (const r of orphans.slice(0, 30)) {
  console.log(`  ${r.dispute_gid}  amt=${r.amount}  reason=${r.reason}  created=${r.created_at}`);
}
if (orphans.length > 30) console.log(`  …and ${orphans.length - 30} more`);

if (!orphans.length) process.exit(0);

const disputeIds = orphans.map(r => r.id);

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, dispute_id")
  .in("dispute_id", disputeIds);
const packIds = (packs ?? []).map(p => p.id);
console.log(`Linked evidence_packs: ${packIds.length}`);

const { count: jobCount } = await sb
  .from("jobs")
  .select("id", { count: "exact", head: true })
  .in("entity_id", packIds.length ? packIds : ["00000000-0000-0000-0000-000000000000"]);
console.log(`Linked jobs (entity_id = pack id): ${jobCount ?? 0}`);

if (!apply) {
  console.log("\nDry run — pass --apply to delete.");
  process.exit(0);
}

console.log("\nDeleting…");
if (packIds.length) {
  const { error: jErr, count: jDel } = await sb
    .from("jobs")
    .delete({ count: "exact" })
    .in("entity_id", packIds);
  if (jErr) console.error("jobs delete:", jErr.message);
  else console.log(`  jobs: ${jDel ?? 0}`);

  const { error: aePackErr, count: aePackDel } = await sb
    .from("audit_events")
    .delete({ count: "exact" })
    .in("pack_id", packIds);
  if (aePackErr) console.error("audit_events (pack_id) delete:", aePackErr.message);
  else console.log(`  audit_events (pack_id): ${aePackDel ?? 0}`);

  const { error: pErr, count: pDel } = await sb
    .from("evidence_packs")
    .delete({ count: "exact" })
    .in("id", packIds);
  if (pErr) console.error("evidence_packs delete:", pErr.message);
  else console.log(`  evidence_packs: ${pDel ?? 0}`);
}

const { error: aeDispErr, count: aeDispDel } = await sb
  .from("audit_events")
  .delete({ count: "exact" })
  .in("dispute_id", disputeIds);
if (aeDispErr) console.error("audit_events (dispute_id) delete:", aeDispErr.message);
else console.log(`  audit_events (dispute_id): ${aeDispDel ?? 0}`);

const { error: ddErr, count: dDel } = await sb
  .from("disputes")
  .delete({ count: "exact" })
  .in("id", disputeIds);
if (ddErr) { console.error("disputes delete:", ddErr.message); process.exit(1); }
console.log(`  disputes: ${dDel ?? 0}`);
console.log("\nDone.");
