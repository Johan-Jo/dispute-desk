/**
 * Test fixture helpers for E2E specs that need real database state
 * (e.g. an `evidence_packs` row at status="ready" so
 * POST /api/packs/:id/save-to-shopify can return 202).
 *
 * Uses the Supabase JS client with the service role key — same write
 * access as a direct Postgres connection, but routes through the REST
 * API. This avoids needing `SUPABASE_URL_POSTGRES` (the database
 * password is non-trivial to obtain on Supabase IPv6-only direct
 * connections; the service role JWT is already in `.env.local` for
 * production code paths).
 *
 * Cleanup contract:
 *   - Every helper returns an `ids` object plus a `cleanup()` function.
 *   - Specs MUST call `cleanup()` in `afterEach` (or an equivalent
 *     try/finally) to delete the seeded rows. Cleanup is idempotent.
 *   - Cleanup goes through the `delete_e2e_fixture_dispute(uuid)` RPC
 *     (added in migration `20260509140000`), which is the only path
 *     able to delete the audit_events rows the seeded dispute and pack
 *     accumulate during the test. Without the RPC, the BEFORE-DELETE
 *     trigger on audit_events would block the dispute/pack delete via
 *     FK and silently leak the seed (root cause of the 30 orphan
 *     fixtures wiped on 2026-05-09 — see docs/technical.md
 *     § *E2E fixtures and audit immutability*).
 *   - If a test crashes between seed and cleanup, the RPC is also what
 *     `npm run cleanup:e2e-orphans` calls under the hood for any
 *     test-pattern dispute_gid found in the DB.
 *
 * Production-DB safety:
 *   - The DisputeDesk codebase shares a single Supabase project across
 *     dev / E2E / prod. To avoid contaminating the merchant dashboard
 *     with fixture rows, `openSb()` refuses to operate against
 *     `SUPABASE_URL` unless `E2E_ALLOW_PROD_DB=true` is explicitly set.
 *     The opt-in is intentional: it forces a deliberate ack every time
 *     a developer wants to run E2E specs against the live project.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export interface SbConn {
  client: SupabaseClient;
}

/** Open a Supabase REST client with service-role credentials.
 *  Throws when env vars are unset — the caller (test.skip) should
 *  guard against this. Also refuses to operate against the production
 *  Supabase project unless `E2E_ALLOW_PROD_DB=true` is set; this is
 *  the structural guard against E2E fixtures leaking into the live
 *  merchant dashboard. */
export function openSb(): SbConn {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY " +
        "must be set in .env.local for seeded fixtures.",
    );
  }

  // DisputeDesk has one Supabase project (`sddzuglxdnkhcnjmcpbj`) that
  // backs dev, E2E, and prod. Until we provision a separate test
  // project, opt-in via `E2E_ALLOW_PROD_DB=true` so that nobody
  // accidentally seeds fixtures while the dashboard is being demoed.
  const PROD_REF = "sddzuglxdnkhcnjmcpbj";
  if (
    url.includes(PROD_REF) &&
    process.env.E2E_ALLOW_PROD_DB !== "true"
  ) {
    throw new Error(
      `Refusing to seed E2E fixtures against the production Supabase project (${PROD_REF}). ` +
        "Set E2E_ALLOW_PROD_DB=true to override — be aware that fixture rows " +
        "show up on the live dashboard until cleanup runs. " +
        "See docs/technical.md § E2E fixtures and audit immutability.",
    );
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client };
}

export interface SeededPackIds {
  shopId: string;
  disputeId: string;
  packId: string;
}

/**
 * Read-only: resolve the test user's first connected shop id.
 *
 * Used by specs that need the merchant's shop context (to set the
 * `dd_active_shop` cookie, so middleware's portal API fallback resolves
 * a real shop instead of injecting the `"demo"` placeholder that the
 * cross-shop-ownership-filtered routes refuse with 401).
 *
 * No writes — safe to call before any test runs. Throws if the user or
 * shop link is missing so misconfiguration surfaces immediately instead
 * of as a confusing 401 downstream.
 */
