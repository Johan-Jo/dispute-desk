// scripts/internal/seed-guard.mjs
//
// Refuses to let a seed script run against the wrong environment.
//
// Three guard modes — each script picks the one that matches its data:
//
//   requireDev()          — script writes synthetic / test-only data
//                            (e.g. seed-synthetic-disputes). Aborts if
//                            APP_ENV !== "development". Use for any
//                            script that creates fake disputes, fake
//                            orders, fake shops, or test fixtures.
//
//   requireProdAllowed()  — script writes operational content that
//                            ships to production (e.g. seed-resources
//                            hub, pack_templates, etc.). Aborts on
//                            APP_ENV=production unless the operator
//                            explicitly passes --allow-prod. Idempotent
//                            on re-run.
//
//   markProdSafe()        — purely informational: declares the script
//                            as safe to run against prod (idempotent
//                            inserts only, no destructive ops). No
//                            runtime check; the marker is what
//                            docs/runbooks/prod-release.md greps for.
//
// Reference: docs/plans/dev-prod-environment-split.plan.md §Phase 4.

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");
if (existsSync(ENV_FILE)) {
  // Best-effort: load .env.local so seed scripts see APP_ENV without the
  // caller needing to source it. Silent if .env.local doesn't exist.
  loadEnv({ path: ENV_FILE, quiet: true });
}

function die(reason) {
  console.error("");
  console.error(`[seed-guard] ✗ ${reason}`);
  console.error("");
  process.exit(1);
}

/**
 * Abort unless APP_ENV is exactly "development". For seed scripts that
 * write synthetic / fake / test-only data.
 */
export function requireDev() {
  const appEnv = process.env.APP_ENV;
  if (appEnv === "development") return;
  if (!appEnv) {
    die(
      `APP_ENV is unset. This seed script writes synthetic data and refuses to run without an explicit env. ` +
        `Set APP_ENV=development in .env.local or run with APP_ENV=development inline.`,
    );
  }
  die(
    `APP_ENV=${appEnv}. This seed script writes synthetic data and is dev-only. ` +
      `Refusing to run against a non-dev environment to avoid contaminating prod state.`,
  );
}

/**
 * Allow the script to run, but require an explicit `--allow-prod` CLI
 * flag when APP_ENV is production. Use for content / marketing seeds
 * that legitimately ship to production but should never accidentally.
 */
export function requireProdAllowed() {
  const appEnv = process.env.APP_ENV;
  const allowProd = process.argv.includes("--allow-prod");
  if (appEnv === "production" && !allowProd) {
    die(
      `APP_ENV=production. This script publishes content to production and requires an explicit ` +
        `--allow-prod flag to confirm. Re-run as:  <command> --allow-prod`,
    );
  }
  if (!appEnv) {
    // Treat unset as dev for safety — script may still write, but won't
    // hit prod since Supabase creds in .env.local point at dev/local
    // (the env-identity primitives ensure that).
    console.warn(
      `[seed-guard] APP_ENV is unset; treating as non-prod. Pass APP_ENV=production --allow-prod to publish to prod.`,
    );
  }
}

/**
 * Informational marker. Greppable by docs/runbooks/prod-release.md as
 * `PROD_SAFE: true`. No runtime check — the script author is asserting
 * the script is idempotent and prod-safe.
 */
export const PROD_SAFE = true;
// PROD_SAFE: true
