/**
 * Fresh introspection of ShopifyPaymentsDisputeEvidenceUpdateInput.
 * Called on 2026-04-21 because Shopify returned
 *   "customerPurchaseIp (Field is not defined on ShopifyPaymentsDisputeEvidenceUpdateInput)"
 * The codebase's DisputeEvidenceUpdateInput type (header dated 2026-04-17)
 * lists customerPurchaseIp as a top-level field; Shopify currently rejects
 * it there. This script prints every field and subtype so we can align.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";

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
  if (!hex) throw new Error(`missing ${envName}`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
const endpoint = `https://${sessionRow.shop_domain}/admin/api/2025-04/graphql.json`;

const INTROSPECT = `
  query {
    t: __type(name: "ShopifyPaymentsDisputeEvidenceUpdateInput") {
      name
      description
      inputFields {
        name
        description
        type {
          kind name
          ofType { kind name ofType { kind name } }
        }
      }
    }
  }
`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({ query: INTROSPECT }),
});
const json = await res.json();

if (!json.data?.t) {
  console.log("no type returned:", JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log(`Type: ${json.data.t.name}`);
if (json.data.t.description) console.log(`Desc: ${json.data.t.description}`);
console.log(`\nFields (${json.data.t.inputFields.length}):`);
for (const f of json.data.t.inputFields) {
  const t = f.type;
  const name = t.name ?? t.ofType?.name ?? t.ofType?.ofType?.name ?? "?";
  const kind = t.kind === "NON_NULL" ? "!" : t.kind === "LIST" ? "[]" : "";
  console.log(`  ${f.name}: ${name}${kind}${f.description ? "  — " + f.description.replace(/\n/g, " ").slice(0, 90) : ""}`);
}

// Check for customer-ish nested types that might hold purchaseIp
const NESTED_CANDIDATES = [
  "ShopifyPaymentsDisputeEvidenceUpdateCustomerInput",
  "ShopifyPaymentsDisputeEvidenceCustomerInput",
  "ShopifyPaymentsDisputeCustomerInput",
  "CustomerInput",
];

console.log("\n── probing nested input types ──");
for (const name of NESTED_CANDIDATES) {
  const q = `query { t: __type(name: "${name}") { name inputFields { name type { name kind ofType { name kind } } } } }`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (j.data?.t) {
    console.log(`\n${name} fields:`);
    for (const f of j.data.t.inputFields ?? []) {
      const inner = f.type.name ?? f.type.ofType?.name ?? "?";
      console.log(`  ${f.name}: ${inner}`);
    }
  }
}