export async function getFirstShopIdForUser(
  conn: SbConn,
  userEmail: string,
): Promise<string> {
  const { client } = conn;

  const { data: usersList, error: usersErr } = await client.auth.admin.listUsers({
    perPage: 200,
  });
  if (usersErr) throw new Error(`auth.admin.listUsers failed: ${usersErr.message}`);
  const user = usersList.users.find((u) => u.email === userEmail);
  if (!user) {
    throw new Error(`No Supabase Auth user with email "${userEmail}".`);
  }

  const { data: linkRows, error: linkErr } = await client
    .from("portal_user_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (linkErr) throw new Error(`portal_user_shops lookup failed: ${linkErr.message}`);
  const shopId = linkRows?.[0]?.shop_id as string | undefined;
  if (!shopId) {
    throw new Error(
      `No connected shop found for ${userEmail}. ` +
        "Connect the test user to at least one shop (portal_user_shops) before running shop-context-required specs.",
    );
  }
  return shopId;
}

/**
 * Seed a minimal dispute + evidence_pack pair owned by the user with
 * the given email. The pack is inserted at `status="ready"` and
 * `completeness_score=92` so POST /api/packs/:id/save-to-shopify
 * accepts it without needing `confirmWarnings`.
 *
 * Returns the inserted IDs plus a cleanup function. Cleanup deletes
 * the rows in dependency order (jobs → packs → disputes); idempotent
 * via DELETE WHERE id = ... so a failed test that already partially
 * cleaned up won't error.
 */
export async function seedReadyPackForUser(
  conn: SbConn,
  userEmail: string,
): Promise<{ ids: SeededPackIds; cleanup: () => Promise<void> }> {
  const { client } = conn;
  const shopId = await getFirstShopIdForUser(conn, userEmail);

  const disputeId = randomUUID();
  const packId = randomUUID();

  const { error: dErr } = await client.from("disputes").insert({
    id: disputeId,
    shop_id: shopId,
    dispute_gid: `gid://shopify/ShopifyPaymentsDispute/test-${disputeId}`,
    dispute_evidence_gid: `gid://shopify/DisputeEvidence/test-${disputeId}`,
    reason: "FRAUDULENT",
    status: "NEEDS_RESPONSE",
    currency_code: "USD",
    amount: 100,
  });
  if (dErr) throw new Error(`disputes insert failed: ${dErr.message}`);

  const { error: pErr } = await client.from("evidence_packs").insert({
    id: packId,
    shop_id: shopId,
    dispute_id: disputeId,
    status: "ready",
    completeness_score: 92,
    submission_readiness: "ready",
    pack_json: { sections: [] },
  });
  if (pErr) {
    // Roll back the dispute insert so we don't leave an orphan.
    await client.from("disputes").delete().eq("id", disputeId);
    throw new Error(`evidence_packs insert failed: ${pErr.message}`);
  }

  const cleanup = async () => {
    // Goes through the SECURITY DEFINER RPC so the audit_events rows
    // accumulated during the test (which the BEFORE-DELETE trigger
    // would otherwise refuse to surrender) get cleaned up too. The
    // RPC is hardcoded to refuse anything that isn't an E2E fixture
    // dispute_gid, so a forged disputeId can't wipe real data.
    //
    // Errors are surfaced — the previous fire-and-forget cleanup
    // silently swallowed FK violations and leaked orphan fixtures into
    // the production dashboard.
    const { error } = await client.rpc("delete_e2e_fixture_dispute", {
      p_dispute_id: disputeId,
    });
    if (error) {
      throw new Error(
        `delete_e2e_fixture_dispute(${disputeId}) failed: ${error.message}`,
      );
    }
  };

  return {
    ids: { shopId, disputeId, packId },
    cleanup,
  };
}

/** Read the current row for a seeded pack — used by specs to verify
 *  side effects (e.g. status flipped to "saving"). */
export async function readPackStatus(
  conn: SbConn,
  packId: string,
): Promise<string | null> {
  const { data, error } = await conn.client
    .from("evidence_packs")
    .select("status")
    .eq("id", packId)
    .maybeSingle();
  if (error) throw new Error(`readPackStatus failed: ${error.message}`);
  return (data?.status as string | undefined) ?? null;
}

/** Count jobs for a seeded pack — used by specs to verify the
 *  save-to-shopify enqueue actually wrote a row. */
export async function countJobsForPack(
  conn: SbConn,
  packId: string,
  jobType: string,
): Promise<number> {
  const { count, error } = await conn.client
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("entity_id", packId)
    .eq("job_type", jobType);
  if (error) throw new Error(`countJobsForPack failed: ${error.message}`);
  return count ?? 0;
}
