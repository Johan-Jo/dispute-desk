/**
 * Read-only pre-flight snapshot for pack 0e01ba6d / dispute d24340c6 / order #1070.
 * No writes. Does NOT print access_token_encrypted.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";
const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";

const pack = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, saved_to_shopify_at, updated_at")
  .eq("id", PACK_ID)
  .maybeSingle();
console.log("\n── evidence_packs ──");
console.log(pack.error ?? pack.data);

const jobs = await sb
  .from("jobs")
  .select("id, status, attempts, last_error, created_at, updated_at")
  .eq("entity_id", PACK_ID)
  .eq("job_type", "save_to_shopify")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\n── jobs (save_to_shopify, latest 5) ──");
console.log(jobs.error ?? JSON.stringify(jobs.data, null, 2));

const sessions = await sb
  .from("shop_sessions")
  .select("id, session_type, user_id, shop_domain, created_at, scopes")
  .eq("shop_id", SHOP_ID)
  .order("created_at", { ascending: false })
  .limit(3);
console.log("\n── shop_sessions (latest 3, NO TOKENS) ──");
console.log(sessions.error ?? JSON.stringify(sessions.data, null, 2));

const dispute = await sb
  .from("disputes")
  .select("id, dispute_evidence_gid, reason, amount, currency_code")
  .eq("id", DISPUTE_ID)
  .maybeSingle();
console.log("\n── dispute ──");
console.log(dispute.error ?? dispute.data);

// Gate per plan: if dispute_evidence_gid is null, handler will throw at line 186-188.
if (!dispute.data?.dispute_evidence_gid) {
  console.log("\n⚠️  GATE: dispute_evidence_gid is null — handler would throw 'Dispute has no evidence GID'.");
  console.log("    Stop here; sync disputes first before retrying.");
  process.exit(0);
}
console.log("\n✅ gate passed: dispute_evidence_gid present");
