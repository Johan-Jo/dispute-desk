/**
 * Raw inspection: what does Shopify actually return in receiptJson?
 *
 * Many GraphQL clients return JSON-scalar fields as strings; ours might
 * be returning a string instead of a parsed object, which would explain
 * why the walk returned null for everything.
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

const { data: rows } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid, order_name, dispute_gid")
  .not("order_gid", "is", null)
  .order("created_at", { ascending: false })
  .limit(1);
const dispute = rows?.[0];
if (!dispute) { console.log("no dispute"); process.exit(0); }

console.log("dispute:", dispute);

const { data: sess } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", dispute.shop_id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const token = decrypt(deserialize(sess.access_token_encrypted));

// Also pull the raw order info to see if these are synthetic
const { data: shop } = await sb
  .from("shops")
  .select("shop_domain, plan, created_at")
  .eq("id", dispute.shop_id)
  .maybeSingle();
console.log("shop:", shop);

const QUERY = `
  query OrderProbe($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        sourceName
        test
        transactions(first: 10) {
          id
          kind
          status
          gateway
          receiptJson
        }
      }
    }
  }
`;

const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query: QUERY, variables: { id: dispute.order_gid } }),
});
const json = await res.json();
console.log("\n── raw response ──");
console.log(JSON.stringify(json, null, 2).slice(0, 4000));

console.log("\n── per-tx receiptJson type/value ──");
const txs = json?.data?.node?.transactions ?? [];
for (const t of txs) {
  console.log(`tx ${t.id} kind=${t.kind} status=${t.status} gateway=${t.gateway}`);
  console.log(`  receiptJson typeof: ${typeof t.receiptJson}`);
  console.log(`  receiptJson === null: ${t.receiptJson === null}`);
  if (typeof t.receiptJson === "string") {
    console.log(`  receiptJson length: ${t.receiptJson.length}`);
    console.log(`  receiptJson preview: ${t.receiptJson.slice(0, 200)}`);
  } else if (t.receiptJson) {
    console.log(`  receiptJson keys: ${Object.keys(t.receiptJson).slice(0, 12).join(",")}`);
    console.log(`  receiptJson preview: ${JSON.stringify(t.receiptJson).slice(0, 600)}`);
  }
}

console.log("\n── order test/sourceName ──");
console.log({ name: json?.data?.node?.name, sourceName: json?.data?.node?.sourceName, test: json?.data?.node?.test });
