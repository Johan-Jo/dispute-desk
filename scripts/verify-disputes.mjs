#!/usr/bin/env node
/**
 * Verify orders and Shopify Payments disputes for a store (e.g. after seed-real-disputes).
 * Requires: SHOPIFY_ADMIN_TOKEN or app credentials in .env.local; read_shopify_payments_disputes for disputes.
 *
 * Usage:
 *   node scripts/verify-disputes.mjs [--shop domain] [--run-id RUN_ID] [--since ISO_DATE]
 */

import { readFileSync } from "fs";
import { join } from "path";
import { getAdminToken } from "./shopify/admin-token.mjs";

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  try {
    const raw = readFileSync(envPath, "utf-8");
    const vars = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1] ?? def;
};

const env = loadEnv();
const shop = (get("--shop") || env.SHOPIFY_STORE_DOMAIN || "surasvenne.myshopify.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const runId = get("--run-id", "2026-03-05-mmdax8iw");
const since = get("--since", "2026-03-05T00:00:00.000Z");
const jsonOnly = args.includes("--json");
const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";

async function restGet(token, path) {
  const url = `https://${shop}/admin/api/${apiVersion}${path}`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const token = await getAdminToken({ shop, env });

  console.log("Shop:", shop);
  console.log("---");

  // 1) Orders (optional filter by run email pattern)
  const ordersPath = `/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`;
  let orders = [];
  try {
    const ordersData = await restGet(token, ordersPath);
    orders = ordersData?.orders || [];
  } catch (e) {
    console.log("Orders:", "Error -", e.message);
  }

  const runOrders = orders.filter((o) => (o.email || "").includes(`dd+${runId}+`));
  const tagged = runOrders.filter(
    (o) => (o.tags || "").includes("dd-real-dispute") || (o.tags || "").includes(`dd-run:${runId}`)
  );

  let disputes = [];
  try {
    const disputesData = await restGet(token, "/shopify_payments/disputes.json");
    disputes = disputesData?.disputes || [];
  } catch (e) {
    if (!jsonOnly) console.log("Disputes: Error -", e.message);
    if (!jsonOnly && e.message.includes("403")) console.log("  (App needs read_shopify_payments_disputes scope.)");
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ orders: orders.length, runOrders: runOrders.length, disputes: disputes.length }));
    return;
  }

  console.log("Orders (since " + since + "):", orders.length);
  console.log("  Run " + runId + " (email match):", runOrders.length);
  console.log("  Tagged (dd-real-dispute / dd-run:" + runId + "):", tagged.length);
  if (runOrders.length > 0) {
    console.log("  Sample:", runOrders.slice(0, 3).map((o) => o.name + " " + (o.email || "").slice(0, 40)).join("; "));
  }
  console.log("---");
  console.log("Disputes (Shopify Payments):", disputes.length);
  if (disputes.length > 0) {
    disputes.slice(0, 10).forEach((d) => {
      console.log("  ", d.id, "order_id:", d.order_id, "type:", d.type, "status:", d.status, "amount:", d.amount);
    });
    if (disputes.length > 10) console.log("  ... and", disputes.length - 10, "more");
  }
  console.log("---");
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
