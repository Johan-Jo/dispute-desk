/**
 * §9.3 — the post-rebuild verifier. READ-ONLY.
 *
 * Answers, in order, the six questions the plan requires before the rebuild is
 * allowed to progress from dev to prod:
 *
 *   1. Did any LEGACY-READ field move?      (§9.3's hard precondition)
 *   2. Did any legacy DISPOSITION move?
 *   3. Does the population reconcile?
 *   4. Do canonical snapshots and identities exist, and are they usable?
 *   5. Is any package selector-eligible now?
 *   6. What does P-7 resolve to, per shop?
 *
 * ── WHY A DIFF AND NOT A RE-QUERY ─────────────────────────────────────
 *
 * Question 1 cannot be answered by looking at the current state: "the score is
 * 72" says nothing about whether it was 72 before. `cp-pre-activation-rebuild.mjs`
 * writes a BEFORE file with every legacy-read field of every open pack — not
 * just the ones in the population, because a change to a pack the rebuild did
 * NOT touch is the more alarming finding of the two. This diffs against it.
 *
 * Usage:
 *   node scripts/cp-rebuild-verify.mjs --env dev [--before tmp/cp-rebuild-before-dev.json]
 */

import { readFileSync } from "fs";
import { join } from "path";

const REFS = { dev: "vrpkgudqmpyunekrkpnc", prod: "aokhplydttxtebvbeuzc" };
const ENV_FILES = { dev: ".env.local", prod: ".env.production.local" };

const args = process.argv.slice(2);
const envArg = args[args.indexOf("--env") + 1];
const BEFORE_PATH =
  args.includes("--before") ? args[args.indexOf("--before") + 1] : `tmp/cp-rebuild-before-${envArg}.json`;

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
if (actualRef !== REFS[envArg]) {
  console.error(`TARGET GUARD FAILED. --env ${envArg} expects ${REFS[envArg]}, file points at ${actualRef}.`);
  process.exit(1);
}
console.log(`[guard] intended=${envArg} — ref ${actualRef} matches. READ-ONLY.\n`);

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

/**
 * The legacy DISPOSITION, in `pipeline.legacy.ts`'s own order and with its own
 * coercions. Reproduced rather than imported because this is a `.mjs` ops
 * script; the ladder is four branches and restating it here is safer than
 * booting the TS toolchain inside a verification step.
 *
 * It is deliberately COARSE — `files` / `does_not_file` — because that is the
 * property §9.3 protects. A finer verdict would report label churn as a
 * behaviour change.
 */
function legacyDisposition(fp, threshold) {
  if (fp.coverage_state === "covered_shopify") return "does_not_file";
  if (fp.fatal_loss_triggered) return "does_not_file";
  if (fp.case_strength_overall === "weak" || fp.case_strength_overall === "insufficient") {
    return "does_not_file";
  }
  const score = fp.completeness_score ?? 0;
  if (score < threshold) return "does_not_file";
  if (fp.submission_readiness === "blocked") return "does_not_file";
  if (Array.isArray(fp.blockers) && fp.blockers.length > 0) return "does_not_file";
  return "files";
}

const before = JSON.parse(readFileSync(join(process.cwd(), BEFORE_PATH), "utf-8"));
console.log(`BEFORE file: ${BEFORE_PATH} (taken ${before.ranAt}, ${before.populationSize} in population)\n`);

const disputes = await page("disputes?select=id,shop_id,status,final_outcome,due_at&final_outcome=is.null");
const openIds = new Set(disputes.map((d) => d.id));
const shops = await page("shops?select=id,shop_domain");
const domainOf = new Map(shops.map((s) => [s.id, s.shop_domain]));
const settings = await page("shop_settings?select=shop_id,auto_save_min_score,auto_save_enabled,enforce_no_blockers");
const settingsOf = new Map(settings.map((s) => [s.shop_id, s]));

