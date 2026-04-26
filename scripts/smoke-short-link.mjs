/**
 * Smoke test the new evidence_short_links table + the create/resolve
 * round-trip against live Supabase. Inserts a row, reads it back, then
 * cleans up. Read-only beyond its own row.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";
import { randomInt } from "crypto";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function code(len = 10) {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

// Use the most recent pack so FK references are valid.
const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, shop_id, dispute_id")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

console.log("using pack", pack.id);

const short = code();
const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

const { error: insErr } = await sb.from("evidence_short_links").insert({
  short_code: short,
  kind: "pdf",
  entity_id: pack.id,
  pack_id: pack.id,
  shop_id: pack.shop_id,
  dispute_id: pack.dispute_id,
  expires_at: expiresAt,
});
if (insErr) {
  console.error("insert FAILED:", insErr);
  process.exit(1);
}
console.log("inserted code:", short);

const { data: row, error: selErr } = await sb
  .from("evidence_short_links")
  .select("kind, entity_id, pack_id, expires_at, revoked_at")
  .eq("short_code", short)
  .maybeSingle();
if (selErr || !row) {
  console.error("select FAILED:", selErr);
  process.exit(1);
}
console.log("read back:", row);

const { error: delErr } = await sb
  .from("evidence_short_links")
  .delete()
  .eq("short_code", short);
if (delErr) {
  console.error("cleanup FAILED:", delErr);
  process.exit(1);
}
console.log("cleaned up — table works end-to-end ✓");
