// Verifies the Phase 1 fraud-intelligence migration:
//   1. tables exist and accept inserts
//   2. shopify_orders_lock_initial_risk_trg rejects updates to
//      risk_level_initial / risk_recommendation_initial / risk_provider_initial
//   3. the same trigger permits the null → first-observed transition
//
// Uses the Supabase service-role client (PostgREST). Cleans up after
// itself: every row created here is deleted before exit.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supa = createClient(url, key, { auth: { persistSession: false } });

let exitCode = 0;
function pass(msg) { console.log(`  PASS  ${msg}`); }
function fail(msg) { console.error(`  FAIL  ${msg}`); exitCode = 1; }

const createdShopIds = [];
const ORDER_PREFIX = `gid://shopify/Order/verify-${Date.now()}-`;

async function makeShop(label) {
  const domain = `verify-fraud-intel-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
  const { data, error } = await supa
    .from("shops")
    .insert({ shop_domain: domain })
    .select("id")
    .single();
  if (error) throw error;
  createdShopIds.push(data.id);
  return data.id;
}

try {
  // ── 1. table presence: trivial inserts ─────────────────────────
  const probeShop = await makeShop("probe");

  // shopify_orders insert
  {
    const { error } = await supa.from("shopify_orders").insert({
      shop_id: probeShop,
      shopify_order_id: `${ORDER_PREFIX}probe`,
      created_at_shopify: new Date().toISOString(),
      currency: "USD",
      order_total: 10.0,
    });
    if (error) fail(`shopify_orders insert failed: ${error.message}`);
    else pass("shopify_orders accepts insert");
  }

  // shopify_order_risk_assessments insert
  {
    const { error } = await supa.from("shopify_order_risk_assessments").insert({
      shop_id: probeShop,
      shopify_order_id: `${ORDER_PREFIX}probe`,
      provider: "shopify",
      risk_level: "LOW",
      recommendation: "ACCEPT",
    });
    if (error) fail(`shopify_order_risk_assessments insert failed: ${error.message}`);
    else pass("shopify_order_risk_assessments accepts insert");
  }

  // shop_fraud_daily_metrics insert
  {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supa.from("shop_fraud_daily_metrics").insert({
      shop_id: probeShop,
      date: today,
      orders_total: 1,
    });
    if (error) fail(`shop_fraud_daily_metrics insert failed: ${error.message}`);
    else pass("shop_fraud_daily_metrics accepts insert");
  }

  // shops historical_import_* defaults
  {
    const { data, error } = await supa
      .from("shops")
      .select("historical_import_status,historical_import_progress_pct,historical_import_orders_processed")
      .eq("id", probeShop)
      .single();
    if (error) fail(`shops select failed: ${error.message}`);
    else if (
      data.historical_import_status === "not_started" &&
      data.historical_import_progress_pct === 0 &&
      data.historical_import_orders_processed === 0
    ) {
      pass("shops historical_import_* defaults applied");
    } else {
      fail(`shops historical_import defaults wrong: ${JSON.stringify(data)}`);
    }
  }

  // ── 2. trigger: rejects risk_level_initial change ───────────────
  {
    const shopId = await makeShop("rl");
    const orderId = `${ORDER_PREFIX}rl`;
    await supa.from("shopify_orders").insert({
      shop_id: shopId,
      shopify_order_id: orderId,
      created_at_shopify: new Date().toISOString(),
      currency: "USD",
      order_total: 10.0,
      risk_level_initial: "LOW",
      risk_recommendation_initial: "ACCEPT",
      risk_provider_initial: "shopify",
    });

    // Permitted: non-risk update
    {
      const { error } = await supa
        .from("shopify_orders")
        .update({ has_chargeback: true })
        .eq("shop_id", shopId)
        .eq("shopify_order_id", orderId);
      if (error) fail(`non-risk update wrongly rejected: ${error.message}`);
      else pass("non-risk column update permitted");
    }

    // Forbidden: risk_level_initial change
    {
      const { error } = await supa
        .from("shopify_orders")
        .update({ risk_level_initial: "HIGH" })
        .eq("shop_id", shopId)
        .eq("shopify_order_id", orderId);
      if (!error) {
        fail("risk_level_initial update was NOT rejected");
      } else if (error.message.includes("risk_level_initial is immutable")) {
        pass("risk_level_initial update correctly rejected");
      } else {
        fail(`risk_level_initial rejection wrong message: ${error.message}`);
      }
    }
  }

  // ── 3. trigger: rejects risk_recommendation_initial change ──────
  {
    const shopId = await makeShop("rr");
    const orderId = `${ORDER_PREFIX}rr`;
    await supa.from("shopify_orders").insert({
      shop_id: shopId,
      shopify_order_id: orderId,
      created_at_shopify: new Date().toISOString(),
      currency: "USD",
      order_total: 20.0,
      risk_level_initial: "MEDIUM",
      risk_recommendation_initial: "INVESTIGATE",
      risk_provider_initial: "shopify",
    });
    const { error } = await supa
      .from("shopify_orders")
      .update({ risk_recommendation_initial: "REJECT" })
      .eq("shop_id", shopId)
      .eq("shopify_order_id", orderId);
    if (!error) {
      fail("risk_recommendation_initial update was NOT rejected");
    } else if (error.message.includes("risk_recommendation_initial is immutable")) {
      pass("risk_recommendation_initial update correctly rejected");
    } else {
      fail(`risk_recommendation_initial rejection wrong message: ${error.message}`);
    }
  }

  // ── 4. trigger: rejects risk_provider_initial change ────────────
  {
    const shopId = await makeShop("rp");
    const orderId = `${ORDER_PREFIX}rp`;
    await supa.from("shopify_orders").insert({
      shop_id: shopId,
      shopify_order_id: orderId,
      created_at_shopify: new Date().toISOString(),
      currency: "USD",
      order_total: 30.0,
      risk_level_initial: "HIGH",
      risk_recommendation_initial: "REJECT",
      risk_provider_initial: "shopify",
    });
    const { error } = await supa
      .from("shopify_orders")
      .update({ risk_provider_initial: "other" })
      .eq("shop_id", shopId)
      .eq("shopify_order_id", orderId);
    if (!error) {
      fail("risk_provider_initial update was NOT rejected");
    } else if (error.message.includes("risk_provider_initial is immutable")) {
      pass("risk_provider_initial update correctly rejected");
    } else {
      fail(`risk_provider_initial rejection wrong message: ${error.message}`);
    }
  }

  // ── 5. trigger: permits null → first observed transition ───────
  {
    const shopId = await makeShop("nullok");
    const orderId = `${ORDER_PREFIX}nullok`;
    await supa.from("shopify_orders").insert({
      shop_id: shopId,
      shopify_order_id: orderId,
      created_at_shopify: new Date().toISOString(),
      currency: "USD",
      order_total: 40.0,
    });
    const { error } = await supa
      .from("shopify_orders")
      .update({
        risk_level_initial: "LOW",
        risk_recommendation_initial: "ACCEPT",
        risk_provider_initial: "shopify",
      })
      .eq("shop_id", shopId)
      .eq("shopify_order_id", orderId);
    if (error) fail(`null → first observed transition wrongly rejected: ${error.message}`);
    else pass("null → first observed risk values permitted");
  }

  // ── 6. constraint: historical_import_status check ───────────────
  {
    const shopId = await makeShop("badstate");
    const { error } = await supa
      .from("shops")
      .update({ historical_import_status: "bogus_value" })
      .eq("id", shopId);
    if (!error) fail("invalid historical_import_status was accepted");
    else pass("historical_import_status check constraint enforced");
  }

  console.log(exitCode === 0 ? "\nAll checks passed." : "\nFAILED.");
} catch (e) {
  console.error("verification script crashed:", e);
  exitCode = 1;
} finally {
  // cleanup — cascade deletes child rows
  if (createdShopIds.length) {
    await supa.from("shops").delete().in("id", createdShopIds);
  }
}
process.exit(exitCode);
