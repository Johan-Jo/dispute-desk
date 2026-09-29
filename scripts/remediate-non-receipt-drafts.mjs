/**
 * Non-receipt plan P5 (§4.6) — re-derive every UNSUBMITTED item-not-received
 * draft under the rules now in prod (P0–P2), and report which ratings moved.
 *
 * WHY. A pack's assessment is written by `buildPack` and by nothing else, and
 * `refresh-open-disputes` rebuilds only when a carrier delivery status moves.
 * So a draft derived before a scoring/copy/inclusion release keeps the old
 * result until something unrelated happens to rebuild it.
 *
 * SCOPE (what is never touched):
 *   - anything filed: `submitted_at`, `evidence_saved_to_shopify_at`, or a
 *     Shopify status past our filing (`submitted_to_bank`, decided states).
 *     Submitted history is never rewritten; there is no resubmission here.
 *   - merchant-conceded disputes (`review_state = conceded`).
 *   - disputes past their deadline.
 *   - packs already derived at or after CUTOFF (nothing to re-derive).
 *   - drafts whose latest defence package is FILEABLE (counsel v2, validated).
 *     A rebuild whose evidence hash moved calls the writer again, and the
 *     writer may refuse — turning a fileable letter into a failed package days
 *     before the deadline (canary 2026-09-29: #103052's rebuild ended
 *     `no_counsel_letter`). The P1b/P2 changes alter merchant copy and the
 *     Gorgias filter, not what a fileable letter says, so that risk buys
 *     nothing. Template-writer letters are refused at filing
 *     (`retired_template_writer`), so rebuilding those can only help.
 *     `--include-fileable` overrides, for a deliberate re-letter.
 *
 * WHAT IT DOES. Enqueues `build_pack` at priority 90 (the nightly-refresh
 * tier, below interactive work). The rebuilt pack chains its own defence
 * package rebuild through the normal pipeline — the same path as any rebuild,
 * with the same validators, safety gates and self-heal. `buildPack` consumes
 * no pack credit (billing is at package build).
 *
 * "Flag changed classifications for review": `--apply` writes the BEFORE
 * snapshot (overall, overallBeforeRev5, strength reason, in-transit flag) to
 * scripts/.snapshots/; `--report` re-reads the packs and prints every row
 * whose classification moved. That list is what a human reviews.
 *
 * Usage:
 *   node scripts/remediate-non-receipt-drafts.mjs                    # DRY RUN
 *   node scripts/remediate-non-receipt-drafts.mjs --limit=3 --apply  # canary
 *   node scripts/remediate-non-receipt-drafts.mjs --apply            # the rest
 *   node scripts/remediate-non-receipt-drafts.mjs --report           # before/after
 *   --only=<dispute uuid>[,<uuid>…] restricts the set (canary by hand).
 *
 * ALWAYS canary first and READ the resulting letters before the full set.
 * PROD-ONLY: loads .env.production.local and refuses any other project.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REPORT = args.includes("--report");
const limitArg = args.find((a) => a.startsWith("--limit="))?.slice(8);
const LIMIT = limitArg ? Number(limitArg) : null;
if (limitArg && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}
const INCLUDE_FILEABLE = args.includes("--include-fileable");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;

/** The P2 prod release (#929 merged 2026-09-29T12:08:46Z). Anything derived
 *  before it was scored/filtered by an older rule set. */
const CUTOFF = "2026-09-29T12:08:46Z";
const SNAPSHOT = join(process.cwd(), "scripts", ".snapshots", "non-receipt-p5-before.json");

