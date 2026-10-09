/**
 * Replay a counsel run from what it stored. READ-ONLY against the database;
 * files nothing, writes no package.
 *
 * Every counsel run keeps its inputs in `defence_packages.counsel_replay_json`
 * (the ledger, the brief, the frame, the page context, the check context and
 * the last draft). This script runs the production writer (`writeLetter`,
 * with the production checks and reviewer) over those inputs against the
 * working tree, so a change to a prompt, a brief or a check can be tried on
 * the cases that failed before it ships — and a fixed case can be shown fixed.
 *
 * Model calls go through the staging pilot route (the local Anthropic key is
 * unusable); the route has no prompt caching, so the reported cost is the
 * UNCACHED upper bound.
 *
 *   npx tsx scripts/counsel/replay.mts --env-file .env.production.local \
 *     --token-file <path to pilot.token> \
 *     ( --package <uuid> ... | --signature "<failure_signature>" [--limit N] | --input <file.json> ... )
 *
 * `--input` takes a file holding one replay object (or an array of them): an
 * input reconstructed by hand for a failure older than the stored column.
 *
 * Output: scripts/.snapshots/counsel-replay/<timestamp>.{json,txt} (git-ignored:
 * it holds customer data).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
const envFile = arg("env-file");
const tokenFile = arg("token-file");
const packageIds = args("package");
const inputFiles = args("input");
const signature = arg("signature");
if (!tokenFile || (!inputFiles.length && !envFile) || (!packageIds.length && !inputFiles.length && !signature)) {
  console.error(
    "usage: --token-file <file> ( --env-file <file> ( --package <uuid> ... | --signature <text> [--limit N] ) | --input <file.json> ... )",
  );
  process.exit(1);
}
if (envFile) config({ path: envFile, override: true });

const { writeLetter } = await import("../../lib/defence/counsel/generate");
const { GENERAL_BRIEF, ITEM_NOT_RECEIVED_BRIEF, NOT_AS_DESCRIBED_BRIEF } = await import("../../lib/defence/counsel/briefs");
const { NOT_AS_DESCRIBED, playbookForModule } = await import("../../lib/defence/counsel/playbooks");
const { classifyIssue } = await import("../../lib/defence/counsel/issueRules");
const { runCostUsd } = await import("../../lib/defence/counsel/cost");
type Replay = import("../../lib/defence/counsel/run").CounselReplay;
type Stage = import("../../lib/defence/counsel/run").CounselStageUsage;

const TOKEN = fs.readFileSync(tokenFile, "utf8").trim();
const ROUTE = "https://dev.disputedesk.app/api/public/pilot-inr-letter";

async function model(m: string, system: string, user: string, temperature?: number, maxTokens?: number) {
  const res = await fetch(ROUTE, {
    method: "POST",
    headers: { "x-pilot-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ system, user, model: m, temperature, maxTokens }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${t.slice(0, 300)}`);
  const j = JSON.parse(t) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  if (user.length > 12_000) console.warn(`  ! user message ${user.length} chars exceeds the route's 12k cut`);
  return { text: (j.content ?? []).map((c) => c.text ?? "").join(""), input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
}

const BRIEFS = {
  [GENERAL_BRIEF.type]: GENERAL_BRIEF,
  [ITEM_NOT_RECEIVED_BRIEF.type]: ITEM_NOT_RECEIVED_BRIEF,
  [NOT_AS_DESCRIBED_BRIEF.type]: NOT_AS_DESCRIBED_BRIEF,
};

const cases: Array<{ label: string; stored: string | null; replay: Replay }> = [];
for (const f of inputFiles) {
  const parsed = JSON.parse(fs.readFileSync(f, "utf8")) as Replay | Replay[];
  for (const [i, r] of (Array.isArray(parsed) ? parsed : [parsed]).entries()) {
    cases.push({ label: `${path.basename(f)}#${i}`, stored: "reconstructed input", replay: r });
  }
}
if (packageIds.length || signature) {
  const { getServiceClient } = await import("../../lib/supabase/server");
  const sb = getServiceClient();
  let q = sb
    .from("defence_packages")
    .select("id, version, status, failure_code, failure_signature, counsel_replay_json")
    .not("counsel_replay_json", "is", null);
  q = packageIds.length ? q.in("id", packageIds) : q.eq("failure_signature", signature as string);
  const { data, error } = await q.order("created_at", { ascending: false }).range(0, Number(arg("limit") ?? "12") - 1);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    cases.push({
      label: `${row.id} v${row.version}`,
      stored: `${row.status}${row.failure_code ? ` / ${row.failure_code}` : ""}`,
      replay: row.counsel_replay_json as Replay,
    });
  }
  const missing = packageIds.filter((id) => !(data ?? []).some((r) => r.id === id));
  for (const id of missing) console.warn(`- ${id}: no stored replay input (built before the column, or never reached the writer)`);
}
if (!cases.length) {
  console.error("nothing to replay");
  process.exit(1);
}

const out: unknown[] = [];
const lines: string[] = [];
let letters = 0;
let cost = 0;
for (const c of cases) {
  const r = c.replay;
  const brief = BRIEFS[r.brief];
  if (!brief) {
    lines.push(`- ${c.label}: unknown brief "${r.brief}", skipped`);
    continue;
  }
  const stages: Stage[] = [];
  const written = await writeLetter({
    ledger: r.ledger,
    brief,
    frame: r.frame,
    merchantName: r.merchantName,
    pageContext: r.pageContext,
    check: {
      ledger: r.ledger,
      playbook: playbookForModule(r.moduleKey) ?? NOT_AS_DESCRIBED,
      brief,
      frame: r.frame,
      facts: r.facts,
      disputeOpenedAt: r.disputeOpenedAt,
      merchantName: r.merchantName,
      carrierName: r.check.carrierName,
      pageIdentifiers: r.check.pageIdentifiers,
      trackingUrl: r.check.trackingUrl,
      carrierNames: r.check.carrierNames,
      productNames: r.check.productNames,
      forbiddenTitles: r.check.forbiddenTitles,
    },
    call: async ({ stage, system, user, temperature, maxTokens }) => {
      const m = stage === "review" ? r.reviewModel : r.writeModel;
      const res = await model(m, system, user, temperature, maxTokens);
      stages.push({ stage, model: m, input: res.input, output: res.output, cacheRead: 0, cacheWrite: 0 });
      if (!res.text) throw new Error("empty model reply");
      return res.text;
    },
  }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

  const usd = runCostUsd(stages);
  cost += usd;
  if ("error" in written) {
    lines.push(`- ${c.label} [${r.moduleKey} · ${r.brief} · ${r.frame.provider}] was: ${c.stored} → MODEL ERROR: ${written.error}`);
    out.push({ label: c.label, error: written.error, stages });
    continue;
  }
  if (written.ok) letters++;
  const rules = [...new Set(written.issues.map((i) => `${classifyIssue(i).section}:${classifyIssue(i).rule}`))];
  lines.push(
    `- ${c.label} [${r.moduleKey} · ${r.brief} · ${r.frame.provider} · theory ${written.theory.name}] was: ${c.stored} → ` +
      `${written.ok ? "LETTER" : "NO LETTER"} (${stages.length} calls, $${usd.toFixed(4)})` +
      (rules.length ? `\n    rules: ${rules.join(", ")}` : "") +
      (written.issues.length ? `\n    ${written.issues.map((i) => i.slice(0, 220)).join("\n    ")}` : "") +
      `\n    summary: ${written.draft.summary.paragraphs.join(" ")}`,
  );
  out.push({ label: c.label, was: c.stored, ok: written.ok, theory: written.theory.name, issues: written.issues, rules, draft: written.draft, stages, usd });
}

const header = `counsel replay — ${cases.length} case(s), ${letters} letter(s), $${cost.toFixed(4)} uncached`;
const dir = path.join("scripts", ".snapshots", "counsel-replay");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dir, `${stamp}.txt`), [header, ...lines].join("\n"));
console.log([header, ...lines].join("\n"));
console.log(`\nsaved: ${path.join(dir, stamp)}.{json,txt}`);
