import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: shop } = await sb.from("shops").select("id,shop_domain").eq("shop_domain", "blume-box.myshopify.com").single();
const { data: s } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", shop.id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
const tok = dec(s.access_token_encrypted);
for (const t of process.argv.slice(2)) {
  const r = await fetch(`https://${shop.shop_domain}/admin/api/2026-01/graphql.json`, { method: "POST", headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{ __type(name: "${t}") { name kind fields { name description type { name kind ofType { name kind ofType { name } } } } possibleTypes { name } } }` }) });
  const j = await r.json(); const ty = j.data?.__type;
  console.log(`\n## ${t}`, ty?.kind, ty?.possibleTypes ? "possible: " + ty.possibleTypes.map((p) => p.name).join(",") : "");
  for (const f of ty?.fields ?? []) console.log(" ", f.name, "::", (f.type.name ?? f.type.ofType?.name ?? f.type.ofType?.ofType?.name), "—", (f.description ?? "").replace(/\s+/g, " ").slice(0, 110));
}
