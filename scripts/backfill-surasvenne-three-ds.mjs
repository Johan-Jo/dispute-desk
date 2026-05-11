/**
 * Populates three_ds_authenticated on surasvenne's existing
 * shopify_orders rows. The column was added 2026-05-11 and didn't
 * exist when the v2 seed wrote — every row is currently NULL.
 *
 * Distribution applied:
 *   shopify_payments gateway: ~50% true, ~50% false (PSD2-era EU
 *     merchant; 3DS uptake roughly even with non-3DS legacy flows)
 *   non-shopify_payments: null (we never trust the receipt shape)
 *
 * Uses Supabase's batched upsert (500 rows per call) so 6300 orders
 * complete in ~20 round-trips, not 6300. Deterministic RNG.
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
const SHOPIFY_PAYMENTS_3DS_RATE = 0.5;

let _rng = 0x3d5eed_a0 | 0;
function rand() { _rng = ((_rng * 1664525 + 1013904223) >>> 0); return _rng / 0x100000000; }

const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

console.log(`\nFetching orders for ${SHOP_DOMAIN}...`);
async function fetchAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shopify_orders")
      .select("id, payment_gateway")
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

let updated3DsPositive = 0;
let updated3DsNegative = 0;
let updatedNull = 0;
const updates = rows.map((r) => {
  let value;
  if (r.payment_gateway === "shopify_payments") {
    value = rand() < SHOPIFY_PAYMENTS_3DS_RATE;
    if (value) updated3DsPositive++; else updated3DsNegative++;
  } else {
    value = null;
    updatedNull++;
  }
  return { id: r.id, three_ds_authenticated: value };
});

// Per-row UPDATE in parallel batches. Upsert won't work here because
// PostgREST validates NOT NULL columns on the INSERT shape even when
// the on-conflict path is taken — and we don't want to ship the
// other columns just to satisfy the validator.
const PARALLEL = 25;
console.log(`Updating in parallel batches of ${PARALLEL}...`);
let done = 0;
for (let i = 0; i < updates.length; i += PARALLEL) {
  const slice = updates.slice(i, i + PARALLEL);
  await Promise.all(
    slice.map((u) =>
      sb
        .from("shopify_orders")
        .update({ three_ds_authenticated: u.three_ds_authenticated })
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
console.log(`  3DS true:  ${updated3DsPositive}`);
console.log(`  3DS false: ${updated3DsNegative}`);
console.log(`  null:      ${updatedNull}`);
process.exit(0);
