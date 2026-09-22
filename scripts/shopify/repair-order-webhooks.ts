/**
 * Register missing orders/* webhooks for shops that lack them, using the
 * app's own registerOrderWebhooks() + ensureFreshSession(). Idempotent:
 * "already exists" counts as created.
 *
 * Usage: npx tsx scripts/shopify/repair-order-webhooks.ts [shop_domain ...]
 *        (no args = every installed shop)
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });

const WANT = ["ORDERS_CREATE", "ORDERS_UPDATED"];
const SUBS_QUERY = `{ webhookSubscriptions(first: 50) { edges { node { topic } } } }`;

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  const { getServiceClient } = await import("@/lib/supabase/server");
  const { loadSession } = await import("@/lib/shopify/sessionStorage");
  const { ensureFreshSession } = await import(
    "@/lib/shopify/sessions/refreshOfflineToken"
  );
  const { registerOrderWebhooks } = await import(
    "@/lib/shopify/registerOrderWebhooks"
  );
  const { requestShopifyGraphQL } = await import("@/lib/shopify/graphql");

  const sb = getServiceClient();
  let q = sb.from("shops").select("id, shop_domain").is("uninstalled_at", null);
  if (only.length) q = q.in("shop_domain", only);
  const { data: shops } = await q.order("shop_domain");

  for (const shop of shops ?? []) {
    const stored = await loadSession(shop.id, "offline");
    if (!stored) { console.log(`${shop.shop_domain}: NO SESSION — skipped`); continue; }
    const session = await ensureFreshSession(stored);

    const before = await requestShopifyGraphQL<{
      webhookSubscriptions?: { edges: Array<{ node: { topic: string } }> };
    }>({ session: { shopDomain: shop.shop_domain, accessToken: session.accessToken },
         query: SUBS_QUERY, variables: {} });

    if (before.errors?.length) {
      console.log(`${shop.shop_domain}: UNREACHABLE — ${before.errors.map(e => e.message).join("; ")}`);
      continue;
    }
    const have = (before.data?.webhookSubscriptions?.edges ?? []).map((e) => e.node.topic);
    const missing = WANT.filter((w) => !have.includes(w));
    if (!missing.length) { console.log(`${shop.shop_domain}: already OK`); continue; }

    console.log(`${shop.shop_domain}: missing ${missing.join(", ")} — registering…`);
    const res = await registerOrderWebhooks({
      shopDomain: shop.shop_domain,
      accessToken: session.accessToken,
    });

    const after = await requestShopifyGraphQL<{
      webhookSubscriptions?: { edges: Array<{ node: { topic: string } }> };
    }>({ session: { shopDomain: shop.shop_domain, accessToken: session.accessToken },
         query: SUBS_QUERY, variables: {} });
    const nowHave = (after.data?.webhookSubscriptions?.edges ?? []).map((e) => e.node.topic);
    const stillMissing = WANT.filter((w) => !nowHave.includes(w));

    console.log(`  registerOrderWebhooks ok=${res.ok} created=[${res.created.join(", ")}]` +
      (res.errors.length ? ` errors=${res.errors.join(" | ")}` : ""));
    console.log(`  VERIFIED topics now: ${nowHave.join(", ")}`);
    console.log(stillMissing.length ? `  ✗ STILL MISSING: ${stillMissing.join(", ")}` : `  ✓ confirmed present`);
  }
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
