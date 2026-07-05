/**
 * Backfill: link orphaned checkout_sessions to their orders.
 *
 * The storefront pixel stored the order's **checkout_token** into
 * checkout_sessions.cart_token (misnamed — verified 2026-07-04: sessions
 * match orders on checkout_token, never on the order's cart_token). Nothing
 * ever wrote checkout_sessions.shopify_order_id, so every session is
 * orphaned and the CE 3.0 qualification path can't attach an IP anchor.
 *
 * This script fetches the shop's recent orders via the **REST** Orders API
 * (Admin GraphQL dropped both token fields in 2026-01; REST still returns
 * `checkout_token`), builds a checkout_token → numeric-order-id map, and
 * sets checkout_sessions.shopify_order_id (+ order_placed_at) for every
 * unlinked session whose stored key matches.
 *
 * DRY-RUN by default. Pass --apply to write. Reads prod Supabase via the
 * NEW_SUPABASE_* env (cutover keys) + TOKEN_ENCRYPTION_KEY for the offline
 * token; refuses unless NEW_SUPABASE_URL is the prod ref.
 *
 * Usage:
 *   node scripts/backfill-session-order-link.mjs <shop_domain> [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const APPLY = process.argv.includes("--apply");
const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: expected prod NEW_SUPABASE_URL (aokhply…).");
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function deserialize(raw) {
  const [v, i, t, c] = raw.split(":");
  return { keyVersion: parseInt(v.slice(1), 10), iv: Buffer.from(i, "hex"), tag: Buffer.from(t, "hex"), ciphertext: Buffer.from(c, "hex") };
}
function decrypt(p) {
  let hex = process.env[`TOKEN_ENCRYPTION_KEY_V${p.keyVersion}`];
  if (!hex && p.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`No token key v${p.keyVersion}`);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(hex, "hex"), p.iv);
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ciphertext), d.final()]).toString("utf8");
}

const { data: shop } = await sb.from("shops").select("id, shop_domain").eq("shop_domain", SHOP_DOMAIN).maybeSingle();
if (!shop) { console.error("no shop"); process.exit(1); }
const { data: sess } = await sb.from("shop_sessions")
  .select("shop_domain, access_token_encrypted").eq("shop_id", shop.id)
  .eq("session_type", "offline").is("user_id", null)
  .order("created_at", { ascending: false }).limit(1).maybeSingle();
if (!sess) { console.error("no offline session"); process.exit(1); }
const token = decrypt(deserialize(sess.access_token_encrypted));

// Unlinked sessions (the join key lives in the misnamed cart_token column).
const { data: orphans } = await sb.from("checkout_sessions")
  .select("id, cart_token, session_started_at")
  .eq("shop_id", shop.id).is("shopify_order_id", null).not("cart_token", "is", null);
const byKey = new Map();
for (const o of orphans ?? []) if (!byKey.has(o.cart_token)) byKey.set(o.cart_token, o.id);
console.log(`Shop ${SHOP_DOMAIN}: ${orphans?.length ?? 0} orphaned sessions (${byKey.size} distinct keys).`);
if (byKey.size === 0) { console.log("Nothing to do."); process.exit(0); }

const earliest = (orphans ?? []).map((r) => r.session_started_at).sort()[0] ?? "2026-01-01T00:00:00Z";
let url = `https://${sess.shop_domain}/admin/api/2026-01/orders.json?limit=250&status=any&created_at_min=${encodeURIComponent(earliest)}&fields=id,checkout_token,cart_token,processed_at,created_at`;
const plan = []; // { sessionId, orderId, placedAt }
let scanned = 0;
for (let page = 0; page < 40 && url; page++) {
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  const j = await res.json();
  if (j.errors) { console.error("REST errors:", JSON.stringify(j.errors)); break; }
  for (const o of j.orders ?? []) {
    scanned++;
    const key = o.checkout_token ?? o.cart_token;
    if (key && byKey.has(key)) {
      plan.push({ sessionId: byKey.get(key), orderId: String(o.id), placedAt: o.processed_at ?? o.created_at });
      byKey.delete(key); // one order per session key
    }
  }
  const link = res.headers.get("link");
  const next = link && link.match(/<([^>]+)>;\s*rel="next"/);
  url = next ? next[1] : null;
}

console.log(`REST orders scanned: ${scanned}`);
console.log(`Matched ${plan.length} of ${orphans?.length ?? 0} sessions to orders.`);
console.log(`Unmatched (order not found in window / different key): ${(orphans?.length ?? 0) - plan.length}`);

if (!APPLY) {
  console.log("\nDRY-RUN — no writes. Sample:");
  for (const p of plan.slice(0, 5)) console.log("  ", JSON.stringify(p));
  console.log("\nRe-run with --apply to write shopify_order_id onto these sessions.");
  process.exit(0);
}

let updated = 0, failed = 0;
for (const p of plan) {
  const { error } = await sb.from("checkout_sessions")
    .update({ shopify_order_id: p.orderId, order_placed_at: p.placedAt })
    .eq("id", p.sessionId);
  if (error) { failed++; console.error("update failed", p.sessionId, error.message); }
  else updated++;
}
console.log(`\nAPPLIED: ${updated} linked, ${failed} failed.`);
