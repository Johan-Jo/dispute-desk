/**
 * One-shot: removes legacy test-fixture disputes from surasvenne via
 * the `delete_e2e_fixture_dispute` Postgres RPC.
 *
 * Why an RPC and not a direct delete: `audit_events` has an
 * append-only trigger that blocks DELETEs from PostgREST clients.
 * The RPC (defined in `20260509140000_e2e_fixture_cleanup_rpc.sql`)
 * runs with SECURITY DEFINER, flips the
 * `app.allow_audit_mutation` GUC inside its own transaction,
 * cascades through audit_events → jobs → evidence_packs → disputes,
 * and validates the dispute_gid matches the literal E2E fixture
 * pattern as a structural guard. Refuses to touch anything else.
 *
 * Idempotent — re-running is a no-op after the first run.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";
const FIXTURE_PREFIX = "gid://shopify/ShopifyPaymentsDispute/test-";

const { data: shop } = await sb
  .from("shops")
  .select("id")
  .eq("shop_domain", SHOP_DOMAIN)
  .single();
if (!shop) {
  console.error(`Shop ${SHOP_DOMAIN} not found`);
  process.exit(1);
}

const { data: targets } = await sb
  .from("disputes")
  .select("id, dispute_gid")
  .eq("shop_id", shop.id)
  .like("dispute_gid", `${FIXTURE_PREFIX}%`);

console.log(`\nFound ${targets?.length ?? 0} test-fixture disputes on ${SHOP_DOMAIN}`);
if (!targets || targets.length === 0) {
  console.log("Nothing to clean up — already done.");
  process.exit(0);
}

let totals = { audits: 0, jobs: 0, packs: 0, disputes: 0 };
for (const t of targets) {
  const { data, error } = await sb.rpc("delete_e2e_fixture_dispute", {
    p_dispute_id: t.id,
  });
  if (error) {
    console.error(`  RPC failed for ${t.dispute_gid}: ${error.message}`);
    continue;
  }
  // RPC returns a single row in an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (row) {
    totals.audits += row.audits_deleted ?? 0;
    totals.jobs += row.jobs_deleted ?? 0;
    totals.packs += row.packs_deleted ?? 0;
    totals.disputes += row.disputes_deleted ?? 0;
  }
}

const { count: after } = await sb
  .from("disputes")
  .select("id", { count: "exact", head: true })
  .eq("shop_id", shop.id);

console.log(`\nCascade totals:`);
console.log(`  audit_events removed:   ${totals.audits}`);
console.log(`  jobs removed:           ${totals.jobs}`);
console.log(`  evidence_packs removed: ${totals.packs}`);
console.log(`  disputes removed:       ${totals.disputes}`);
console.log(`Disputes remaining for ${SHOP_DOMAIN}: ${after}`);
process.exit(0);
