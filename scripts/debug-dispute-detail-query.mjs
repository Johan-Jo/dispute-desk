/**
 * Debug: query Shopify with the SAME DISPUTE_DETAIL_QUERY the webhook
 * handler uses for the live #1080 dispute. Goal: see what `order.id`
 * actually comes back as, since it landed null in the DB even though
 * `order.name` worked.
 *
 *   node -r dotenv/config scripts/debug-dispute-detail-query.mjs dotenv_config_path=.env.local
 */

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY_V1 = process.env.TOKEN_ENCRYPTION_KEY_V1 || process.env.TOKEN_ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ENC_KEY_V1) {
  console.error("Missing env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TOKEN_ENCRYPTION_KEY_V1)");
  process.exit(1);
}

const DISPUTE_GID = "gid://shopify/ShopifyPaymentsDispute/10563715129";
const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function decrypt(serialized) {
  const parts = serialized.split(":");
  const [iv, tag, ciphertext] = [parts[1], parts[2], parts[3]];
  const key = Buffer.from(ENC_KEY_V1, "hex");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

const { data: session } = await sb
  .from("shop_sessions")
  .select("access_token_encrypted, shop_domain")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (!session) {
  console.error("no offline session");
  process.exit(1);
}

const accessToken = decrypt(session.access_token_encrypted);
console.log("[debug] shop:", session.shop_domain, "token-len:", accessToken.length);

const query = `
  query DisputeDetail($id: ID!) {
    dispute(id: $id) {
      id
      type
      status
      order {
        id
        legacyResourceId
        name
        email
        createdAt
      }
      disputeEvidence {
        id
      }
    }
  }
`;

const res = await fetch(
  `https://${session.shop_domain}/admin/api/2026-01/graphql.json`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: { id: DISPUTE_GID } }),
  },
);

console.log("HTTP", res.status);
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
