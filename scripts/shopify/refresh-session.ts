/**
 * Diagnose/repair one shop's expiring offline token by calling the SAME
 * ensureFreshSession() the app uses — not a reimplementation.
 *
 * ensureFreshSession never throws: on failure it logs and returns the
 * stale session. So we compare before/after to see what really happened.
 *
 * Usage: npx tsx scripts/shopify/refresh-session.ts <shop_domain> [--force]
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });

async function main() {
  const shopDomain = process.argv[2];
  const force = process.argv.includes("--force");
  if (!shopDomain) throw new Error("usage: refresh-session.ts <shop_domain> [--force]");

  const { getServiceClient } = await import("@/lib/supabase/server");
  const { loadSession } = await import("@/lib/shopify/sessionStorage");
  const { ensureFreshSession, needsRefresh } = await import(
    "@/lib/shopify/sessions/refreshOfflineToken"
  );

  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops").select("id, shop_domain").eq("shop_domain", shopDomain).single();
  if (!shop) throw new Error(`shop not found: ${shopDomain}`);

  const before = await loadSession(shop.id, "offline");
  if (!before) throw new Error("no offline session");

  console.log("=== BEFORE ===");
  console.log("  session id      :", before.id);
  console.log("  tokenExpiring   :", before.tokenExpiring);
  console.log("  expiresAt       :", before.expiresAt);
  console.log("  hasRefreshToken :", !!before.refreshToken);
  console.log("  needsRefresh()  :", needsRefresh(before));
  console.log("  accessToken     :", before.accessToken.slice(0, 12) + "…");

  console.log(`\n=== calling ensureFreshSession(force=${force}) ===`);
  const after = await ensureFreshSession(before, { force });

  console.log("\n=== AFTER ===");
  console.log("  expiresAt       :", after.expiresAt);
  console.log("  accessToken     :", after.accessToken.slice(0, 12) + "…");
  const changed = after.accessToken !== before.accessToken;
  console.log("  token CHANGED   :", changed);

  // Ground truth: does the resulting token actually work?
  const API = process.env.SHOPIFY_API_VERSION ?? "2026-01";
  const r = await fetch(`https://${shopDomain}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": after.accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ shop { name myshopifyDomain } }" }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`\n=== LIVE API CHECK: HTTP ${r.status} ===`);
  console.log(" ", JSON.stringify(j).slice(0, 300));
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
