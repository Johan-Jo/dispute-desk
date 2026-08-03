#!/usr/bin/env node
/**
 * READ-ONLY REPORT. Two numbers, both computed from data we already hold —
 * no Shopify call, no issuer document, no inference about what the cardholder
 * actually claimed.
 *
 *   (1) SUPPRESSION — for each dispute, which bank-eligible facts were kept
 *       out of the letter because the reason module the BANK's label selected
 *       does not list their category in `allowedFactCategories`.
 *   (2) AMBIGUITY   — how much volume sits on a network reason code that our
 *       own `reasonCodeCatalog.ts` says spans more than one claim type.
 *
 * WHY. Every defence decision keys off `disputes.reason`, which comes from the
 * issuer's filing, and the two disputes examined by hand in 2026-08 both had it
 * wrong (#345920 labelled not-as-described, decided on delivery; #352552
 * labelled not-as-described, claim document is a fraud questionnaire). We
 * cannot verify a label — the issuer claim is Admin-UI only. But we CAN measure
 * what the label costs us when it is wrong, and how often it is structurally
 * ambiguous. Those two numbers decide whether a union defence is worth
 * building (docs/plans/claim-shape-not-bank-label.plan.md).
 *
 * Deliberately NOT measured: a "contradiction rate" between the label and some
 * derived claim shape. That number would describe the resolver, not reality —
 * high disagreement is equally consistent with bad labels and a bad resolver,
 * and we have exactly two ground-truth cases to tell them apart.
 *
 * Usage:
 *   node scripts/report-label-suppressed-facts.mjs --env-file .env.production.local
 *   ... --include-closed     also report decided disputes (few have packs)
 *   ... --json
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

function loadEnv(file = ".env.local") {
  try {
    const raw = readFileSync(join(process.cwd(), file), "utf-8");
    const vars = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let val = t.slice(i + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      const key = t.slice(0, i).trim();
      if (val === "" && vars[key]) continue;
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

/**
 * Parse `key` + `allowedFactCategories` straight out of the reason-code module
 * sources. Parsed rather than hardcoded so the report cannot quietly describe
 * a policy the code no longer has; a parse miss throws instead of guessing.
 */
function loadReasonModules() {
  const dir = join(process.cwd(), "lib/defence/reasonCodes");
  const out = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file === "registry.ts" || file === "familyRegistry.ts") continue;
    const src = readFileSync(join(dir, file), "utf-8");
    const key = /^\s*key:\s*"([^"]+)"/m.exec(src)?.[1];
    const block = /allowedFactCategories:\s*\[([\s\S]*?)\]/m.exec(src)?.[1];
    if (!key || !block) continue;
    const categories = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    out.set(key, categories);
  }
  if (out.size === 0) throw new Error("Parsed no reason modules — did the file shape change?");
  return out;
}

/** Codes our catalog says map to more than one Shopify claim type. */
function loadAmbiguousCodes() {
  const src = readFileSync(join(process.cwd(), "lib/disputes/reasonCodeCatalog.ts"), "utf-8");
  const ambiguous = new Map();
  // Entries look like: { code: "4853", … shopifyEnumFallbacks: ["A", "B"], … }
  for (const m of src.matchAll(/code:\s*"([^"]+)"[\s\S]*?shopifyEnumFallbacks:\s*\[([^\]]*)\]/g)) {
    const code = m[1];
    const fallbacks = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    if (fallbacks.length > 1) ambiguous.set(code, fallbacks);
  }
  return ambiguous;
}

