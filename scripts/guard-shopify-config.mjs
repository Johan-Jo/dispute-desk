#!/usr/bin/env node
/**
 * scripts/guard-shopify-config.mjs
 *
 * Refuses to proceed if shopify.app.{dev,prod}.toml has a dangerous value
 * pair (e.g. dev TOML pointing at the prod URL, or prod TOML pointing at
 * the dev client_id). Wraps `shopify app deploy` so a bare invocation
 * can't cross the dev/prod boundary.
 *
 * Invoked by:
 *   npm run shopify:deploy:dev   →  guard-shopify-config.mjs dev
 *   npm run shopify:deploy:prod  →  guard-shopify-config.mjs prod
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §8.
 *
 * TOML parsing note: the script extracts only the fields it validates via
 * a small regex extractor. It is NOT a general TOML parser — it knows how
 * to read `client_id`, `application_url`, `embedded`, `api_version`, and
 * the webhook sections of shopify.app.*.toml as written by the Shopify CLI.
 * If the CLI's output shape changes, update the extractors.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const KNOWN_PROD_CLIENT_ID = "84f40ec77c9ba18e9eabc1657d9b6af8";
const PROD_URL = "https://disputedesk.app";
const DEV_URL = "https://dev.disputedesk.app";
const PINNED_API_VERSION = "2026-01";
const REQUIRED_SUBSCRIPTION_TOPICS = ["app/uninstalled", "shop/update"];
const REQUIRED_PRIVACY_URLS = [
  "customer_data_request_url",
  "customer_deletion_url",
  "shop_deletion_url",
];

const target = process.argv[2];
if (target !== "dev" && target !== "prod") {
  die(`usage: guard-shopify-config.mjs <dev|prod>`);
}

const tomlPath = resolve(process.cwd(), `shopify.app.${target}.toml`);
if (!existsSync(tomlPath)) {
  die(`expected file ${tomlPath} does not exist — has it been linked via \`shopify app config link --config=${target}\` yet?`);
}

const src = readFileSync(tomlPath, "utf8");

const cfg = {
  client_id: matchOne(src, /^client_id\s*=\s*"([^"]+)"/m),
  application_url: matchOne(src, /^application_url\s*=\s*"([^"]+)"/m),
  embedded: matchOne(src, /^embedded\s*=\s*(true|false)/m) === "true",
  api_version: matchOne(src, /\[webhooks\][\s\S]*?api_version\s*=\s*"([^"]+)"/),
  subscription_topics: extractAllSubscriptionTopics(src),
  privacy_block: src.includes("[webhooks.privacy_compliance]"),
  privacy_urls: REQUIRED_PRIVACY_URLS.reduce((acc, key) => {
    acc[key] = matchOne(src, new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
    return acc;
  }, {}),
};

const errors = [];

// — Identity rules (target-specific) —
if (target === "prod") {
  if (cfg.client_id !== KNOWN_PROD_CLIENT_ID) {
    errors.push(`target=prod but client_id is "${cfg.client_id}" — expected the known prod client_id "${KNOWN_PROD_CLIENT_ID}".`);
  }
  if (cfg.application_url !== PROD_URL) {
    errors.push(`target=prod but application_url is "${cfg.application_url}" — expected "${PROD_URL}".`);
  }
} else {
  if (cfg.client_id === KNOWN_PROD_CLIENT_ID) {
    errors.push(`target=dev but client_id equals the known prod client_id "${KNOWN_PROD_CLIENT_ID}" — would deploy dev config to the prod Partners app.`);
  }
  if (cfg.application_url !== DEV_URL) {
    errors.push(`target=dev but application_url is "${cfg.application_url}" — expected "${DEV_URL}".`);
  }
  if (cfg.client_id === "TBD-after-shopify-app-config-link") {
    errors.push(`target=dev but client_id is still the placeholder — run \`npx shopify@3.94.3 app config link --config=dev\` first so the CLI fills in the real client_id.`);
  }
}

// — Cross-cutting rules (apply to both targets) —
if (cfg.embedded !== true) {
  errors.push(`embedded must be true (got ${cfg.embedded}).`);
}
if (cfg.api_version !== PINNED_API_VERSION) {
  errors.push(`api_version must be "${PINNED_API_VERSION}" (got "${cfg.api_version}").`);
}
for (const topic of REQUIRED_SUBSCRIPTION_TOPICS) {
  if (!cfg.subscription_topics.includes(topic)) {
    errors.push(`missing required webhook subscription: ${topic}.`);
  }
}
if (!cfg.privacy_block) {
  errors.push(`missing [webhooks.privacy_compliance] section — GDPR webhooks won't register.`);
} else {
  for (const key of REQUIRED_PRIVACY_URLS) {
    if (!cfg.privacy_urls[key]) {
      errors.push(`[webhooks.privacy_compliance] missing required field: ${key}.`);
    }
  }
}

// Summary output
console.log(`[guard-shopify-config] target=${target} file=shopify.app.${target}.toml`);
console.log(`  name:            ${matchOne(src, /^name\s*=\s*"([^"]+)"/m) ?? "(unset)"}`);
console.log(`  client_id:       ${(cfg.client_id ?? "(unset)").slice(0, 8)}...`);
console.log(`  application_url: ${cfg.application_url ?? "(unset)"}`);
console.log(`  api_version:     ${cfg.api_version ?? "(unset)"}`);
console.log(`  subscriptions:   ${cfg.subscription_topics.join(", ") || "(none)"}`);
console.log(`  privacy block:   ${cfg.privacy_block ? "present" : "MISSING"}`);

if (errors.length > 0) {
  console.error("");
  console.error(`[guard-shopify-config] ✗ ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`[guard-shopify-config] ✓ all checks passed`);

// ─── helpers ────────────────────────────────────────────────────────────

function matchOne(src, re) {
  const m = src.match(re);
  return m ? m[1] : null;
}

function extractAllSubscriptionTopics(src) {
  // Subscription blocks look like:
  //   [[webhooks.subscriptions]]
  //   topics = ["app/uninstalled"]
  //   uri = "/api/..."
  // The topics array can contain one or multiple comma-separated entries.
  const topics = [];
  const re = /\[\[webhooks\.subscriptions\]\][^\[]*?topics\s*=\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const inner = m[1];
    const parsed = [...inner.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    topics.push(...parsed);
  }
  return topics;
}

function die(msg) {
  console.error(`[guard-shopify-config] ${msg}`);
  process.exit(1);
}
