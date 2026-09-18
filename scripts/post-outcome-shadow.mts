/**
 * Shadow-run the snapshot builder over decided disputes (plan §20 Phase 1).
 *
 * Read-only BY DEFAULT: builds a snapshot per dispute and reports the
 * analysis-level split, reconstruction gaps and findings, writing nothing. Use
 * it that way to check the builder against reality.
 *
 * `--persist` turns it into the backfill — it stores each analysis so the admin
 * page and the review queue have something to read. That flag exists because
 * the page shipped to production over an empty table: the sweep had only ever
 * been run in report mode, and a report is not a record.
 *
 *   npx tsx scripts/post-outcome-shadow.mts --env-file .env.production.local
 *   npx tsx scripts/post-outcome-shadow.mts --env-file .env.production.local --json out.json
 *   npx tsx scripts/post-outcome-shadow.mts --env-file .env.production.local --persist --limit 3
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
const { composeAnalysis } = await import("../lib/postOutcome/composeAnalysis.ts");

/**
 * `--persist` writes each composed analysis to `post_outcome_analyses`.
 *
 * Without it this script is a pure read, which is how every run before
 * 2026-08-31 was done — and why the admin page shipped to production over an
 * empty table. Reading and reporting is not the same as storing, and a review
 * queue cannot review what was never written.
 *
 * `persistAnalysis` builds its own client through `getServiceClient()`, which
 * reads `process.env` rather than the parsed env file, so the credentials for
 * the environment named by `--env-file` are promoted before it is imported.
 * The insert is keyed on (dispute_id, analyzer_version, source_snapshot_sha256)
 * and returns the existing row on conflict, so re-running is safe.
 */
const persist = process.argv.includes("--persist");
let persistAnalysis = null;
if (persist) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  ({ persistAnalysis } = await import("../lib/postOutcome/persistAnalysis.ts"));
  console.log(`[shadow] --persist ON — writing analyses to ${url}`);
}
let persistedNew = 0;
let persistedExisting = 0;
let persistFailed = 0;
let persistedFindings = 0;

const DISPUTE_COLUMNS =
  "id, shop_id, order_name, phase, reason, network_reason_code, amount, currency_code, initiated_at, closed_at, final_outcome, outcome_source, submission_state, submitted_at, evidence_saved_to_shopify_at, due_at, dispute_evidence_gid, order_gid, raw_snapshot";
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


// `--limit N` runs the first N only. Once --persist exists this script writes,
// and a write wants a canary: three cases read back beat fifty found wrong
// afterwards.
const limitArg = arg("--limit");
if (limitArg) disputes.length = Math.min(disputes.length, Number(limitArg));

console.log(`[shadow] ${disputes.length} decided disputes with a submitted package\n`);

