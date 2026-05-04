/**
 * Shared env-loading helper for production scripts (Phase 4.1).
 *
 * Loads `.env.local` from the project root and asserts that the
 * specified env vars are present. Throws with a clear message on
 * the first missing var so the script doesn't silently produce
 * `createClient(undefined, undefined, ...)` and emit a confusing
 * downstream error.
 *
 *   import { loadEnv } from "./lib/env.mjs";
 *   const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = loadEnv([
 *     "SUPABASE_URL",
 *     "SUPABASE_SERVICE_ROLE_KEY",
 *   ]);
 *
 * Honors the legacy fallback `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`
 * via `loadSupabaseEnv()` which is the only env shape every script
 * ever needs in this repo today. Add new specialized helpers here
 * rather than asking each script to repeat the pattern.
 */

import { config } from "dotenv";
import { join } from "path";

let loaded = false;
function ensureDotenv() {
  if (loaded) return;
  config({ path: join(process.cwd(), ".env.local") });
  loaded = true;
}

/**
 * Load required env vars from .env.local. Returns an object whose
 * keys are exactly the requested names. Throws if any is missing.
 */
export function loadEnv(required) {
  ensureDotenv();
  const out = {};
  const missing = [];
  for (const name of required) {
    const value = process.env[name];
    if (!value) {
      missing.push(name);
    } else {
      out[name] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars in .env.local: ${missing.join(", ")}`,
    );
  }
  return out;
}

/**
 * Specialized loader for the most-common shape — Supabase URL + service
 * role key. Honors the `NEXT_PUBLIC_SUPABASE_URL` legacy fallback so
 * scripts pre-dating the rename keep working.
 */
export function loadSupabaseEnv() {
  ensureDotenv();
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local",
    );
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  return { url, serviceRoleKey };
}