async function rest(env, path) {
  const get = (k) => (env[k] != null && env[k] !== "" ? env[k] : process.env[k]);
  const url = (get("SUPABASE_URL") || get("NEXT_PUBLIC_SUPABASE_URL") || "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (use --env-file .env.production.local)");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const env = loadEnv(arg("env-file", ".env.local"));
  const includeClosed = arg("include-closed") === true;
  const modules = loadReasonModules();
  const ambiguousCodes = loadAmbiguousCodes();

  // Latest defence package per dispute carries both the module that was used
  // and the classified facts, so no re-derivation is needed here.
  const packages = await rest(
    env,
    "defence_packages?select=dispute_id,version,reason_code_module,facts_json,created_at" +
      "&order=dispute_id,version.desc",
  );
  const latest = new Map();
  for (const p of packages) if (!latest.has(p.dispute_id)) latest.set(p.dispute_id, p);

  const ids = [...latest.keys()];
  const disputes = new Map();
  // Chunked to keep the URL length sane.
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const rows = await rest(
      env,
      `disputes?id=in.(${chunk.join(",")})&select=id,order_name,reason,network_reason_code,final_outcome,shop_id`,
    );
    for (const r of rows) disputes.set(r.id, r);
  }

  const suppressed = [];
  const byCategory = new Map();
  let considered = 0;

  for (const [disputeId, pkg] of latest) {
    const d = disputes.get(disputeId);
    if (!d) continue;
    if (!includeClosed && d.final_outcome) continue;
    const allowed = modules.get(pkg.reason_code_module);
    if (!allowed) continue;
    considered += 1;

    const facts = Array.isArray(pkg.facts_json) ? pkg.facts_json : [];
    // Only facts the classifier considered fit for the bank. A fact excluded
    // for its own reasons (submission risk, internal-only, weak) was not
    // suppressed BY THE LABEL and does not belong in this count.
    const missed = new Set();
    for (const f of facts) {
      if (!f?.bankEligible) continue;
      const category = f.category;
      if (!category || allowed.includes(category)) continue;
      missed.add(category);
    }
    if (missed.size === 0) continue;
    for (const c of missed) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
    suppressed.push({
      order: d.order_name,
      disputeId,
      reason: d.reason,
      networkCode: d.network_reason_code,
      module: pkg.reason_code_module,
      categories: [...missed],
    });
  }

  // ── Ambiguity: volume sitting on a code that spans >1 claim type ──
  const allDisputes = await rest(
    env,
    "disputes?select=id,reason,network_reason_code,final_outcome&limit=2000",
  );
  const scope = includeClosed ? allDisputes : allDisputes.filter((d) => !d.final_outcome);
  let ambiguousCount = 0;
  const ambiguousBreakdown = new Map();
  for (const d of scope) {
    const code = d.network_reason_code;
    if (code && ambiguousCodes.has(code)) {
      ambiguousCount += 1;
      ambiguousBreakdown.set(code, (ambiguousBreakdown.get(code) ?? 0) + 1);
    }
  }

  if (arg("json") === true) {
    console.log(JSON.stringify({ considered, suppressed, ambiguous: { total: ambiguousCount, of: scope.length } }, null, 2));
    return;
  }

  console.log(`\n── 1. Facts the bank's label kept out of the letter ──`);
  console.log(`   ${suppressed.length} of ${considered} disputes with a defence package\n`);
  for (const s of suppressed.slice(0, 40)) {
    console.log(
      `   ${(s.order ?? "—").padEnd(10)} ${String(s.reason).padEnd(22)} code=${String(s.networkCode ?? "—").padEnd(6)} ` +
        `module=${s.module.padEnd(22)} suppressed: ${s.categories.join(", ")}`,
    );
  }
  if (suppressed.length > 40) console.log(`   … and ${suppressed.length - 40} more`);
  if (byCategory.size) {
    console.log(`\n   by category:`);
    for (const [c, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${c.padEnd(28)} ${n}`);
    }
  }

  console.log(`\n── 2. Disputes on a structurally ambiguous reason code ──`);
  console.log(`   ${ambiguousCount} of ${scope.length} disputes`);
  for (const [code, n] of [...ambiguousBreakdown].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${code}  ${n}   spans: ${ambiguousCodes.get(code).join(" / ")}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
