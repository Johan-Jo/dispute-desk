/**
 * §9.3 — the pre-activation rebuild.
 *
 * Rebuilds CURRENT OPEN, UNSUBMITTED cases so they carry canonical assessment
 * snapshots and canonical package identity before anything can be marked stale.
 * Legacy packages are not grandfathered; they are expected to go stale.
 *
 * ── THE AUTHORIZED WRITER ─────────────────────────────────────────────
 *
 * This script does NOT write a pack, a snapshot, a plan or a package. It
 * enqueues `build_pack` jobs and stops. The writing is done by:
 *
 *   `build_pack`            → handleBuildPack → lib/packs/buildPack.ts
 *                             writes pack_json.case_assessment and
 *                             pack_json.case_assessment_gates (CP-A)
 *   `build_defence_package` → handleBuildDefencePackage
 *                             writes plan_json + the canonical identity
 *                             columns (CP-B)
 *
 * `buildPackJob` chains to `maybeEnqueueDefencePackage`, so the second follows
 * the first automatically — the same chain production runs. Both are reached
 * only through `app/api/jobs/worker/route.ts`, never from a GET/read path,
 * which is §9.3's requirement. The deployed worker cron drains the queue every
 * two minutes; nothing here invokes a handler directly, because a rebuild that
 * bypassed the worker would not be the production path and would prove nothing
 * about it.
 *
 * ── TARGET GUARD ──────────────────────────────────────────────────────
 *
 * `--env dev|prod` is REQUIRED and is checked against the ref in the env file's
 * SUPABASE_URL. There is no default and no inference. A mismatch aborts.
 *
 * ── BEFORE SNAPSHOT ───────────────────────────────────────────────────
 *
 * Every legacy-READ field is captured to a JSON file before a single job is
 * enqueued: the columns the legacy gate reads (`completeness_score`,
 * `blockers`, `submission_readiness`, `status`) and the `pack_json` keys the
 * legacy guards read (`case_strength.overall`, `coverage.state`,
 * `fatal_loss.triggered`, `credit_already_issued`). `cp-rebuild-verify.mjs`
 * diffs against that file. Without it, "nothing changed" would be an assertion
 * rather than a measurement.
 *
 * Usage:
 *   node scripts/cp-pre-activation-rebuild.mjs --env dev                 # dry run
 *   node scripts/cp-pre-activation-rebuild.mjs --env dev --apply
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const REFS = { dev: "vrpkgudqmpyunekrkpnc", prod: "aokhplydttxtebvbeuzc" };
const ENV_FILES = { dev: ".env.local", prod: ".env.production.local" };

const args = process.argv.slice(2);
const envArg = args[args.indexOf("--env") + 1];
const APPLY = args.includes("--apply");
/* Pilot controls. §9.3 on prod is not a single shot: `buildPackJob` runs
 * `evaluateAndMaybeAutoSave` after every rebuild, so a pack that now clears the
 * gate is stamped and enqueued for a save that files evidence with
 * `submitEvidence: true`. A bulk run is therefore an outward-facing action on
 * live disputes, and the only responsible way to size it is to do a few first
 * and measure. Ordered by dispute id so the selection is deterministic and a
 * later batch cannot silently re-pick the same cases. */
const SHOP = args.includes("--shop") ? args[args.indexOf("--shop") + 1] : null;
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : null;
const OUT =
  args.includes("--out") ? args[args.indexOf("--out") + 1] : `tmp/cp-rebuild-before-${envArg}.json`;

if (!envArg || !REFS[envArg]) {
  console.error("Refusing to run: --env dev|prod is required and has no default.");
  process.exit(1);
}

function loadEnv(file) {
  const vars = {};
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    const k = t.slice(0, i).trim();
    if (v === "" && vars[k]) continue;
    vars[k] = v;
  }
  return vars;
}

