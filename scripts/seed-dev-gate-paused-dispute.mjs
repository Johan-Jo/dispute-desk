#!/usr/bin/env node
/**
 * Seed ONE dev dispute in the exact state the 2026-07-30 detail-page fixes
 * describe, so they can be verified on a real page instead of on trust:
 *
 *   - evidence pack `status='ready'`     → lifecycle resolves to `pack_prepared`
 *   - `case_strength.overall='moderate'` → the auto-submit guard PARKS it
 *   - nothing saved to Shopify           → the gate actions are relevant
 *   - an `auto_save_blocked` audit event → this is what used to raise the
 *                                          amber "Auto-submit paused" banner
 *
 * That combination is what produced the contradiction on prod dispute
 * 240d293a: an amber "your review needed" banner sitting directly above a
 * card reading "No action required". Dev had no dispute in this state, so the
 * fixes could not be seen anywhere.
 *
 * The pack_json is CLONED from an existing dev pack rather than hand-written,
 * so the shape cannot drift from what the real builder emits — a synthetic
 * pack that renders differently would prove nothing.
 *
 * DEV ONLY. Refuses unless APP_ENV=development and the resolved Postgres host
 * carries the dev project ref.
 *
 * Usage:
 *   APP_ENV=development node scripts/seed-dev-gate-paused-dispute.mjs
 *   APP_ENV=development node scripts/seed-dev-gate-paused-dispute.mjs --cleanup
 */

import pg from "pg";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const DEV_REF = "vrpkgudqmpyunekrkpnc";
const SHOP_DOMAIN = process.env.SEED_SHOP ?? "surasvenne.myshopify.com";
/** Marker so --cleanup can find exactly what this script made. */
const MARKER = "dd-seed-gate-paused";

function die(msg) {
  console.error(`\n[seed-gate-paused] ${msg}\n`);
  process.exit(1);
}

if (process.env.APP_ENV !== "development") {
  die(`APP_ENV is "${process.env.APP_ENV || "(unset)"}". This writes rows; it refuses outside development.`);
}

const env = {};
loadEnv({ path: resolve(process.cwd(), ".env.local"), processEnv: env, quiet: true });
const url = env.SUPABASE_URL_POSTGRES;
if (!url) die("SUPABASE_URL_POSTGRES not found in .env.local");

const m = url.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
if (!m) die("Could not parse SUPABASE_URL_POSTGRES");
if (!m[3].includes(DEV_REF)) {
  die(`Host "${m[3]}" does not carry the dev ref ${DEV_REF}. REFUSING — this script never touches prod.`);
}

let password;
try {
  password = decodeURIComponent(m[2]);
} catch {
  password = m[2];
}

const client = new pg.Client({
  host: m[3],
  port: Number.parseInt(m[4], 10),
  database: m[5],
  user: m[1],
  password,
  ssl: { rejectUnauthorized: false },
});

const cleanup = process.argv.includes("--cleanup");

await client.connect();
console.log(`\n  Target: ${m[3]} (dev)\n`);

try {
  const { rows: shops } = await client.query(
    "select id from public.shops where shop_domain = $1",
    [SHOP_DOMAIN],
  );
  if (shops.length === 0) die(`shop ${SHOP_DOMAIN} not found on dev`);
  const shopId = shops[0].id;

  if (cleanup) {
    const { rows } = await client.query(
      `delete from public.disputes
        where shop_id = $1 and dispute_gid like '%' || $2 || '%'
        returning id`,
      [shopId, MARKER],
    );
    console.log(`  Removed ${rows.length} seeded dispute(s).\n`);
    await client.end();
    process.exit(0);
  }

  // Clone a real pack_json so the rendered page exercises the true shape.
  const { rows: donor } = await client.query(
    `select ep.pack_json
       from public.evidence_packs ep
       join public.disputes d on d.id = ep.dispute_id
      where d.shop_id = $1
        and ep.pack_json->'case_strength'->>'overall' is not null
      order by ep.created_at desc
      limit 1`,
    [shopId],
  );
  if (donor.length === 0) die("no existing pack on this dev shop to clone a shape from");

  const packJson = donor[0].pack_json;
  // Force the two facts the fixes depend on. heroVariant drives the restored
  // "Review before challenging" headline; overall drives the moderate PARK.
  packJson.case_strength = { ...(packJson.case_strength ?? {}), overall: "moderate" };
  packJson.case_strength.heroVariant = "could_win";
  packJson.coverage = { ...(packJson.coverage ?? {}), state: "not_covered" };
  packJson.fatal_loss = { triggered: false, reason: null };

  const disputeId = randomUUID();
  const packId = randomUUID();
  const gid = `gid://shopify/DisputeEvidence/${MARKER}-${Date.now()}`;
  const dueAt = new Date(Date.now() + 21 * 864e5).toISOString();

  await client.query(
    `insert into public.disputes
       (id, shop_id, dispute_gid, reason, status, normalized_status, phase,
        amount, currency_code, due_at, initiated_at, needs_review, needs_attention,
        order_name, customer_display_name)
     values ($1,$2,$3,'FRAUDULENT','needs_response','new','chargeback',
             120, 'USD', $4, now(), false, false, '#SEED-1001', 'Seed Customer')`,
    [disputeId, shopId, gid, dueAt],
  );

  // status='ready' is the ONLY thing that yields lifecycle `pack_prepared`.
  await client.query(
    `insert into public.evidence_packs (id, dispute_id, shop_id, status, pack_json)
     values ($1,$2,$3,'ready',$4)`,
    [packId, disputeId, shopId, packJson],
  );

  // The event the removed banner rendered from. Present on purpose: the fix is
  // that this no longer produces an amber banner, only the two actions.
  await client.query(
    `insert into public.audit_events (pack_id, shop_id, dispute_id, actor_type, event_type, event_payload)
     values ($1,$2,$3,'system','auto_save_blocked',$4)`,
    [
      packId,
      shopId,
      disputeId,
      JSON.stringify({
        decision: "park",
        verdict_reason: "moderate_strength",
        case_strength: "moderate",
        reasons: ["Auto-mode case strength is Moderate — parked for merchant review per PRD §9"],
      }),
    ],
  );

  console.log(`  Seeded dispute ${disputeId}`);
  console.log(`  pack ${packId} (status=ready, moderate, not saved, auto_save_blocked present)\n`);
  console.log(`  https://dev.disputedesk.app/app/disputes/${disputeId}?shop=${SHOP_DOMAIN}\n`);
} finally {
  await client.end();
}