config({ path: join(process.cwd(), ".env.production.local") });
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.production.local");
  process.exit(1);
}
if (!url.includes("aokhplydttxtebvbeuzc")) {
  console.error(`Refusing to run: expected the PROD project (aokhply…), got ${url}`);
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const INR_REASONS = ["PRODUCT_NOT_RECEIVED", "product_not_received"];
const FILED_OR_DECIDED = ["submitted_to_bank", "won", "lost", "closed", "accepted", "submitted"];

function classification(packJson) {
  const cs = packJson?.case_strength ?? {};
  return {
    overall: cs.overall ?? null,
    overallBeforeRev5: cs.overallBeforeRev5 ?? null,
    strengthReasonKey: cs.strengthReasonI18n?.key ?? null,
    deliveryInTransit: cs.deliveryInTransit ?? null,
    computedAt: packJson?.case_assessment?.freshness?.computedAt ?? null,
  };
}

async function latestPacks(disputeIds) {
  const { data, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, created_at, pack_json")
    .in("dispute_id", disputeIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const byDispute = new Map();
  for (const p of data ?? []) if (!byDispute.has(p.dispute_id)) byDispute.set(p.dispute_id, p);
  return byDispute;
}

if (REPORT) {
  if (!existsSync(SNAPSHOT)) {
    console.error(`No snapshot at ${SNAPSHOT} — run --apply first.`);
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const packs = await latestPacks(before.map((b) => b.disputeId));
  let changed = 0;
  let pending = 0;
  for (const b of before) {
    const now = classification(packs.get(b.disputeId)?.pack_json);
    if (!now.computedAt || now.computedAt < CUTOFF) {
      pending++;
      console.log(`PENDING  ${b.shop} ${b.order}  (not re-derived yet)`);
      continue;
    }
    const diffs = ["overall", "strengthReasonKey", "deliveryInTransit"].filter(
      (k) => JSON.stringify(b.before[k]) !== JSON.stringify(now[k]),
    );
    if (diffs.length) changed++;
    console.log(
      `${diffs.length ? "CHANGED" : "same   "}  ${b.shop} ${b.order}  ` +
        (diffs.length
          ? diffs.map((k) => `${k}: ${JSON.stringify(b.before[k])} → ${JSON.stringify(now[k])}`).join("; ")
          : `overall ${now.overall}`),
    );
  }
  console.log(`\n${before.length} drafts · ${changed} changed · ${pending} pending`);
  process.exit(0);
}

const { data: disputes, error } = await sb
  .from("disputes")
  .select("id, shop_id, order_name, reason, normalized_status, due_at, review_state, submitted_at, evidence_saved_to_shopify_at, shops!inner(shop_domain)")
  .in("reason", INR_REASONS)
  .gt("due_at", new Date().toISOString())
  .is("submitted_at", null)
  .is("evidence_saved_to_shopify_at", null);
if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

const open = (disputes ?? []).filter(
  (d) =>
    !FILED_OR_DECIDED.includes(d.normalized_status) &&
    d.review_state !== "conceded" &&
    (!ONLY || ONLY.includes(d.id)),
);
const packs = await latestPacks(open.map((d) => d.id));

const { data: pkgRows, error: pkgErr } = await sb
  .from("defence_packages")
  .select("dispute_id, prompt_family, validation_status, status, created_at")
  .in("dispute_id", open.map((d) => d.id))
  .order("created_at", { ascending: false });
if (pkgErr) {
  console.error("Package query failed:", pkgErr.message);
  process.exit(1);
}
const latestPkg = new Map();
for (const r of pkgRows ?? []) if (!latestPkg.has(r.dispute_id)) latestPkg.set(r.dispute_id, r);
const isFileable = (r) =>
  !!r && r.prompt_family === "counsel_v2" && r.validation_status === "ok" && r.status !== "failed" && r.status !== "stale";

const held = [];
const targets = [];
for (const d of open) {
  const p = packs.get(d.id);
  if (!p || p.status !== "ready") continue;
  const c = classification(p.pack_json);
  if (c.computedAt && c.computedAt >= CUTOFF) continue;
  if (!INCLUDE_FILEABLE && isFileable(latestPkg.get(d.id))) {
    held.push(d);
    continue;
  }
  targets.push({ d, p, c });
}
targets.sort((a, b) => (a.d.due_at < b.d.due_at ? 1 : -1)); // furthest deadline first: canary on the most slack
const chosen = LIMIT ? targets.slice(0, LIMIT) : targets;

console.log(`open unsubmitted INR disputes : ${open.length}`);
console.log(`held (fileable counsel letter) : ${held.length}`);
for (const d of held) console.log(`  held ${d.shops.shop_domain} ${d.order_name}  due ${d.due_at.slice(0, 10)}`);
console.log(`to re-derive (before ${CUTOFF}) : ${targets.length}`);
for (const t of chosen) {
  console.log(
    `  ${t.d.shops.shop_domain} ${t.d.order_name}  due ${t.d.due_at.slice(0, 10)}  ${t.d.normalized_status}` +
      `  overall=${t.c.overall}  derived=${t.c.computedAt ?? "never"}`,
  );
}

if (!APPLY) {
  console.log("\nDRY RUN — nothing enqueued. Re-run with --limit=3 --apply for the canary.");
  process.exit(0);
}

// Append to the snapshot so a canary and the later full run share one report.
mkdirSync(join(process.cwd(), "scripts", ".snapshots"), { recursive: true });
const prior = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, "utf-8")) : [];
const seen = new Set(prior.map((r) => r.disputeId));

let enqueued = 0;
let skipped = 0;
for (const t of chosen) {
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: t.p.shop_id,
    job_type: "build_pack",
    entity_id: t.p.id,
    priority: 90,
    dedupe_key: `non-receipt-p5:${t.p.id}`,
  });
  if (jobErr && jobErr.code !== "23505") {
    console.error(`  FAILED ${t.d.order_name}: ${jobErr.message}`);
    continue;
  }
  if (jobErr) skipped++;
  else enqueued++;
  if (!seen.has(t.d.id)) {
    prior.push({ disputeId: t.d.id, shop: t.d.shops.shop_domain, order: t.d.order_name, packId: t.p.id, before: t.c });
    seen.add(t.d.id);
  }
}
writeFileSync(SNAPSHOT, JSON.stringify(prior, null, 2));

console.log(`\nenqueued : ${enqueued}`);
console.log(`skipped  : ${skipped} (rebuild already queued)`);
console.log(`snapshot : ${SNAPSHOT}  — run --report once the jobs finish`);
