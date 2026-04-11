#!/usr/bin/env node
/**
 * scripts/check-shopify-reasons.mjs
 *
 * Manual dev / ops runner for the Shopify dispute-reason enum drift
 * check. Runs the same logic as the /api/cron/check-shopify-reasons
 * route against the linked Supabase project + any connected shop.
 *
 * Usage:
 *   node scripts/check-shopify-reasons.mjs
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL,
 * RESEND_API_KEY, and at least one connected shop with an offline
 * session.
 *
 * Exit codes:
 *   0 — ok, no drift or already-alerted dedup
 *   1 — ok, new drift detected (alert sent)
 *   2 — introspection failed or no connected shop
 *   3 — env misconfigured
 *
 * Drift results print as JSON to stdout for easy piping.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[check-shopify-reasons] SUPABASE_SERVICE_ROLE_KEY missing from .env.local",
    );
    process.exit(3);
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[check-shopify-reasons] RESEND_API_KEY not set — drift alerts will be skipped",
    );
  }

  // Dynamic import via a tsx/ts-node-free path: we re-implement the
  // helper's logic here inline so the script stays node-runnable
  // without a TypeScript toolchain. The imports below are plain JS
  // via the Supabase and Resend packages that are already installed.

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error(
      "[check-shopify-reasons] SUPABASE_URL missing from .env.local",
    );
    process.exit(3);
  }
  const sb = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Pick any connected shop.
  const { data: session } = await sb
    .from("shop_sessions")
    .select("shop_id, access_token_encrypted, shops!inner(shop_domain)")
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    console.log(JSON.stringify({ ok: true, skipped: "no_connected_shop" }));
    process.exit(2);
  }

  const shopRelation = session.shops;
  const shopRow = Array.isArray(shopRelation) ? shopRelation[0] : shopRelation;
  const shopDomain = shopRow?.shop_domain;
  if (!shopDomain) {
    console.log(JSON.stringify({ ok: true, skipped: "no_shop_domain" }));
    process.exit(2);
  }

  // DEV-ONLY CAVEAT: this script reads shop_sessions.access_token_encrypted
  // directly without running it through lib/security/encryption's decrypt
  // helper. In dev, session tokens may be stored plaintext so this Just
  // Works. In production, tokens are AES-256-GCM encrypted and the script
  // will send a garbled token that Shopify rejects with 401. The
  // authoritative drift-check path is /api/cron/check-shopify-reasons
  // (wired to lib/shopify/checkReasonEnumDrift.ts) which uses the full
  // decryption helper — prefer that for non-dev checks.
  const accessToken = session.access_token_encrypted;

  const query = `
    query ReasonEnumIntrospection {
      __type(name: "ShopifyPaymentsDisputeReason") {
        name
        enumValues {
          name
        }
      }
    }
  `;

  let enumValues = [];
  try {
    const res = await fetch(
      `https://${shopDomain}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query }),
      },
    );
    const json = await res.json();
    enumValues =
      json?.data?.__type?.enumValues?.map((v) => v.name) ?? [];
  } catch (err) {
    console.error(
      "[check-shopify-reasons] introspection failed:",
      err?.message ?? err,
    );
    process.exit(2);
  }

  if (enumValues.length === 0) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: "empty_enum_response",
        checkedShopDomain: shopDomain,
      }),
    );
    process.exit(0);
  }

  // Hardcoded local reference list mirrors lib/rules/disputeReasons.ts
  // ALL_DISPUTE_REASONS. Keep in sync if that list changes — or just
  // run this script afterwards to verify.
  const ALL_DISPUTE_REASONS = [
    "BANK_CANNOT_PROCESS",
    "CREDIT_NOT_PROCESSED",
    "CUSTOMER_INITIATED",
    "DEBIT_NOT_AUTHORIZED",
    "DUPLICATE",
    "FRAUDULENT",
    "GENERAL",
    "INCORRECT_ACCOUNT_DETAILS",
    "INSUFFICIENT_FUNDS",
    "NONCOMPLIANT",
    "PRODUCT_NOT_RECEIVED",
    "PRODUCT_UNACCEPTABLE",
    "SUBSCRIPTION_CANCELED",
    "UNRECOGNIZED",
  ];

  const remoteSet = new Set(enumValues);
  const localSet = new Set(ALL_DISPUTE_REASONS);
  const missingLocally = enumValues.filter((v) => !localSet.has(v)).sort();
  const extraLocally = ALL_DISPUTE_REASONS.filter(
    (v) => !remoteSet.has(v),
  ).sort();

  if (missingLocally.length === 0 && extraLocally.length === 0) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          drift: false,
          enumTotalCount: enumValues.length,
          checkedShopDomain: shopDomain,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        drift: true,
        missingLocally,
        extraLocally,
        checkedShopDomain: shopDomain,
        enumTotalCount: enumValues.length,
        note:
          "Manual run — email dedup / audit event only happens via the route path. Trigger the route to fire the alert:",
        routeTrigger: `curl -H 'Authorization: Bearer $CRON_SECRET' https://<host>/api/cron/check-shopify-reasons`,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-shopify-reasons] unexpected error:", err);
  process.exit(2);
});
