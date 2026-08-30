// Health-check every shop's stored offline token against the live Admin API.
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
const { data: shops } = await sb.from("shops")
  .select("id, shop_domain, plan, uninstalled_at").order("shop_domain");

for (const s of shops) {
  const { data: sess } = await sb.from("shop_sessions")
    .select("access_token_encrypted, created_at").eq("shop_id", s.id)
    .eq("session_type", "offline").is("user_id", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const flag = s.uninstalled_at ? "UNINSTALLED" : "installed";
  if (!sess) { console.log(`${s.shop_domain.padEnd(46)} ${flag.padEnd(12)} NO-OFFLINE-SESSION`); continue; }
  let token;
  try { token = decrypt(sess.access_token_encrypted); }
  catch (e) { console.log(`${s.shop_domain.padEnd(46)} ${flag.padEnd(12)} DECRYPT-FAIL ${e.message}`); continue; }
  let verdict;
  try {
    const r = await fetch(`https://${s.shop_domain}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ shop { name } }" }),
    });
    const j = await r.json().catch(() => ({}));
    verdict = r.status === 200 && j?.data?.shop ? `OK (${j.data.shop.name})` : `HTTP ${r.status} ${JSON.stringify(j?.errors ?? j).slice(0, 90)}`;
  } catch (e) { verdict = `NETWORK ${e.message}`; }
  console.log(`${s.shop_domain.padEnd(46)} ${flag.padEnd(12)} sess=${sess.created_at.slice(0,16)} ${verdict}`);
}
