/**
 * Populates the four tracking-app columns on surasvenne's
 * shopify_orders rows. The columns were added 2026-05-11 and didn't
 * exist when the v2 seed wrote — every row is currently NULL.
 *
 * Realistic distribution for a Swedish merchant using PostNord +
 * occasional Bring/DHL, with AfterShip-style sync enabled:
 *
 *   tracking_source       60% aftership · 25% null (no app) · 10% shipway · 5% wonderment
 *
 *   delivery_status (for orders with fulfilled_at AND a tracking_source):
 *     85% Delivered · 8% InTransit · 4% OutForDelivery · 2% AttemptFail · 1% Exception
 *
 *   delivered_at_tracking: fulfilled_at + 2-7 days (carrier-confirmed
 *     delivery typically lags fulfilled_at by 2-7 days for EU shipping)
 *
 *   signed_by_name: only for Delivered orders, ~25% of Delivered
 *     captures a signature (PostNord captures sometimes; not as
 *     ubiquitous as US carriers). Names from a realistic Swedish pool.
 *
 * Idempotent — same RNG seed produces stable values across runs.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";

let _rng = 0x71ac17a0 | 0;
function rand() { _rng = ((_rng * 1664525 + 1013904223) >>> 0); return _rng / 0x100000000; }
function pickWeighted(buckets) {
  const total = buckets.reduce((s, b) => s + b[1], 0);
  let r = rand() * total;
  for (const [v, w] of buckets) { r -= w; if (r <= 0) return v; }
  return buckets[buckets.length - 1][0];
}

const TRACKING_SOURCES = [
  ["aftership", 60],
  [null,         25], // No tracking app installed / no Shopify sync
  ["shipway",   10],
  ["wonderment", 5],
];

const DELIVERY_STATUSES = [
  ["Delivered",       85],
  ["InTransit",        8],
  ["OutForDelivery",   4],
  ["AttemptFail",      2],
  ["Exception",        1],
];

// Swedish name pool — first name + last name, mix of common Swedish
// names that PostNord might capture on signature.
const FIRST_NAMES = [
  "Anna", "Erik", "Maria", "Johan", "Karin", "Lars", "Eva", "Per",
  "Sofia", "Anders", "Linda", "Mikael", "Karolina", "Stefan", "Emma",
  "Niklas", "Helena", "Andreas", "Lisa", "Mats",
];
const LAST_NAMES = [
  "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson",
  "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson",
  "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson",
];
function pickName() {
  return `${FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]} ${
    LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]
  }`;
}

const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

console.log(`\nFetching orders for ${SHOP_DOMAIN}...`);
async function fetchAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shopify_orders")
      .select("id, fulfilled_at")
      .eq("shop_id", shop.id)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const rows = await fetchAll();
console.log(`  ${rows.length} orders loaded\n`);

const updates = [];
let nDelivered = 0, nInTransit = 0, nSigned = 0, nNoApp = 0;
for (const r of rows) {
  const trackingSource = pickWeighted(TRACKING_SOURCES);
  if (trackingSource === null || !r.fulfilled_at) {
    // No tracking app OR order hasn't fulfilled — leave fields null
    if (trackingSource === null) nNoApp += 1;
    updates.push({
      id: r.id,
      tracking_source: null,
      delivery_status: null,
      delivered_at_tracking: null,
      signed_by_name: null,
    });
    continue;
  }
  const deliveryStatus = pickWeighted(DELIVERY_STATUSES);
  let deliveredAt = null;
  let signedBy = null;
  if (deliveryStatus === "Delivered") {
    nDelivered += 1;
    // delivered 2-7 days after fulfilled_at
    const fulMs = new Date(r.fulfilled_at).getTime();
    deliveredAt = new Date(
      fulMs + (2 + Math.floor(rand() * 5)) * 86400000,
    ).toISOString();
    // ~25% of delivered captures a signature name
    if (rand() < 0.25) {
      signedBy = pickName();
      nSigned += 1;
    }
  } else if (deliveryStatus === "InTransit" || deliveryStatus === "OutForDelivery") {
    nInTransit += 1;
  }
  updates.push({
    id: r.id,
    tracking_source: trackingSource,
    delivery_status: deliveryStatus,
    delivered_at_tracking: deliveredAt,
    signed_by_name: signedBy,
  });
}

const PARALLEL = 25;
console.log(`Updating in parallel batches of ${PARALLEL}...`);
let done = 0;
for (let i = 0; i < updates.length; i += PARALLEL) {
  const slice = updates.slice(i, i + PARALLEL);
  await Promise.all(
    slice.map((u) =>
      sb
        .from("shopify_orders")
        .update({
          tracking_source: u.tracking_source,
          delivery_status: u.delivery_status,
          delivered_at_tracking: u.delivered_at_tracking,
          signed_by_name: u.signed_by_name,
        })
        .eq("id", u.id)
        .then(({ error }) => {
          if (error) throw new Error(`update ${u.id}: ${error.message}`);
        }),
    ),
  );
  done += slice.length;
  if (done % 500 === 0 || done === updates.length) {
    console.log(`  ${done} / ${updates.length}`);
  }
}

console.log(`\nDone:`);
console.log(`  Delivered:          ${nDelivered}`);
console.log(`  In-transit / OFD:   ${nInTransit}`);
console.log(`  Signed-for:         ${nSigned} (of ${nDelivered} delivered = ${Math.round((nSigned / Math.max(nDelivered, 1)) * 100)}%)`);
console.log(`  No tracking app:    ${nNoApp}`);
process.exit(0);
