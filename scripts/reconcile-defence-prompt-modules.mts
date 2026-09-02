/**
 * One-shot reconciliation: promote each file-default reason-code module
 * to a new active DB row when the latest active row diverges from the
 * file. Idempotent — re-running with no drift is a no-op.
 *
 * Background: 2026-05-16 drift incident. The DB row for
 * `visa_10_4_fraud` (v1) shipped an older prompt to Claude than the
 * file at `lib/defence/reasonCodes/visa_10_4_fraud.ts`. The file had
 * three additional guards (CNP qualifier, anti-physical-card-possession,
 * anti-absolute-authorization-conclusions) that were silently absent
 * from prod. This script restores file-as-truth without overwriting the
 * historical record — it inserts NEW rows at version+1 with
 * `intentional_override=false`; older versions stay as audit log.
 *
 * Run:
 *   npx tsx scripts/reconcile-defence-prompt-modules.mts --env-file .env.local
 *   npx tsx scripts/reconcile-defence-prompt-modules.mts --env-file .env.production.local --apply
 *
 * The env file is REQUIRED and the resolved database is printed before any
 * write. It was hardcoded to `.env.local` — which is dev — so running this "to
 * fix prod" reconciled the dev database and printed a confident success while
 * prod stayed drifted. Same trap as `scripts/rebuild-pack.mjs`.
 *
 * Dry run by default. `--apply` is required to write, because this inserts a
 * new active row for every drifted module, and that changes what the model is
 * told on the very next generation.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const envIdx = argv.indexOf("--env-file");
const envFile = envIdx >= 0 ? argv[envIdx + 1] : null;
if (!envFile) {
  console.error("Missing --env-file. Pass it explicitly:");
  console.error("  --env-file .env.local             (dev)");
  console.error("  --env-file .env.production.local  (PROD)");
  process.exit(1);
}
config({ path: envFile });

import { ALL_REASON_CODE_MODULES } from "../lib/defence/reasonCodes/registry";
import { PROMPT_MODULE_GUIDANCE_KEYS } from "../lib/defence/promptModuleGuidanceKeys";
import type { ReasonCodeGuidance } from "../lib/defence/types";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}

// Say which database this is, out loud, before touching it. Mirrors
// scripts/guard-db-target.mjs and scripts/build-one-pack.mjs.
const PROJECT_REFS: Record<string, string> = {
  aokhplydttxtebvbeuzc: "PROD",
  vrpkgudqmpyunekrkpnc: "dev",
};
const ref = new URL(url).hostname.split(".")[0];
const envName = PROJECT_REFS[ref] ?? "UNKNOWN";
console.log(`env-file : ${envFile}`);
console.log(`database : ${ref} (${envName})`);
console.log(`mode     : ${apply ? "APPLY - will write" : "DRY RUN - no writes"}`);
console.log("");
if (envName === "UNKNOWN") {
  console.error("Refusing: unrecognised Supabase project ref.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

/** Same normalisation as lib/defence/admin-queries.ts detectPromptModuleDrift.
 *  Only the five guidance fields the file defaults own are compared. */
const GUIDANCE_KEYS = PROMPT_MODULE_GUIDANCE_KEYS;

function normaliseGuidance(g: Record<string, unknown> | null | undefined): string {
  const obj: Record<string, unknown> = {};
  for (const k of GUIDANCE_KEYS) {
    const v = g?.[k];
    obj[k] = Array.isArray(v) ? v : v ?? null;
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

function fileGuidanceOf(mod: ReasonCodeGuidance): Record<string, unknown> {
  return {
    prioritize: mod.prioritize,
    avoid: mod.avoid,
    mustNotClaim: mod.mustNotClaim,
    criticalCategories: mod.criticalCategories,
    allowedFactCategories: mod.allowedFactCategories,
  };
}

interface DbRow {
  key: string;
  prompt_body: string;
  guidance_json: Record<string, unknown>;
  version: number;
  is_active: boolean;
  intentional_override: boolean | null;
}

let promoted = 0;
let skipped = 0;
let mismatches = 0;

for (const mod of ALL_REASON_CODE_MODULES) {
  const { data: rows, error: selectErr } = await sb
    .from("defence_prompt_modules")
    .select("key, prompt_body, guidance_json, version, is_active, intentional_override")
    .eq("key", mod.key)
    .order("version", { ascending: false })
    .limit(1);
  if (selectErr) {
    console.error(`[error]  ${mod.key}: ${selectErr.message}`);
    process.exit(1);
  }
  const latest = (rows?.[0] as DbRow | undefined) ?? null;
  const fileGuidance = fileGuidanceOf(mod);

  if (!latest) {
    if (!apply) {
      console.log(`[would]   ${mod.key}: no prior row - would insert v1 from file default`);
      promoted += 1;
      continue;
    }
    const { error: insertErr } = await sb.from("defence_prompt_modules").insert({
      key: mod.key,
      display_name: mod.displayName,
      reason_code_keys: mod.reasonCodeKeys,
      prompt_body: mod.promptBody,
      guidance_json: fileGuidance,
      model: null,
      is_active: true,
      version: 1,
      intentional_override: false,
      updated_by: "reconcile-script",
    });
    if (insertErr) {
      console.error(`[error]  ${mod.key}: insert v1 failed: ${insertErr.message}`);
      process.exit(1);
    }
    console.log(`[promote] ${mod.key}: no prior row — inserted v1 from file default`);
    promoted += 1;
    continue;
  }

  const bodyDrifted = latest.prompt_body !== mod.promptBody;
  const guidanceDrifted =
    normaliseGuidance(latest.guidance_json) !== normaliseGuidance(fileGuidance);

  if (!bodyDrifted && !guidanceDrifted) {
    console.log(`[skip]    ${mod.key}: DB v${latest.version} matches file — no change`);
    skipped += 1;
    continue;
  }

  if (latest.intentional_override === true) {
    console.log(
      `[skip]    ${mod.key}: DB v${latest.version} drifts from file but intentional_override=true — leaving as-is`,
    );
    mismatches += 1;
    continue;
  }

  const nextVersion = latest.version + 1;
  const driftReasons: string[] = [];
  if (bodyDrifted) driftReasons.push("body");
  if (guidanceDrifted) driftReasons.push("guidance");
  if (!apply) {
    console.log(
      `[would]   ${mod.key}: DB v${latest.version} -> v${nextVersion} (drift in: ${driftReasons.join(", ")})`,
    );
    promoted += 1;
    continue;
  }
  const { error: insertErr } = await sb.from("defence_prompt_modules").insert({
    key: mod.key,
    display_name: mod.displayName,
    reason_code_keys: mod.reasonCodeKeys,
    prompt_body: mod.promptBody,
    guidance_json: fileGuidance,
    model: null,
    is_active: true,
    version: nextVersion,
    intentional_override: false,
    updated_by: "reconcile-script",
  });
  if (insertErr) {
    console.error(`[error]  ${mod.key}: insert v${nextVersion} failed: ${insertErr.message}`);
    process.exit(1);
  }
  console.log(
    `[promote] ${mod.key}: DB v${latest.version} -> v${nextVersion} (drift in: ${driftReasons.join(", ")})`,
  );
  promoted += 1;
}

console.log("");
console.log(
  `Done. ${promoted} ${apply ? "promoted" : "would be promoted"}, ${skipped} already in sync, ${mismatches} kept (intentional_override=true).`,
);
if (!apply && promoted > 0) {
  console.log("Re-run with --apply to write these.");
}
