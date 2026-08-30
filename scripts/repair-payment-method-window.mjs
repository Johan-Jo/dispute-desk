/**
 * Repair `shopify_orders.payment_method` (and the risk-signal rows) for a
 * date window, by re-reading those orders through the FIXED PaymentDetails
 * union query.
 *
 * Why this exists rather than a plain re-run of `backfill_shop_orders`:
 * that job re-walks the shop's entire history from its since-date (2010 for
 * a read_all_orders grant, ~100k orders here) and resets
 * `shops.historical_import_*` progress as it goes. The damage from the
 * union bug is bounded to the window in which PayPal moved inside Shopify
 * Payments, so the repair should be bounded the same way. This script
 * touches only `shopify_orders` / risk assessments / signal rows and never
 * writes the shops progress columns.
 *
 * It deliberately imports the same helpers the ingest uses
 * (`fetchOrdersBackfillPage`, `normalizeBackfillOrder`, `persistOrders`,
 * `upsertSignalRows`) so the repaired rows cannot drift from what a normal
 * ingest would have written. Persisting is an upsert, so re-running is safe.
 *
 * Usage:
 *   node --import tsx scripts/repair-payment-method-window.mjs \
 *     --shop <shop-uuid> --from 2026-04-01 --to 2026-09-01 [--apply]
 *
 * Without --apply it runs read-only: it fetches and reports what the fixed
 * query resolves, and writes nothing.
 */

import { config } from "dotenv";

const envFile = process.argv.includes("--env-file")
  ? process.argv[process.argv.indexOf("--env-file") + 1]
  : ".env.production.local";
config({ path: envFile });

const { fetchOrdersBackfillPage, normalizeBackfillOrder } = await import(
  "../lib/shopify/queries/ordersForBackfill.ts"
);
const { persistOrders } = await import("../lib/shopify/persistOrders.ts");
const { upsertSignalRows } = await import("../lib/fraudIntel/signalWriter.ts");
const { loadSession } = await import("../lib/shopify/sessionStorage.ts");
const { ensureFreshSession } = await import(
  "../lib/shopify/sessions/refreshOfflineToken.ts"
);
const { getServiceClient } = await import("../lib/supabase/server.ts");
const { requestShopifyGraphQL } = await import("../lib/shopify/graphql.ts");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const shopId = arg("shop");
const fromDate = arg("from");
const toDate = arg("to");
const apply = process.argv.includes("--apply");

if (!shopId || !fromDate || !toDate) {
  console.error(
    "usage: --shop <uuid> --from YYYY-MM-DD --to YYYY-MM-DD [--apply] [--env-file <path>]",
  );
  process.exit(1);
}

const sb = getServiceClient();

const { data: shopRow, error: shopErr } = await sb
  .from("shops")
  .select("id, shop_domain")
  .eq("id", shopId)
  .single();
if (shopErr || !shopRow) {
  console.error(`shop ${shopId} not found: ${shopErr?.message}`);
  process.exit(1);
}

let session = await loadSession(shopId, "offline");
if (!session) {
  console.error(`no offline session for ${shopRow.shop_domain}`);
  process.exit(1);
}
// The token on this shop has expired before (see session-health work);
// refresh through the canonical path rather than trusting stored ciphertext.
session = (await ensureFreshSession(session)) ?? session;

/**
 * Refresh before every page, not just at startup.
 *
 * Expiring offline tokens carry a ~1-hour TTL. A repair over several
 * months of history runs longer than that, so a once-at-startup refresh
 * dies mid-walk — observed on this shop at page 187 (18,700 orders in):
 * `ShopifyAuthInvalidError: Invalid API key or access token`.
 *
 * ensureFreshSession is a no-op unless the token is inside its refresh
 * skew window, so calling it per page costs nothing on the common path
 * and removes the wall-clock ceiling on a run.
 */
async function freshSession() {
  session = (await ensureFreshSession(session)) ?? session;
  return session;
}

// `is_cross_border` is derived from the store's own country, so the repair
// must resolve it the same way the ingest does (Shop.billingAddress) or it
// would rewrite that column from a different basis. fetchShopPrimaryCountry
// is module-private in backfillOrders, so the same query is issued here.
const countryResp = await requestShopifyGraphQL({
  session,
  query: `query { shop { billingAddress { countryCodeV2 } } }`,
  correlationId: "repair-pm-country",
});
const storeCountry =
  countryResp?.data?.shop?.billingAddress?.countryCodeV2 ?? null;
if (!storeCountry) {
  console.error(
    "could not resolve store country — aborting rather than rewriting is_cross_border from a null basis",
  );
  process.exit(1);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} repair for ${shopRow.shop_domain}` +
    ` window ${fromDate} .. ${toDate} (exclusive)`,
);

let cursor = null;
let page = 0;
let seen = 0;
const methodTally = new Map();

for (;;) {
  const res = await fetchOrdersBackfillPage(await freshSession(), {
    fromDateIso: fromDate,
    toExclusiveDateIso: toDate,
    after: cursor,
    correlationId: `repair-pm-p${seen}`,
  });

  if (res.orders.length > 0) {
    const normalized = res.orders.map((o) =>
      normalizeBackfillOrder(shopId, o, { storeCountryCode: storeCountry }),
    );

    for (const n of normalized) {
      const m = n.order.payment_method ?? "<null>";
      methodTally.set(m, (methodTally.get(m) ?? 0) + 1);
    }

    if (apply) {
      await persistOrders(
        shopId,
        normalized.map((n) => n.order),
        normalized.flatMap((n) => n.assessments),
      );
      // Signal rows carry AVS/CVV/BIN/card-brand, which the union bug
      // also blanked. Non-fatal on failure, same contract as the ingest.
      try {
        await upsertSignalRows(
          res.orders.map((raw) => ({ shopId, shopifyOrderId: raw.id, raw })),
        );
      } catch (err) {
        console.warn(
          `[signal-rows] batch upsert failed at ${seen}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    seen += res.orders.length;
  }

  page += 1;
  process.stderr.write(`\rpage ${page} · ${seen} orders`);

  if (!res.hasNextPage || !res.endCursor) break;
  cursor = res.endCursor;
}

process.stderr.write("\n");
console.log(`\n${seen} orders processed. Resolved payment_method:`);
for (const [k, v] of [...methodTally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${((100 * v) / seen).toFixed(1).padStart(5)}%  ${k}`);
}
if (!apply) {
  console.log("\nDRY-RUN — nothing written. Re-run with --apply to persist.");
}
