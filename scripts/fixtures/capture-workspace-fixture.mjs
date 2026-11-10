#!/usr/bin/env node
/**
 * Capture scrubbed workspace fixtures for the rendered real-case tests
 * (docs/plans/dispute-page-single-source.plan.md 3.1). READ-ONLY.
 *
 * It runs the real workspace route against production data. Every database read
 * goes through `npm run db:query:prod -- --read-only` (guarded by
 * scripts/guard-db-target.mjs prod on EVERY call), and a replacement fetch turns
 * supabase-js GETs into SELECTs and refuses any other verb.
 *
 *   node scripts/fixtures/capture-workspace-fixture.mjs [--only <case>] [--reuse-cache]
 *
 * Fixed cases are listed below by dispute id prefix; "won, filed" and
 * "review-awaiting" are PICKED BY QUERY and the id recorded in the fixture meta.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = "tests/fixtures/workspace";
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

// Confirm the target per run (CLAUDE.md rule 0), in addition to the per-query guard in `db:query:prod`.
const guard = spawnSync("node", ["scripts/guard-db-target.mjs", "prod"], { stdio: "inherit", shell: true });
if (guard.status !== 0) process.exit(guard.status ?? 1);

if (!process.argv.includes("--reuse-cache")) {
  fs.rmSync(path.join(os.tmpdir(), "dd-fixture-capture-cache"), { recursive: true, force: true });
}

function sqlJ(sql) {
  const f = path.join(os.tmpdir(), `dd-capture-pick-${process.pid}.sql`);
  fs.writeFileSync(f, `select coalesce(json_agg(t), '[]'::json) as j from (${sql}) t;`);
  const r = spawnSync(
    "npm",
    ["run", "db:query:prod", "--silent", "--", "--read-only", "--output", "json", "--file", f],
    { encoding: "utf8", shell: true },
  );
  fs.rmSync(f, { force: true });
  if (r.status !== 0) throw new Error(`pick query failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).rows[0].j;
}

const byPrefix = (p) => {
  const rows = sqlJ(`select id from disputes where id::text like '${p}%'`);
  if (rows.length !== 1) throw new Error(`prefix ${p} matched ${rows.length} disputes`);
  return rows[0].id;
};

const cases = [
  ["17066-returned-to-sender", byPrefix("7aa8536c"), "#17066 returned-to-sender, unanswered"],
  ["23750-stamped-saved-save-failed", byPrefix("e38c8d87"), "#23750 pack stamped saved, every save failed"],
  ["24612-return-received-cnp-won", byPrefix("2903f245"), "#24612 return received, CNP, won"],
  ["21037-return-in-progress", byPrefix("defa8294"), "#21037 return in progress"],
  ["24285-latest-build-failed", byPrefix("d65b7220"), "#24285 latest build failed"],
];

// Won and filed (blume-box): newest won dispute whose submitted defence package exists.
const wonFiled = sqlJ(`
  select d.id from disputes d
  join shops s on s.id = d.shop_id
  join evidence_packs p on p.dispute_id = d.id
  join defence_packages dp on dp.source_pack_id = p.id and dp.status = 'submitted'
  where s.shop_domain like 'blume-box%' and d.normalized_status = 'won' and d.final_outcome = 'won'
  order by d.closed_at desc nulls last limit 1`);
if (wonFiled.length !== 1) throw new Error("no won+filed blume-box dispute found");
cases.push(["won-filed-blume-box", wonFiled[0].id, "won, filed (blume-box), picked by query"]);

// Review-awaiting on shop 6a8848-dd: open, a prepared defence package exists, and the merchant has not yet
// decided (needs_review, review_state null). A pack-less needs_review dispute cannot show the review ask,
// so the query requires the package.
const review = sqlJ(`
  select d.id from disputes d join shops s on s.id = d.shop_id
  where s.shop_domain like '6a8848-dd%' and d.final_outcome is null and d.closed_at is null
    and d.needs_review = true and d.review_state is null and d.submission_state = 'not_saved'
    and exists (select 1 from defence_packages dp join evidence_packs p on p.id = dp.source_pack_id where p.dispute_id = d.id)
  order by d.created_at desc limit 1`);
if (review.length !== 1) throw new Error("no review-awaiting dispute found on 6a8848-dd");
cases.push(["review-awaiting-6a8848-dd", review[0].id, "review-awaiting (6a8848-dd), picked by query"]);

console.log("cases:\n" + cases.map(([n, id]) => `  ${n}  ${id}`).join("\n"));

let failed = 0;
for (const [name, id, note] of cases) {
  if (only && name !== only) continue;
  const r = spawnSync(
    "node",
    ["--import", "tsx", "scripts/fixtures/capture-runner.mts", id, name, `${OUT}/${name}.json`, JSON.stringify(note)],
    { stdio: "inherit", shell: false },
  );
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
