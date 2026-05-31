#!/usr/bin/env node
/**
 * CLI mirror of lib/env/build-identity.ts and lib/env/runtime-identity.ts.
 *
 * Runs the same dangerous-env-combination checks against the current
 * shell env. Exits non-zero on any failure. Used by:
 *
 *   - `npm run release:verify` (as the "Env identity" step)
 *   - `package.json#prebuild` so every `npm run build` (incl. Vercel's)
 *     fails fast on a misconfigured deploy
 *
 * Source-of-truth note: this file intentionally duplicates the validation
 * logic that lives in lib/env/build-identity.ts + lib/env/runtime-identity.ts.
 * Both files describe the same rules; .mjs is the CLI gate, .ts is the
 * runtime gate. Keep them in sync — if you change a rule here, change it
 * there (and vice versa), and update lib/env/__tests__/.
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.1a, §6.1b, §6.4.
 */

// Swapped from legacy Free ref `sddzuglxdnkhcnjmcpbj` → Pro ref during the
// 2026-05-28 cutover. Keep in sync with lib/env/build-identity.ts.
const KNOWN_PROD_SUPABASE_PROJECT_REF = "aokhplydttxtebvbeuzc";
const KNOWN_PROD_SHOPIFY_CLIENT_ID = "84f40ec77c9ba18e9eabc1657d9b6af8";
const PROD_APP_URL = "https://disputedesk.app";
const HEX_64 = /^[0-9a-fA-F]{64}$/;

const errors = [];
const warnings = [];
const env = process.env;

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

function extractSupabaseRef(url) {
  if (!url) return null;
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

// ─── Build-identity rules (public env) ──────────────────────────────────────

// Vercel PREVIEW deployments intentionally lack Production-scoped secrets.
// The dev/prod split narrowed SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
// the Shopify secret, etc. to the Production scope only, so a preview build of
// any non-production branch sees APP_ENV=production (set on all scopes) with the
// secrets/ref unset — and hard-fails this gate. Those builds are throwaway and
// never serve real traffic, so failing them only floods the dashboard with red
// "Error" deployments. Skip the strict checks for previews.
//
// This does NOT relax the real guard: production- AND development-TARGET builds
// run with VERCEL_ENV=production and fall through to full enforcement below, and
// local `release:verify` runs with VERCEL_ENV unset (also strict). Only Vercel
// previews (VERCEL_ENV=preview) are exempt.
if (env.VERCEL_ENV === "preview") {
  console.log(
    "[env-identity] VERCEL_ENV=preview — skipping strict identity checks (preview builds intentionally lack Production-scoped secrets).",
  );
  process.exit(0);
}

const appEnv = env.APP_ENV;
// Tolerant Phase-0 rollout: when APP_ENV is unset the verifier emits an
// informational note and skips the rest of the checks. Once the operator
// sets APP_ENV (via .env.local locally and Vercel env vars on deploy —
// Phase 0 step 10), every strict rule below activates automatically.
if (!appEnv) {
  console.log(
    "[env-identity] APP_ENV is unset — strict identity checks are skipped until Phase 0 step 10 sets it on Vercel.",
  );
  process.exit(0);
}
if (appEnv !== "development" && appEnv !== "production") {
  fail(`APP_ENV must be "development" or "production" (got "${appEnv}").`);
}

const appUrl = env.NEXT_PUBLIC_APP_URL;
if (appEnv === "production" && appUrl !== PROD_APP_URL) {
  fail(
    `APP_ENV=production but NEXT_PUBLIC_APP_URL is "${appUrl ?? ""}" (expected "${PROD_APP_URL}").`,
  );
}
if (appEnv === "development" && appUrl === PROD_APP_URL) {
  fail(
    `APP_ENV=development but NEXT_PUBLIC_APP_URL is "${PROD_APP_URL}" — would point a dev build at the production hostname.`,
  );
}

const supabaseRef =
  extractSupabaseRef(env.NEXT_PUBLIC_SUPABASE_URL) ??
  extractSupabaseRef(env.SUPABASE_URL);
if (appEnv === "development" && supabaseRef === KNOWN_PROD_SUPABASE_PROJECT_REF) {
  fail(
    `APP_ENV=development but Supabase project ref is the production ref "${KNOWN_PROD_SUPABASE_PROJECT_REF}".`,
  );
}
if (appEnv === "production" && supabaseRef !== KNOWN_PROD_SUPABASE_PROJECT_REF) {
  fail(
    `APP_ENV=production but Supabase project ref is "${supabaseRef ?? "(unset)"}" — expected "${KNOWN_PROD_SUPABASE_PROJECT_REF}".`,
  );
}

const shopifyClientId = env.SHOPIFY_API_KEY ?? env.SHOPIFY_CLIENT_ID;
if (appEnv === "development" && shopifyClientId === KNOWN_PROD_SHOPIFY_CLIENT_ID) {
  fail(
    `APP_ENV=development but SHOPIFY_API_KEY equals the known prod client_id.`,
  );
}
if (appEnv === "production" && shopifyClientId !== KNOWN_PROD_SHOPIFY_CLIENT_ID) {
  fail(
    `APP_ENV=production but SHOPIFY_API_KEY is "${(shopifyClientId ?? "").slice(0, 8)}…" — expected the known prod client_id.`,
  );
}

if (
  appEnv === "development" &&
  env.CRON_ENABLED === "true" &&
  env.CRON_ENABLED_DEV_OVERRIDE !== "true"
) {
  fail(
    "APP_ENV=development with CRON_ENABLED=true requires CRON_ENABLED_DEV_OVERRIDE=true (deliberate opt-in).",
  );
}

// ─── Runtime-identity rules (server-secret presence + shape) ────────────────

const REQUIRED_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SHOPIFY_API_SECRET",
  "TOKEN_ENCRYPTION_KEY_V1",
  "CRON_SECRET",
];
for (const name of REQUIRED_SECRETS) {
  if (!env[name] || env[name].length === 0) {
    fail(`Required secret "${name}" is missing.`);
  }
}

if (env.TOKEN_ENCRYPTION_KEY_V1 && !HEX_64.test(env.TOKEN_ENCRYPTION_KEY_V1)) {
  fail(
    "TOKEN_ENCRYPTION_KEY_V1 has the wrong shape — expected 64 hex characters (32 bytes).",
  );
}

if (
  appEnv === "development" &&
  env.EMAIL_SEND_ENABLED === "true" &&
  typeof env.EMAIL_FROM === "string" &&
  env.EMAIL_FROM.includes("mail.disputedesk.app")
) {
  fail(
    "APP_ENV=development with EMAIL_SEND_ENABLED=true but EMAIL_FROM references the prod sending subdomain.",
  );
}

// ─── Output ────────────────────────────────────────────────────────────────

let host = "";
try {
  host = appUrl ? new URL(appUrl).host : "";
} catch {
  host = appUrl ?? "";
}

const summary = [
  `APP_ENV=${appEnv ?? "(unset)"}`,
  `appUrl=${host || "(unset)"}`,
  `supabaseRefFp=${(supabaseRef ?? "").slice(0, 8) || "(unset)"}`,
  `shopifyClientIdFp=${(shopifyClientId ?? "").slice(0, 8) || "(unset)"}`,
  `cronEnabled=${env.CRON_ENABLED ?? "(unset)"}`,
].join("  ");

console.log("[env-identity]", summary);

if (warnings.length > 0) {
  for (const w of warnings) console.warn("[env-identity] ⚠ " + w);
}

if (errors.length > 0) {
  console.error("");
  console.error(`[env-identity] ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log("[env-identity] ✓ all checks passed");