const packs = await page(
  "evidence_packs?select=id,shop_id,dispute_id,completeness_score,blockers,submission_readiness,status,saved_to_shopify_at,pack_json,rebuild_pending,created_at&order=created_at.desc",
);
const latest = new Map();
for (const p of packs) {
  if (p.dispute_id && openIds.has(p.dispute_id) && !latest.has(p.dispute_id)) latest.set(p.dispute_id, p);
}

/* ── 1 & 2. Legacy fields and dispositions ───────────────────────────── */

const fieldMoves = [];
const dispositionMoves = [];
const newPackIds = [];

for (const [disputeId, pack] of latest) {
  const prior = before.packs[pack.id];
  const threshold = settingsOf.get(pack.shop_id)?.auto_save_min_score ?? 60;
  if (!prior) {
    // A pack row that did not exist at BEFORE time. `buildPack` UPDATES in
    // place, so a NEW row means something other than the rebuild created it.
    newPackIds.push(`${disputeId.slice(0, 8)} pack=${pack.id.slice(0, 8)}`);
    continue;
  }
  const now = legacyFingerprint(pack);
  for (const key of Object.keys(now)) {
    if (JSON.stringify(now[key]) !== JSON.stringify(prior.legacy[key])) {
      fieldMoves.push(
        `${disputeId.slice(0, 8)} ${key}: ${JSON.stringify(prior.legacy[key])} -> ${JSON.stringify(now[key])}` +
          `${prior.inPopulation ? "" : "   [NOT IN POPULATION]"}`,
      );
    }
  }
  const d0 = legacyDisposition(prior.legacy, threshold);
  const d1 = legacyDisposition(now, threshold);
  if (d0 !== d1) {
    dispositionMoves.push(`${disputeId.slice(0, 8)} ${d0} -> ${d1}${prior.inPopulation ? "" : "  [NOT IN POPULATION]"}`);
  }
}

console.log("── 1. LEGACY-READ FIELDS ──");
console.log(`  packs compared: ${latest.size}`);
console.log(`  field changes:  ${fieldMoves.length}`);
for (const m of fieldMoves.slice(0, 30)) console.log(`      ${m}`);
if (fieldMoves.length > 30) console.log(`      … ${fieldMoves.length - 30} more`);
if (newPackIds.length) {
  console.log(`  NEW pack rows since BEFORE (investigate — buildPack updates in place): ${newPackIds.length}`);
  for (const n of newPackIds.slice(0, 10)) console.log(`      ${n}`);
}

console.log("\n── 2. LEGACY DISPOSITIONS (files / does_not_file) ──");
console.log(`  disposition changes: ${dispositionMoves.length}`);
for (const m of dispositionMoves) console.log(`      ${m}`);

/* ── 3. Population reconciliation ────────────────────────────────────── */

const nowPopulation = [...latest.values()].filter((p) => p.saved_to_shopify_at === null);
const beforePopIds = new Set(
  Object.entries(before.packs).filter(([, v]) => v.inPopulation).map(([id]) => id),
);
const nowPopIds = new Set(nowPopulation.map((p) => p.id));
const left = [...beforePopIds].filter((id) => !nowPopIds.has(id));
const joined = [...nowPopIds].filter((id) => !beforePopIds.has(id));

console.log("\n── 3. POPULATION RECONCILIATION ──");
console.log(`  before: ${beforePopIds.size}   after: ${nowPopIds.size}`);
console.log(`  left the population (submitted or closed since): ${left.length}`);
console.log(`  joined the population (new open unsubmitted case):  ${joined.length}`);

/* ── 4. Canonical snapshots and identities ───────────────────────────── */

const withAssessment = [...latest.values()].filter((p) => p.pack_json?.case_assessment);
const withGates = [...latest.values()].filter((p) => p.pack_json?.case_assessment_gates);
const populationWithAssessment = nowPopulation.filter((p) => p.pack_json?.case_assessment);

console.log("\n── 4. CANONICAL SNAPSHOTS ──");
console.log(`  open packs with case_assessment:       ${withAssessment.length} / ${latest.size}`);
console.log(`  open packs with case_assessment_gates: ${withGates.length} / ${latest.size}`);
console.log(`  POPULATION with case_assessment:       ${populationWithAssessment.length} / ${nowPopulation.length}`);

