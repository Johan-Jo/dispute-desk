// Ask Shopify what webhook subscriptions each shop ACTUALLY has.
// Ground truth — webhook_events only retains ~7 days of traffic.
import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv.includes("--env-file")
  ? process.argv[process.argv.indexOf("--env-file") + 1] : ".env.production.local";
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function decrypt(b) {
  const [v, i, t, c] = b.split(":");
  const ver = v.replace(/^v/, "");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`] || process.env.TOKEN_ENCRYPTION_KEY;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
const WANT = ["ORDERS_CREATE", "ORDERS_UPDATED"];

const Q = `{ webhookSubscriptions(first: 50) { edges { node {
  id topic createdAt
  endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
} } } }`;

const { data: shops } = await sb.from("shops")
  .select("id, shop_domain, uninstalled_at").is("uninstalled_at", null).order("shop_domain");

for (const s of shops) {
  const { data: sess } = await sb.from("shop_sessions")
    .select("access_token_encrypted").eq("shop_id", s.id)
    .eq("session_type", "offline").is("user_id", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!sess) { console.log(`${s.shop_domain.padEnd(38)} NO-SESSION`); continue; }
  let token; try { token = decrypt(sess.access_token_encrypted); }
  catch { console.log(`${s.shop_domain.padEnd(38)} DECRYPT-FAIL`); continue; }
  let j;
  try {
    const r = await fetch(`https://${s.shop_domain}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: Q }),
    });
    j = await r.json();
    if (r.status !== 200 || j.errors) {
      console.log(`${s.shop_domain.padEnd(38)} UNREACHABLE HTTP ${r.status} ${JSON.stringify(j.errors ?? "").slice(0,70)}`);
      continue;
    }
  } catch (e) { console.log(`${s.shop_domain.padEnd(38)} NETWORK ${e.message}`); continue; }

  const subs = (j.data?.webhookSubscriptions?.edges ?? []).map((e) => e.node);
  const topics = subs.map((n) => n.topic);
  const missing = WANT.filter((w) => !topics.includes(w));
  const orderSubs = subs.filter((n) => WANT.includes(n.topic));
  const verdict = missing.length === 0 ? "OK" : `MISSING: ${missing.join(", ")}`;
  console.log(`${s.shop_domain.padEnd(38)} ${verdict}`);
  console.log(`${"".padEnd(38)}   all topics (${subs.length}): ${topics.join(", ") || "(none)"}`);
  for (const n of orderSubs) {
    console.log(`${"".padEnd(38)}   ${n.topic} -> ${n.endpoint?.callbackUrl ?? n.endpoint?.__typename} (created ${n.createdAt})`);
  }
}
