// scripts/internal/populate-dev-vercel-env.mjs
//
// One-shot: pull all prod env vars (decrypted) from the `dispute-desk`
// Vercel project, classify each, and apply transformed values to the
// `disputedesk-dev` project's Production scope.
//
// Usage: node scripts/internal/populate-dev-vercel-env.mjs
// Required env: VTOK (Vercel CLI auth token) — read from auth.json by caller.
// Reads: .env.dev-supabase.local for dev Supabase identity + hook secret.

import https from "node:https";
import crypto from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.dev-supabase.local", quiet: true });

const VTOK = process.env.VTOK;
const TEAM_ID = "team_ZlvA7gSYnGZDargMeA8lYRai";
const DEV_PROJECT = "disputedesk-dev";
const PROD_PROJECT = "dispute-desk";

const DEV_SUPABASE_URL = process.env.DEV_SUPABASE_URL;
const DEV_SUPABASE_ANON_KEY = process.env.DEV_SUPABASE_ANON_KEY;
const DEV_SUPABASE_SERVICE_ROLE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;
const DEV_SUPABASE_URL_POSTGRES = process.env.DEV_SUPABASE_URL_POSTGRES;
const DEV_SUPABASE_AUTH_HOOK_SECRET = process.env.DEV_SUPABASE_AUTH_HOOK_SECRET;
const DEV_SHOPIFY_CLIENT_ID = "bbb7c00568ffb57fecd789fa0580e309";
const DEV_SHOPIFY_SCOPES =
  "read_all_orders,read_customer_events,read_customers,read_fulfillments,read_orders,read_products,read_shipping,write_pixels";

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        host: "api.vercel.com",
        path,
        headers: {
          Authorization: "Bearer " + VTOK,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const fresh = () => crypto.randomBytes(32).toString("hex");

const PLAN = {
  // Identity → dev-specific
  APP_ENV: { action: "dev-value", value: "development" },
  NEXT_PUBLIC_APP_URL: { action: "dev-value", value: "https://dev.disputedesk.app" },
  SHOPIFY_APP_URL: { action: "dev-value", value: "https://dev.disputedesk.app" },

  // Shopify dev Partners app
  SHOPIFY_API_KEY: { action: "dev-value", value: DEV_SHOPIFY_CLIENT_ID },
  SHOPIFY_CLIENT_ID: { action: "dev-value", value: DEV_SHOPIFY_CLIENT_ID },
  SHOPIFY_SCOPES: { action: "dev-value", value: DEV_SHOPIFY_SCOPES },
  SHOPIFY_API_SECRET: { action: "skip", reason: "operator fetches from Partners → DisputeDesk-Dev → Configuration" },

  // Dev Supabase
  SUPABASE_URL: { action: "dev-value", value: DEV_SUPABASE_URL },
  NEXT_PUBLIC_SUPABASE_URL: { action: "dev-value", value: DEV_SUPABASE_URL },
  SUPABASE_ANON_KEY: { action: "dev-value", value: DEV_SUPABASE_ANON_KEY },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: { action: "dev-value", value: DEV_SUPABASE_ANON_KEY },
  SUPABASE_SERVICE_ROLE_KEY: { action: "dev-value", value: DEV_SUPABASE_SERVICE_ROLE_KEY },
  SUPABASE_URL_POSTGRES: { action: "dev-value", value: DEV_SUPABASE_URL_POSTGRES },
  SUPABASE_AUTH_HOOK_SECRET: { action: "dev-value", value: DEV_SUPABASE_AUTH_HOOK_SECRET },

  // Fresh secrets — must not reuse prod
  TOKEN_ENCRYPTION_KEY_V1: { action: "fresh" },
  TOKEN_ENCRYPTION_KEY: { action: "mirror-of", source: "TOKEN_ENCRYPTION_KEY_V1" },
  CRON_SECRET: { action: "fresh" },
  ADMIN_SECRET: { action: "fresh" },
  EVIDENCE_LINK_SECRET: { action: "fresh" },

  // Dev safety toggles
  CRON_ENABLED: { action: "dev-value", value: "false" },
  EMAIL_SEND_ENABLED: { action: "dev-value", value: "false" },

  // Seed Partners app: dev doesn't need (seed scripts only run against prod)
  SHOPIFY_SEED_CLIENT_ID: { action: "skip", reason: "seed only on prod" },
  SHOPIFY_SEED_CLIENT_SECRET: { action: "skip", reason: "same" },

  // PROXY_SECRET — shared infrastructure key with Cloudflare Worker; copy verbatim
  PROXY_SECRET: { action: "copy" },
};

(async () => {
  const r = await api(
    "GET",
    `/v9/projects/${PROD_PROJECT}/env?teamId=${TEAM_ID}&decrypt=true`
  );
  const prodEnvs = JSON.parse(r.body).envs || [];
  console.log(`Pulled ${prodEnvs.length} env vars from prod`);

  const freshSecrets = {};
  for (const k of Object.keys(PLAN)) {
    if (PLAN[k].action === "fresh") freshSecrets[k] = fresh();
  }
  for (const k of Object.keys(PLAN)) {
    if (PLAN[k].action === "mirror-of")
      freshSecrets[k] = freshSecrets[PLAN[k].source];
  }

  const toPost = [];
  const skipped = [];
  const seen = new Set();

  for (const e of prodEnvs) {
    seen.add(e.key);
    const plan = PLAN[e.key] || { action: "copy" };
    let value;
    if (plan.action === "skip") {
      skipped.push(`${e.key} (${plan.reason})`);
      continue;
    } else if (plan.action === "dev-value") {
      value = plan.value;
    } else if (plan.action === "fresh") {
      value = freshSecrets[e.key];
    } else if (plan.action === "mirror-of") {
      value = freshSecrets[e.key];
    } else if (plan.action === "copy") {
      value = e.value;
    } else {
      skipped.push(`${e.key} (unknown action)`);
      continue;
    }
    if (!value || value === "") {
      skipped.push(`${e.key} (empty)`);
      continue;
    }
    toPost.push({
      key: e.key,
      value: String(value),
      type: e.type || "encrypted",
      target: ["production"],
      gitBranch: null,
    });
  }

  // Add vars planned for dev that don't exist on prod (APP_ENV, CRON_ENABLED, EMAIL_SEND_ENABLED, etc.)
  for (const k of Object.keys(PLAN)) {
    if (seen.has(k)) continue;
    const plan = PLAN[k];
    let value;
    if (plan.action === "dev-value") value = plan.value;
    else if (plan.action === "fresh") value = freshSecrets[k];
    else if (plan.action === "mirror-of") value = freshSecrets[k];
    else continue;
    if (!value) continue;
    toPost.push({
      key: k,
      value: String(value),
      type: "encrypted",
      target: ["production"],
      gitBranch: null,
    });
  }

  console.log(`Will POST ${toPost.length} env vars to ${DEV_PROJECT}`);
  console.log("Skipped:", skipped.length ? skipped.join(", ") : "(none)");

  const postRes = await api(
    "POST",
    `/v10/projects/${DEV_PROJECT}/env?teamId=${TEAM_ID}&upsert=true`,
    toPost
  );
  console.log("POST status:", postRes.status);
  try {
    const j = JSON.parse(postRes.body);
    if (j.error) console.log("error:", j.error.message);
    if (j.created) console.log("created:", j.created.length);
    if (j.failed && j.failed.length) {
      console.log("failed count:", j.failed.length);
      console.log("first 3 failures:", JSON.stringify(j.failed.slice(0, 3), null, 2));
    }
  } catch (e) {
    console.log("raw response head:", postRes.body.slice(0, 500));
  }

  const verify = await api(
    "GET",
    `/v9/projects/${DEV_PROJECT}/env?teamId=${TEAM_ID}`
  );
  const devEnvs = (JSON.parse(verify.body).envs || []).filter((e) =>
    (e.target || []).includes("production")
  );
  console.log(`\nDev project now has ${devEnvs.length} env vars on Production scope`);
  const samples = [
    "APP_ENV",
    "NEXT_PUBLIC_APP_URL",
    "SHOPIFY_API_KEY",
    "SUPABASE_URL",
    "CRON_ENABLED",
    "EMAIL_SEND_ENABLED",
    "TOKEN_ENCRYPTION_KEY_V1",
  ];
  for (const s of samples) {
    const v = devEnvs.find((e) => e.key === s);
    console.log(
      `  ${s}: ${v ? (v.value ? v.value.slice(0, 50) : "(stored, value not in GET response)") : "(MISSING)"}`
    );
  }
})();