let identityCols = true;
let packages = [];
try {
  packages = await page(
    /* The seven columns 20260810120000 adds. `policy_version` and
     * `artifact_id` are NOT among them — they live on the contract, not the
     * table — and selecting them 400s, which an earlier draft of this script
     * mis-reported as "migration not applied" against a database that had it. */
    "defence_packages?select=id,dispute_id,version,status,validation_status,superseded_by_id,plan_json,plan_input_hash,plan_policy_version,plan_deadline_only,document_validation_passed",
  );
} catch {
  identityCols = false;
  packages = await page("defence_packages?select=id,dispute_id,version,status,validation_status,superseded_by_id");
}
const openPackages = packages.filter((p) => p.dispute_id && openIds.has(p.dispute_id));

console.log("\n── 4b. CANONICAL PACKAGE IDENTITY ──");
console.log(`  identity columns present in this database: ${identityCols ? "YES" : "NO (migration not applied)"}`);
console.log(`  packages on open disputes: ${openPackages.length}`);
if (identityCols) {
  const withPlan = openPackages.filter((p) => p.plan_json);
  const withHash = openPackages.filter((p) => p.plan_input_hash);
  console.log(`    with plan_json:       ${withPlan.length}`);
  console.log(`    with plan_input_hash: ${withHash.length}`);
  console.log(`    with plan_policy_version: ${openPackages.filter((p) => p.plan_policy_version !== null).length}`);
  console.log(
    `    with document_validation_passed: ` +
      `${openPackages.filter((p) => p.document_validation_passed !== null).length}`,
  );
}

/* ── 5. Selector eligibility ─────────────────────────────────────────── */

console.log("\n── 5. SELECTOR ELIGIBILITY (structural precondition) ──");
const finalOk = openPackages.filter(
  (p) => p.status === "final" && p.validation_status === "ok" && !p.superseded_by_id,
);
console.log(`  final + validation ok + not superseded: ${finalOk.length}`);
console.log(
  `  …of those, carrying a plan hash (the freshness input): ` +
    `${identityCols ? finalOk.filter((p) => p.plan_input_hash).length : "n/a"}`,
);
console.log(
  `  A package with no plan hash is stale/snapshot_absent by construction and cannot be selected.`,
);

/* ── 6. P-7 ──────────────────────────────────────────────────────────── */

const ACTIVATED = new Map([["blume-box.myshopify.com", 60]]);
const EXCLUDED = new Set(["surasvenne.myshopify.com"]);

console.log("\n── 6. P-7 RESOLUTION, PER SHOP ──");
const byShop = new Map();
for (const p of latest.values()) {
  const domain = domainOf.get(p.shop_id) ?? p.shop_id;
  if (!byShop.has(domain)) byShop.set(domain, { total: 0, canonical: 0 });
  const b = byShop.get(domain);
  b.total += 1;
  const activated = ACTIVATED.has(domain);
  const usable = !!p.pack_json?.case_assessment && p.rebuild_pending !== true;
  if (activated && usable) b.canonical += 1;
}
for (const [domain, b] of byShop) {
  const state = ACTIVATED.has(domain)
    ? `ACTIVATED @ ${ACTIVATED.get(domain)}`
    : EXCLUDED.has(domain)
      ? "EXCLUDED (no disposition-preserving threshold)"
      : "not activated";
  console.log(`  ${domain}: ${state} — open packs ${b.total}, resolving CANONICAL ${b.canonical}`);
}

/* ── verdict ─────────────────────────────────────────────────────────── */

console.log("\n── VERDICT ──");
const clean = fieldMoves.length === 0 && dispositionMoves.length === 0 && newPackIds.length === 0;
console.log(`  legacy path undisturbed: ${clean ? "YES" : "NO — see above"}`);
console.log(
  `  rebuild produced canonical snapshots: ` +
    `${populationWithAssessment.length}/${nowPopulation.length} of the population`,
);
