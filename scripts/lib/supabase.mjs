/**
 * Shared Supabase client factory for production scripts (Phase 4.1).
 *
 * Replaces the boilerplate that lived inline in roughly every script:
 *
 *   const sb = createClient(
 *     process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
 *     process.env.SUPABASE_SERVICE_ROLE_KEY,
 *     { auth: { persistSession: false } },
 *   );
 *
 * with:
 *
 *   import { getServiceClient } from "./lib/supabase.mjs";
 *   const sb = getServiceClient();
 *
 * Always returns a service-role client (full RLS bypass). Production
 * scripts have no merchant-auth context, so service-role is the
 * intended posture.
 */

import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./env.mjs";

let cached = null;

/**
 * Returns a singleton service-role Supabase client. Memoized so a
 * script that calls this from multiple modules doesn't open multiple
 * connection pools.
 */
export function getServiceClient() {
  if (cached) return cached;
  const { url, serviceRoleKey } = loadSupabaseEnv();
  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cached;
}
