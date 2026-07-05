/**
 * Targeted network_reason_code backfill for specific disputes.
 *
 * Reuses the exact pack-build enrichment (`enrichDisputeWithNetworkReasonCode`)
 * so the result is identical to what a pack rebuild would write — fetches the
 * dispute's order, derives card network + payment context, resolves the code,
 * and persists it. For Klarna the correct result is `not_card_network` (no
 * Visa code exists) — that is expected, not a failure.
 *
 * DRY-RUN by default (prints the resolution without the enrichment persisting
 * — but note the enrichment itself writes, so dry-run here means we only run
 * the RESOLVER and print; --apply runs the full enrich+persist).
 *
 * Usage:
 *   npx tsx scripts/backfill-reason-code-for-disputes.mts <disputeId...> [--apply]
 *
 * Env: prod NEW_SUPABASE_URL/KEY (cutover) or SUPABASE_URL/SERVICE_ROLE +
 * TOKEN_ENCRYPTION_KEY. Refuses unless the Supabase URL is the prod ref.
 */
import { config } from "dotenv";
import { join } from "path";
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

// Point the app's server client at prod for this one-off.
const prodUrl = process.env.NEW_SUPABASE_URL;
const prodKey = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!prodUrl || !prodUrl.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: need prod NEW_SUPABASE_URL (aokhply…).");
  process.exit(1);
}
process.env.SUPABASE_URL = prodUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = prodKey;
process.env.NEXT_PUBLIC_SUPABASE_URL = prodUrl;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const disputeIds = args.filter((a) => !a.startsWith("--"));
if (disputeIds.length === 0) {
  console.error("Usage: npx tsx scripts/backfill-reason-code-for-disputes.mts <disputeId...> [--apply]");
  process.exit(1);
}

const { getServiceClient } = await import("@/lib/supabase/server");
const { requestShopifyGraphQL } = await import("@/lib/shopify/graphql");
const { ORDER_DETAIL_QUERY } = await import("@/lib/shopify/queries/orders");
const { decrypt, deserializeEncrypted } = await import("@/lib/security/encryption");
const { enrichDisputeWithNetworkReasonCode } = await import(
  "@/lib/disputes/enrichNetworkReasonCode"
);
const decryptAccessToken = (enc: string): string =>
  decrypt(deserializeEncrypted(enc));

const sb = getServiceClient();

for (const disputeId of disputeIds) {
  const { data: dispute, error } = await sb
    .from("disputes")
    .select("id, shop_id, reason, order_gid, network_reason_code")
    .eq("id", disputeId)
    .maybeSingle();
  if (error || !dispute) {
    console.error(`[${disputeId}] not found: ${error?.message ?? "no row"}`);
    continue;
  }
  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", dispute.shop_id)
    .maybeSingle();
  const { data: sessionRow } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", dispute.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shop || !sessionRow) {
    console.error(`[${disputeId}] missing shop/session`);
    continue;
  }

  let order = null;
  if (dispute.order_gid) {
    const res = await requestShopifyGraphQL<{ node?: unknown }>({
      session: {
        shopDomain: shop.shop_domain,
        accessToken: decryptAccessToken(sessionRow.access_token_encrypted),
      },
      query: ORDER_DETAIL_QUERY,
      variables: { id: dispute.order_gid },
    });
    order = (res.data?.node as never) ?? null;
  }

  console.log(
    `[${disputeId}] reason=${dispute.reason} current_code=${dispute.network_reason_code ?? "null"} order=${dispute.order_gid ? "fetched" : "none"}`,
  );

  if (!APPLY) {
    console.log(`  DRY-RUN — pass --apply to resolve + persist.`);
    continue;
  }

  const result = await enrichDisputeWithNetworkReasonCode({
    disputeId: dispute.id,
    shopifyReason: dispute.reason,
    order,
  });
  console.log(
    `  APPLIED → code=${result.result.code ?? "null"} confidence=${result.result.confidence} persisted=${result.persisted}${result.persistError ? ` err=${result.persistError}` : ""}`,
  );
}

console.log("\nDone.");
process.exit(0);