const env = loadEnv(ENV_FILES[envArg]);
const URL_BASE = (env.SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const actualRef = URL_BASE.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

if (!URL_BASE || !KEY) {
  console.error(`Refusing to run: ${ENV_FILES[envArg]} lacks SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
if (actualRef !== REFS[envArg]) {
  console.error(
    `TARGET GUARD FAILED. --env ${envArg} expects ref ${REFS[envArg]}, ` +
      `but ${ENV_FILES[envArg]} points at ${actualRef}. Aborting.`,
  );
  process.exit(1);
}
console.log(`[guard] intended=${envArg} — ref ${actualRef} matches. ${APPLY ? "APPLY" : "DRY RUN"}.`);

async function rest(path, init) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: init?.method === "POST" ? "return=representation" : undefined,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

async function page(path) {
  const out = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${offset}-${offset + size - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/** Exactly the fields the LEGACY path reads. Nothing canonical. */
function legacyFingerprint(pack) {
  const pj = pack.pack_json ?? {};
  return {
    completeness_score: pack.completeness_score ?? null,
    blockers: pack.blockers ?? null,
    submission_readiness: pack.submission_readiness ?? null,
    status: pack.status ?? null,
    saved_to_shopify_at: pack.saved_to_shopify_at ?? null,
    case_strength_overall: pj.case_strength?.overall ?? null,
    coverage_state: pj.coverage?.state ?? null,
    fatal_loss_triggered: pj.fatal_loss?.triggered === true,
    credit_already_issued: pj.credit_already_issued ?? null,
  };
}

const disputes = await page("disputes?select=id,shop_id,status,final_outcome,due_at&final_outcome=is.null");
const openIds = new Set(disputes.map((d) => d.id));

const packs = await page(
  "evidence_packs?select=id,shop_id,dispute_id,completeness_score,blockers,submission_readiness,status,saved_to_shopify_at,pack_json,rebuild_pending,created_at&order=created_at.desc",
);
const latest = new Map();
for (const p of packs) {
  if (p.dispute_id && openIds.has(p.dispute_id) && !latest.has(p.dispute_id)) latest.set(p.dispute_id, p);
}

/* CURRENT OPEN, UNSUBMITTED. `saved_to_shopify_at IS NULL` on the LATEST pack
 * is the unsubmitted test — never `status`, which a pack that cleared the gate
 * has already had rewritten to `saved_to_shopify`. */
const shopRows = await page("shops?select=id,shop_domain");
const domainOf = new Map(shopRows.map((s) => [s.id, s.shop_domain]));

let population = [...latest.values()]
  .filter((p) => p.saved_to_shopify_at === null)
  .sort((a, b) => (a.dispute_id < b.dispute_id ? -1 : 1));
const fullPopulationSize = population.length;

if (SHOP) population = population.filter((p) => domainOf.get(p.shop_id) === SHOP);
const scopedSize = population.length;
if (LIMIT !== null) population = population.slice(0, LIMIT);

const before = {
  ranAt: new Date().toISOString(),
  env: envArg,
  ref: actualRef,
  openDisputes: disputes.length,
  openWithPack: latest.size,
  populationSize: population.length,
  /* The full open set, not just the population: the "did the legacy path move"
   * proof has to cover cases the rebuild did NOT touch as well, or a change
   * there would go unnoticed. */
  packs: Object.fromEntries(
    [...latest.values()].map((p) => [
      p.id,
      {
        disputeId: p.dispute_id,
        inPopulation: p.saved_to_shopify_at === null,
        hasCaseAssessment: !!p.pack_json?.case_assessment,
        hasGates: !!p.pack_json?.case_assessment_gates,
        rebuildPending: p.rebuild_pending === true,
        legacy: legacyFingerprint(p),
      },
    ]),
  ),
};

mkdirSync(dirname(join(process.cwd(), OUT)), { recursive: true });
writeFileSync(join(process.cwd(), OUT), JSON.stringify(before, null, 2));

console.log(`\nOPEN disputes:            ${disputes.length}`);
console.log(`  with a pack:            ${latest.size}`);
console.log(`  OPEN + UNSUBMITTED:     ${fullPopulationSize}   <- the full population`);
if (SHOP) console.log(`  scoped to ${SHOP}:  ${scopedSize}`);
if (LIMIT !== null) console.log(`  LIMIT ${LIMIT} applied — this batch: ${population.length}`);
console.log(
  `  already canonical:      ${[...latest.values()].filter((p) => p.pack_json?.case_assessment).length}`,
);
console.log(`BEFORE snapshot written:  ${OUT}`);

if (!APPLY) {
  console.log(`\nDRY RUN — no jobs enqueued. Re-run with --apply.`);
  process.exit(0);
}

let enqueued = 0;
for (const p of population) {
  const [row] = await rest("jobs", {
    method: "POST",
    body: JSON.stringify({
      shop_id: p.shop_id,
      job_type: "build_pack",
      /* THE PACK ID, not the dispute id. `handleBuildPack` reads
       * `job.entityId` as a pack id and throws without one — every existing
       * enqueue site (`app/api/disputes/[id]/packs/route.ts`, the deadline
       * rebuild cron) passes `pack.id`. */
      entity_id: p.id,
      /* Below the interactive tier (20) and below the default (100) so a
       * merchant action always overtakes the rebuild. A backfill that
       * starves live traffic is how the job-priority incident happened. */
      priority: 500,
      status: "queued",
    }),
  });
  enqueued += row ? 1 : 0;
}

console.log(`\nENQUEUED ${enqueued} build_pack jobs (priority 500).`);
console.log(`The deployed worker cron drains these; nothing was written here.`);
