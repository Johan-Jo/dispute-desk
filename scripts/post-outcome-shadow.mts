/**
 * Shadow-run the snapshot builder over decided disputes (plan §20 Phase 1).
 *
 * READ-ONLY. Builds a snapshot per dispute, reports the analysis-level split
 * and reconstruction gaps, and writes nothing. Use it to check the builder
 * against reality before any backfill writes a row.
 *
 *   npx tsx scripts/post-outcome-shadow.mjs --env-file .env.production.local
 *   npx tsx scripts/post-outcome-shadow.mjs --env-file .env.production.local --json out.json
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const envFile = arg("--env-file", ".env.production.local");
const env = loadEnv(envFile);
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}
console.log(`[shadow] ${envFile} → ${url}`);

const sb = createClient(url, key, { auth: { persistSession: false } });

const { assembleSnapshot } = await import("../lib/postOutcome/buildSnapshot.ts");

const DISPUTE_COLUMNS =
  "id, shop_id, phase, reason, network_reason_code, amount, currency_code, initiated_at, closed_at, final_outcome, outcome_source, submission_state, submitted_at, evidence_saved_to_shopify_at, due_at, dispute_evidence_gid, order_gid, raw_snapshot";
const PACKAGE_COLUMNS =
  "id, dispute_id, version, content_revision, status, submitted_at, generated_at, pdf_path, evidence_hash, prompt_version, validator_version, reason_code_module, facts_json, narrative_json, shopify_response";

// Only disputes that actually have a submitted package — the analyzable set.
const { data: pkgRows, error: pkgErr } = await sb
  .from("defence_packages")
  .select(PACKAGE_COLUMNS)
  .not("submitted_at", "is", null);
if (pkgErr) throw pkgErr;

const byDispute = new Map();
for (const p of pkgRows) {
  if (!byDispute.has(p.dispute_id)) byDispute.set(p.dispute_id, []);
  byDispute.get(p.dispute_id).push(p);
}

const { data: disputes, error: dErr } = await sb
  .from("disputes")
  .select(DISPUTE_COLUMNS)
  .in("final_outcome", ["won", "lost"])
  .in("id", [...byDispute.keys()]);
if (dErr) throw dErr;

console.log(`[shadow] ${disputes.length} decided disputes with a submitted package\n`);

const levels = {};
const gaps = {};
const rows = [];
let contractErrorCount = 0;

for (const dispute of disputes) {
  const packages = (byDispute.get(dispute.id) ?? []).sort(
    (a, b) => a.version - b.version,
  );

  const [{ data: gorgias }, { data: events }, { data: order }] = await Promise.all([
    sb
      .from("gorgias_evidence_messages")
      .select(
        "id, dispute_id, evidence_category, review_status, approved_at, created_at, sent_at, approved_excerpt",
      )
      .eq("dispute_id", dispute.id),
    sb
      .from("dispute_events")
      .select("event_type, event_at, description")
      .eq("dispute_id", dispute.id)
      .order("event_at", { ascending: true }),
    dispute.order_gid
      ? sb
          .from("shopify_orders")
          .select("payment_gateway")
          .eq("shop_id", dispute.shop_id)
          .eq("shopify_order_id", dispute.order_gid)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const result = assembleSnapshot({
    dispute,
    submittedPackages: packages,
    gorgias: gorgias ?? [],
    events: events ?? [],
    paymentGateway: order?.payment_gateway ?? null,
    cardNetwork: "UNKNOWN",
    caseStrengthAtSubmission: "not_assessed",
  });

  const key = result.level.dataIntegrityLimitation
    ? `${result.level.level} (limitation)`
    : result.level.level;
  levels[key] = (levels[key] ?? 0) + 1;
  for (const g of result.snapshot.reconstructionGaps) {
    gaps[g] = (gaps[g] ?? 0) + 1;
  }
  if (result.contractErrors.length) {
    contractErrorCount += 1;
    console.log(`  ✗ ${dispute.id}: ${result.contractErrors.join("; ")}`);
  }

  rows.push({
    disputeId: dispute.id,
    reason: dispute.reason,
    outcome: dispute.final_outcome,
    level: result.level.level,
    limitation: result.level.dataIntegrityLimitation,
    confirmationSource: result.snapshot.provider.submissionConfirmationSource,
    provider: result.snapshot.provider.paymentProvider,
    packages: packages.length,
    evidenceAvailable: result.snapshot.availableBeforeSubmission.length,
    evidenceLate: result.snapshot.arrivedAfterSubmission.length,
    assertions: result.snapshot.assertions.length,
    hash: result.hash,
  });
}

console.log("\n── Analysis levels ──");
for (const [k, v] of Object.entries(levels).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Confirmation sources ──");
const sources = {};
for (const r of rows) sources[r.confirmationSource] = (sources[r.confirmationSource] ?? 0) + 1;
for (const [k, v] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── By reason × outcome × level ──");
const combo = {};
for (const r of rows) {
  const k = `${r.reason} / ${r.outcome} / ${r.level}${r.limitation ? " (limitation)" : ""}`;
  combo[k] = (combo[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(combo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Reconstruction gaps ──");
for (const [k, v] of Object.entries(gaps).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

const withLate = rows.filter((r) => r.evidenceLate > 0).length;
const uniqueHashes = new Set(rows.map((r) => r.hash)).size;
console.log("\n── Health ──");
console.log(`  contract errors:            ${contractErrorCount}`);
console.log(`  disputes w/ late evidence:  ${withLate}`);
console.log(`  unique snapshot hashes:     ${uniqueHashes} / ${rows.length}`);
console.log(
  `  avg evidence items:         ${(rows.reduce((s, r) => s + r.evidenceAvailable, 0) / rows.length).toFixed(1)}`,
);
console.log(
  `  avg assertions:             ${(rows.reduce((s, r) => s + r.assertions, 0) / rows.length).toFixed(1)}`,
);

const jsonOut = arg("--json");
if (jsonOut) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
  console.log(`\n[shadow] wrote ${jsonOut}`);
}
