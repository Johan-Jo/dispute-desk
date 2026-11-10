/**
 * Repair disputes whose stored classification disagrees with the order's
 * stored payment method — the damage left by the five-pickers bug fixed in
 * lib/shopify/transactions/primaryTransaction.ts (a failed card attempt
 * listed before the real Klarna/PayPal payment made the dispute "card").
 *
 * What it does, per OPEN dispute whose order is NON-card but whose
 * network_reason_code_confidence is inferred/derived/unknown (or whose order
 * IS card but is marked not_card_network):
 *   enqueue a normal `build_pack` job (priority 90) for its latest pack.
 *   buildPack re-runs derivePaymentContext + enrichDisputeWithNetworkReasonCode
 *   with the fixed picker, then the usual chain follows (defence package,
 *   save gate). The script writes nothing else: no status resets, no
 *   deletes, and the dispute's automation mode / approval gates still apply.
 *
 * Usage (dry-run by default; prints the exact set first):
 *   node scripts/repair-payment-family-misclassified.mjs --env-file .env.production.local
 *   node scripts/repair-payment-family-misclassified.mjs --env-file .env.production.local --apply
 *   ... --dispute-id <uuid> [--dispute-id <uuid>]   restrict to named disputes
 *
 * Deploy the picker fix BEFORE running with --apply, or the rebuild will
 * reproduce the same wrong answer.
 *
 * Skipped (and reported): disputes already submitted_confirmed (the window
 * is closed), packs already queued/building/saving, closed disputes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const envFlagIdx = argv.indexOf("--env-file");
const envFile = envFlagIdx > -1 ? argv[envFlagIdx + 1] : ".env.production.local";
const apply = argv.includes("--apply");
const onlyIds = argv.flatMap((a, i) => (a === "--dispute-id" ? [argv[i + 1]] : []));

const envRaw = readFileSync(resolve(process.cwd(), envFile), "utf8");
const readEnv = (key) => {
  const m = envRaw.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const SUPABASE_URL = readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}
const projectRef = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "unknown";
console.log(`env-file: ${envFile}`);
console.log(`supabase project ref: ${projectRef}`);
console.log(`mode: ${apply ? "APPLY (enqueues jobs)" : "dry-run (no writes)"}\n`);

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Same sets as pickPaymentMethod in lib/shopify/queries/ordersForBackfill.ts.
const CARD_METHODS = new Set([
  "card", "apple_pay", "google_pay", "shopify_pay", "android_pay",
  "samsung_pay", "masterpass", "visa_checkout", "amazon_pay",
]);
const CLOSED = new Set(["won", "lost", "accepted", "charge_refunded"]);
const IN_FLIGHT = new Set(["queued", "building", "saving", "saved_to_shopify_unverified"]);

async function main() {
  // 1000-row PostgREST cap: page through all disputes that carry a
  // classification, then filter in JS (the set is tiny).
  const suspects = [];
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("disputes")
      .select("id, shop_id, order_gid, status, phase, due_at, submission_state, network_reason_code, network_reason_code_confidence")
      .not("order_gid", "is", null)
      .not("network_reason_code_confidence", "is", null)
      .range(from, from + 999);
    if (onlyIds.length) q = q.in("id", onlyIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    suspects.push(...data);
    if (data.length < 1000) break;
  }

  const rows = [];
  for (const d of suspects) {
    if (CLOSED.has(d.status)) continue;
    const { data: o } = await db
      .from("shopify_orders")
      .select("shopify_order_number, payment_method")
      .eq("shop_id", d.shop_id)
      .eq("shopify_order_id", d.order_gid)
      .maybeSingle();
    const pm = o?.payment_method ?? null;
    if (!pm) continue;
    const isCard = CARD_METHODS.has(pm);
    const conf = d.network_reason_code_confidence;
    const mismatch = isCard
      ? conf === "not_card_network"
      : ["inferred", "derived", "unknown"].includes(conf);
    if (mismatch) rows.push({ d, order: o.shopify_order_number, pm });
  }

  console.log(`Open disputes with order/classification disagreement: ${rows.length}`);
  for (const { d, order, pm } of rows) {
    console.log(
      `  ${d.id}  shop=${d.shop_id}  order=${order}  payment_method=${pm}  ` +
        `code=${d.network_reason_code ?? "NULL"}  conf=${d.network_reason_code_confidence}  ` +
        `status=${d.status}  phase=${d.phase}  due=${(d.due_at ?? "").slice(0, 10)}`,
    );
  }
  if (!apply) {
    console.log("\nDry-run: nothing enqueued. Re-run with --apply to rebuild these.");
    return;
  }

  for (const { d } of rows) {
    if (d.submission_state === "submitted_confirmed") {
      console.log(`SKIP ${d.id}: submitted_confirmed (window closed)`);
      continue;
    }
    const { data: pack } = await db
      .from("evidence_packs")
      .select("id, status")
      .eq("dispute_id", d.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pack) {
      console.log(`SKIP ${d.id}: no pack`);
      continue;
    }
    if (IN_FLIGHT.has(pack.status)) {
      console.log(`SKIP ${d.id}: pack ${pack.id} already ${pack.status}`);
      continue;
    }
    const { error } = await db.from("jobs").insert({
      shop_id: d.shop_id,
      job_type: "build_pack",
      entity_id: pack.id,
      priority: 90,
      status: "queued",
    });
    console.log(error ? `FAIL ${d.id}: ${error.message}` : `ENQUEUED build_pack for ${d.id} (pack ${pack.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
