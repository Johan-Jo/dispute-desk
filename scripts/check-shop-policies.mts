/**
 * One-off: call Shop.shopPolicies for a shop using its stored offline
 * session via the app's own helpers, to verify what published policies
 * Shopify actually returns.
 * Usage: npx tsx scripts/check-shop-policies.mts <shop_internal_id>
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
for (const f of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const shopId = process.argv[2];
if (!shopId) {
  console.error("usage: npx tsx scripts/check-shop-policies.mts <shop_internal_id>");
  process.exit(1);
}

const { makeAuthedRequest } = await import("../lib/shopify/makeAuthedRequest");
const { SHOP_POLICIES_QUERY } = await import("../lib/shopify/queries/shopPolicies");

const res = await makeAuthedRequest({ shopId, query: SHOP_POLICIES_QUERY });
console.log("errors:", JSON.stringify(res.errors ?? null));
console.log(JSON.stringify(res.data, null, 2));
