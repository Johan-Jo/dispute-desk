#!/usr/bin/env node
/**
 * Zero out setup wizard state for a shop so you can start over.
 *
 * Usage:
 *   node -e "require('dotenv').config({path:'.env.local'}); require('child_process').execSync('node scripts/reset-setup.mjs --shop <domain>', {stdio:'inherit', env:process.env})"
 *   Or with env already loaded:
 *   node scripts/reset-setup.mjs --shop dispute-ops-test.myshopify.com
 *
 * Requires: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Load .env.local or set env.");
  process.exit(1);
}

const args = process.argv.slice(2);
const shopIdx = args.indexOf("--shop");
const shopDomain = shopIdx !== -1 ? args[shopIdx + 1] : null;

if (!shopDomain || !shopDomain.includes(".myshopify.com")) {
  console.error("Usage: node scripts/reset-setup.mjs --shop <store>.myshopify.com");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data: shop, error: shopError } = await db
  .from("shops")
  .select("id")
  .eq("shop_domain", shopDomain)
  .single();

if (shopError || !shop) {
  console.error("Shop not found:", shopDomain, shopError?.message || "");
  process.exit(1);
}

const shopId = shop.id;

const { data: existing } = await db
  .from("shop_setup")
  .select("shop_id, steps, current_step")
  .eq("shop_id", shopId)
  .single();

const { error: upsertError } = await db
  .from("shop_setup")
  .upsert(
    {
      shop_id: shopId,
      steps: {},
      current_step: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id" }
  );

if (upsertError) {
  console.error("Failed to reset setup:", upsertError.message);
  process.exit(1);
}

console.log("Reset setup for shop:", shopDomain);
console.log("  shop_id (uuid):", shopId);
if (existing) {
  console.log("  Previous steps:", Object.keys(existing.steps || {}).length, "step(s) had state");
  console.log("  Previous current_step:", existing.current_step ?? "(none)");
}
console.log("  Now: steps = {}, current_step = null. You can start the wizard over.");
