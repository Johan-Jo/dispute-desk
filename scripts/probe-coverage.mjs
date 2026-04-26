/**
 * Probe Order.shopifyProtect across recent disputes.
 *
 * Verifies the new field is actually returned by the Admin API
 * and shows the distribution of statuses on the dev shop.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const LIMIT = Number(process.argv[2] ?? 8);

const { data: disputes } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid, order_name, reason")
  .not("order_gid", "is", null)
  .order("created_at", { ascending: false })
  .limit(LIMIT);

const QUERY = `
  query OrderProtect($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        shopifyProtect { status }
      }
    }
  }
`;

const tokenCache = new Map();
async function tokenFor(shopId) {
  if (tokenCache.has(shopId)) return tokenCache.get(shopId);
  const { data: sess } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sess) return null;
  const t = { shopDomain: sess.shop_domain, token: decrypt(deserialize(sess.access_token_encrypted)) };
  tokenCache.set(shopId, t);
  return t;
}

const summary = { total: 0, applicable: 0, byStatus: {} };
for (const d of disputes) {
  summary.total++;
  const sess = await tokenFor(d.shop_id);
  if (!sess) { console.log(`[${d.id.slice(0,8)}] no session`); continue; }
  const endpoint = `https://${sess.shopDomain}/admin/api/2026-01/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": sess.token },
    body: JSON.stringify({ query: QUERY, variables: { id: d.order_gid } }),
  });
  const json = await res.json();
  const protect = json?.data?.node?.shopifyProtect ?? null;
  if (json.errors) {
    console.log(`[${d.id.slice(0,8)}] ${d.order_name} ERRORS:`, JSON.stringify(json.errors));
    continue;
  }
  const status = protect?.status ?? null;
  if (status) {
    summary.applicable++;
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
  }
  console.log(`[${d.id.slice(0,8)}] ${d.order_name} reason=${d.reason}  shopifyProtect: ${status ?? "(null — program not applicable)"}`);
}

console.log("\n── summary ──");
console.log(JSON.stringify(summary, null, 2));