const levels = {};
const gaps = {};
const findingCounts = {};
const findingTitles = {};
const observationCounts = {};
const classificationCounts = {};
const assertionCounts = {};
let invalidFindings = 0;
let reasonRan = 0;
let actionableCount = 0;
const primaryCounts = {};
const statusCounts = {};
const reasonStatusCounts = {};
const rows = [];
const detailed = [];
const shopNames = new Map();
const { data: shopRows } = await sb.from("shops").select("id, shop_domain");
for (const s of shopRows ?? []) shopNames.set(s.id, s.shop_domain);
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

  const analysis = composeAnalysis(result);
  for (const [k, v] of Object.entries(analysis.summary.evidenceCounts)) {
    classificationCounts[k] = (classificationCounts[k] ?? 0) + (v as number);
  }
  for (const [k, v] of Object.entries(analysis.summary.assertionCounts)) {
    assertionCounts[k] = (assertionCounts[k] ?? 0) + (v as number);
  }
  if (analysis.summary.stagesRun.some((x) => x.startsWith("reason:"))) reasonRan++;
  for (const f of analysis.findings) {
    findingCounts[f.category] = (findingCounts[f.category] ?? 0) + 1;
    findingTitles[f.title] = (findingTitles[f.title] ?? 0) + 1;
  }
  for (const r of analysis.rejectedFindings) {
    invalidFindings += 1;
    console.log(`  ! rejected on ${dispute.id}: ${r.errors.join("; ")}`);
  }
  for (const o of analysis.observations) {
    observationCounts[o.key] = (observationCounts[o.key] ?? 0) + 1;
  }
  if (persist) {
    try {
      const r = await persistAnalysis(analysis, result.snapshot);
      if (r.alreadyExisted) persistedExisting++;
      else {
        persistedNew++;
        persistedFindings += r.findingsWritten;
      }
    } catch (e) {
      // Never abort the sweep: one unwritable case must not cost the other 49.
      persistFailed++;
      console.log(`  ✗ persist ${dispute.id}: ${e?.message ?? e}`);
    }
  }

  primaryCounts[analysis.primaryCategory] = (primaryCounts[analysis.primaryCategory] ?? 0) + 1;
  statusCounts[analysis.analysisStatus] = (statusCounts[analysis.analysisStatus] ?? 0) + 1;
  reasonStatusCounts[analysis.reasonSpecificStatus] =
    (reasonStatusCounts[analysis.reasonSpecificStatus] ?? 0) + 1;
  if (analysis.actionable) actionableCount++;

  // Kept whole for --report; the console summary only needs the projection below.
  detailed.push({
    orderName: dispute.order_name,
    shopId: dispute.shop_id,
    analysis,
    snapshot: result.snapshot,
  });

  rows.push({
    primaryCategory: analysis.primaryCategory,
    findings: analysis.findings.length,
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
console.log("\n── Stage 2 findings ──");
if (Object.keys(findingCounts).length === 0) console.log("  (none)");
for (const [k, v] of Object.entries(findingCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
for (const [k, v] of Object.entries(findingTitles).sort((a, b) => b[1] - a[1])) {
  console.log(`        - ${v}x ${k}`);
}

console.log("\n── Stage 3 evidence classifications ──");
for (const [k, v] of Object.entries(classificationCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Primary finding per analysis ──");
for (const [k, v] of Object.entries(primaryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Analysis status / reason-module status ──");
for (const [k, v] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
for (const [k, v] of Object.entries(reasonStatusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  reason: ${k}`);
}

console.log("\n── Stage 4 assertion classifications ──");
for (const [k, v] of Object.entries(assertionCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Stage 2 observations ──");
for (const [k, v] of Object.entries(observationCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

console.log("\n── Health ──");
console.log(`  reason module ran on:       ${reasonRan}`);
console.log(`  findings REJECTED by gate:  ${invalidFindings}`);
console.log(`  actionable analyses:        ${actionableCount}`);
console.log(`  contract errors:            ${contractErrorCount}`);
if (persist) {
  console.log(`  persisted (new):            ${persistedNew}`);
  console.log(`  persisted (already there):  ${persistedExisting}`);
  console.log(`  findings written:           ${persistedFindings}`);
  console.log(`  persist failures:           ${persistFailed}`);
}
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

/* ─────────────────────────── Human-readable report ─────────────────────────
 * `--report <path>` writes the full picture for someone to READ, not to parse.
 * The console summary above answers "is the analyser behaving"; this answers
 * "what did we actually file, and what is worth deciding about".
 * ------------------------------------------------------------------------ */
const reportOut = arg("--report");
if (reportOut) {
  const { writeFileSync } = await import("node:fs");
  const L = [];
  const shopName = (id) => shopNames.get(id) ?? id.slice(0, 8);
  const forwardedSources = new Set(["SHOPIFY_EVIDENCE_SENT_ON", "PROVIDER_LOG"]);

  L.push("# Post-outcome analysis — shadow run");
  L.push("");
  L.push(
    `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC · production data · **nothing was written**.`,
  );
  L.push("");
  L.push(
    "Every finding below is an automated **hypothesis**. None has been reviewed by a person, and nothing here has changed a rule, template or weight.",
  );
  L.push("");

  L.push("## What was analysed");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| Decided disputes carrying a package we filed | ${detailed.length} |`);
  L.push(
    `| Won / lost | ${rows.filter((r) => r.outcome === "won").length} / ${rows.filter((r) => r.outcome === "lost").length} |`,
  );
  for (const [k, v] of Object.entries(levels).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${k} | ${v} |`);
  }
  L.push(`| Actionable | ${actionableCount} |`);
  L.push(`| Findings refused by the schema gate | ${invalidFindings} |`);
  L.push("");

  L.push("## Findings by category");
  L.push("");
  L.push("| Category | Analyses |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(findingCounts).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${k} | ${v} |`);
  }
  L.push("");

  L.push("## The distinct findings, most severe first");
  L.push("");
  const bySignature = new Map();
  for (const d of detailed) {
    for (const f of d.analysis.findings) {
      const key = `${f.category}|${f.confidence}|${f.severity}|${f.actionClass}`;
      const entry = bySignature.get(key) ?? { finding: f, cases: [] };
      entry.cases.push(d.orderName ?? d.analysis.disputeId.slice(0, 8));
      bySignature.set(key, entry);
    }
  }
  const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const confRank = { DEFINITE: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
  const distinct = [...bySignature.values()].sort((a, b) => {
    const s = (sevRank[a.finding.severity] ?? 9) - (sevRank[b.finding.severity] ?? 9);
    return s !== 0
      ? s
      : (confRank[a.finding.confidence] ?? 9) - (confRank[b.finding.confidence] ?? 9);
  });
  for (const { finding, cases } of distinct) {
    L.push(
      `### ${finding.category} — ${finding.severity.toLowerCase()}, ${finding.confidence.toLowerCase()} confidence`,
    );
    L.push("");
    L.push(`**Affects ${cases.length} case(s).** Owner: \`${finding.actionClass}\`.`);
    L.push("");
    L.push(finding.description);
    L.push("");
    if (finding.counterfactualImprovement) {
      L.push(`*Potential improvement:* ${finding.counterfactualImprovement}`);
      L.push("");
    }
    L.push(
      `Cases: ${cases.slice(0, 12).join(", ")}${cases.length > 12 ? `, +${cases.length - 12} more` : ""}`,
    );
    L.push("");
  }

  L.push("## Observations (real, but not defects)");
  L.push("");
  L.push("| Observation | Cases |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(observationCounts).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${k} | ${v} |`);
  }
  L.push("");

  L.push("## Every case");
  L.push("");
  L.push(
    "| Order | Merchant | Outcome | Reason | Forwarded | Level | Primary finding | Confidence |",
  );
  L.push("|---|---|---|---|---|---|---|---|");
  const ordered = [...detailed].sort(
    (a, b) => b.analysis.findings.length - a.analysis.findings.length,
  );
  for (const d of ordered) {
    const a = d.analysis;
    L.push(
      `| ${d.orderName ?? a.disputeId.slice(0, 8)} | ${shopName(d.shopId)} | ${a.summary.outcome} | ${a.summary.reason ?? "—"} | ${forwardedSources.has(a.summary.submissionConfirmationSource) ? "yes" : "**no**"} | ${a.analysisLevel.replace(/_/g, " ").toLowerCase()}${a.dataIntegrityLimitation ? " (limited)" : ""} | ${a.primaryCategory} | ${a.primaryConfidence} |`,
    );
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push(
    "*Findings are unreviewed. Only a reviewed finding may prioritise a product change, calibrate case strength, or justify a learning action.*",
  );

  writeFileSync(reportOut, L.join("\n"), "utf8");
  console.log(`\n[shadow] wrote report to ${reportOut}`);
}
