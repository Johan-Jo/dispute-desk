/**
 * Direct-Postgres seed/cleanup helpers for E2E specs that need real
 * database state (e.g. an `evidence_packs` row at status="ready" so
 * POST /api/packs/:id/save-to-shopify can return 202).
 *
 * Why pg + service-role write rather than the Supabase JS client:
 *   - The Supabase JS client requires a session token (anon or service
 *     role). Direct pg uses the postgres URL with embedded credentials,
 *     which is the same pattern `scripts/smoke-test.mjs` uses.
 *   - Specs run their inserts in their own connection, so the API
 *     route's separate connection can read the committed rows.
 *
 * Cleanup contract:
 *   - Every helper returns an `ids` object plus a `cleanup()` function.
 *   - Specs MUST call `cleanup()` in `afterEach` (or an equivalent
 *     try/finally) to delete the seeded rows. Cleanup is idempotent.
 *   - If a test crashes between seed and cleanup, the next run's
 *     cleanup-by-id is a no-op; orphan rows accumulate in the test
 *     database until manually purged. Use only against a non-prod DB.
 */

import pg from "pg";
import { randomUUID } from "node:crypto";

const { Client } = pg;

interface PgConn {
  client: pg.Client;
  end(): Promise<void>;
}

/** Open a pg connection from `SUPABASE_URL_POSTGRES`. Throws when the
 *  env var is unset — the caller (test.skip) should guard against this. */
export async function openPg(): Promise<PgConn> {
  const url = process.env.SUPABASE_URL_POSTGRES;
  if (!url) {
    throw new Error(
      "SUPABASE_URL_POSTGRES is not set; this spec requires direct " +
        "Postgres access for seeding/cleanup. Set it in .env.local " +
        "and re-run.",
    );
  }
  const match = url.match(
    /postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)/,
  );
  if (!match) {
    throw new Error(
      "SUPABASE_URL_POSTGRES has unexpected shape; expected " +
        "postgresql://USER:PASS@HOST:PORT/DB",
    );
  }
  const client = new Client({
    host: match[3],
    port: parseInt(match[4], 10),
    database: match[5],
    user: match[1],
    password: match[2],
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return {
    client,
    async end() {
      await client.end();
    },
  };
}

export interface SeededPackIds {
  shopId: string;
  disputeId: string;
  packId: string;
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
  conn: PgConn,
  userEmail: string,
): Promise<{ ids: SeededPackIds; cleanup: () => Promise<void> }> {
  const { client } = conn;

  // Resolve the test user's shop via portal_user_shops. Skip if the
  // user has no connected shop — matches the same precondition that
  // the existing portal-sections.spec.ts assumes.
  const shopRes = await client.query(
    `SELECT s.id AS shop_id
       FROM auth.users u
       JOIN public.portal_user_shops pus ON pus.user_id = u.id
       JOIN public.shops s ON s.id = pus.shop_id
      WHERE u.email = $1
      ORDER BY pus.created_at ASC
      LIMIT 1`,
    [userEmail],
  );
  if (shopRes.rowCount === 0) {
    throw new Error(
      `No connected shop found for ${userEmail}. ` +
        "Connect the test user to at least one shop (portal_user_shops) before running seeded specs.",
    );
  }
  const shopId = shopRes.rows[0].shop_id as string;

  const disputeId = randomUUID();
  const packId = randomUUID();

  await client.query(
    `INSERT INTO public.disputes
       (id, shop_id, dispute_gid, dispute_evidence_gid, reason, status, currency_code, amount, created_at)
     VALUES
       ($1, $2, $3, $4, 'FRAUDULENT', 'NEEDS_RESPONSE', 'USD', 100, now())`,
    [
      disputeId,
      shopId,
      `gid://shopify/ShopifyPaymentsDispute/test-${disputeId}`,
      `gid://shopify/DisputeEvidence/test-${disputeId}`,
    ],
  );

  await client.query(
    `INSERT INTO public.evidence_packs
       (id, shop_id, dispute_id, status, completeness_score, submission_readiness, pack_json, created_at, updated_at)
     VALUES
       ($1, $2, $3, 'ready', 92, 'ready', '{"sections": []}'::jsonb, now(), now())`,
    [packId, shopId, disputeId],
  );

  const cleanup = async () => {
    // Order matters — jobs reference pack IDs via entity_id; disputes
    // hold the pack's foreign key. Delete in reverse dependency order.
    await client.query(`DELETE FROM public.jobs WHERE entity_id = $1`, [packId]);
    await client.query(`DELETE FROM public.evidence_packs WHERE id = $1`, [packId]);
    await client.query(`DELETE FROM public.disputes WHERE id = $1`, [disputeId]);
  };

  return {
    ids: { shopId, disputeId, packId },
    cleanup,
  };
}

/** Read the current row for a seeded pack — used by specs to verify
 *  side effects (e.g. status flipped to "saving"). */
export async function readPackStatus(
  conn: PgConn,
  packId: string,
): Promise<string | null> {
  const res = await conn.client.query(
    `SELECT status FROM public.evidence_packs WHERE id = $1`,
    [packId],
  );
  return res.rowCount === 0 ? null : (res.rows[0].status as string);
}

/** Count jobs for a seeded pack — used by specs to verify the
 *  save-to-shopify enqueue actually wrote a row. */
export async function countJobsForPack(
  conn: PgConn,
  packId: string,
  jobType: string,
): Promise<number> {
  const res = await conn.client.query(
    `SELECT count(*)::int AS n FROM public.jobs WHERE entity_id = $1 AND job_type = $2`,
    [packId, jobType],
  );
  return res.rows[0].n as number;
}
