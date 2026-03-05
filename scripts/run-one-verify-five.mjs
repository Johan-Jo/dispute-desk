#!/usr/bin/env node
/**
 * Run 1 order (seed-real-disputes), then verify in DB (verify-disputes), 5 times in a row.
 * Verifies each run in the Shopify DB before proceeding to the next.
 *
 * Usage: node scripts/run-one-verify-five.mjs [--shop domain]
 */

import { execSync } from "child_process";
import { join } from "path";

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1] ?? def;
};

const shop = get("--shop") || "surasvenne.myshopify.com";
const productHandle = "1000-piece-landscape-puzzle";
const cwd = process.cwd();

// Start of today UTC for --since so we only count today's orders/disputes
const since = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";

function runSeed() {
  console.log("\n[Seed] Running 1 order...");
  execSync(
    `node scripts/seed-real-disputes.mjs "${shop}" "${productHandle}" 1 --i-know-this-is-test-mode`,
    { cwd, stdio: "inherit", shell: true }
  );
}

function runVerifyJson() {
  const out = execSync(
    `node scripts/verify-disputes.mjs --shop "${shop}" --since "${since}" --json`,
    { cwd, encoding: "utf-8", shell: true }
  );
  const line = out.trim().split("\n").pop();
  return JSON.parse(line);
}

async function main() {
  console.log("Run 1 order → verify in DB, 5 times consecutive");
  console.log("Shop:", shop, "| Since:", since);

  let prev = null;
  for (let round = 1; round <= 5; round++) {
    console.log("\n" + "=".repeat(50));
    console.log("Round", round, "of 5");
    console.log("=".repeat(50));

    runSeed();

    console.log("\n[Verify] Waiting 8s for Shopify to surface order/dispute...");
    await new Promise((r) => setTimeout(r, 8000));

    const v = runVerifyJson();
    console.log("[Verify] DB now: orders=" + v.orders + ", disputes=" + v.disputes);

    if (prev !== null) {
      const orderDelta = v.orders - prev.orders;
      const disputeDelta = v.disputes - prev.disputes;
      if (orderDelta >= 1 && disputeDelta >= 1) {
        console.log("[Verify] OK: +" + orderDelta + " order(s), +" + disputeDelta + " dispute(s)");
      } else {
        console.log("[Verify] WARNING: expected +1 order and +1 dispute (got +" + orderDelta + " order, +" + disputeDelta + " dispute)");
      }
    } else {
      console.log("[Verify] Baseline: " + v.orders + " orders, " + v.disputes + " disputes");
    }
    prev = v;
  }

  console.log("\n" + "=".repeat(50));
  console.log("Done. Final DB state:");
  execSync(`node scripts/verify-disputes.mjs --shop "${shop}" --since "${since}"`, {
    cwd,
    stdio: "inherit",
    shell: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
