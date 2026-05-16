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
 *   npx tsx scripts/reconcile-defence-prompt-modules.mts
 *
 * Env (one of):
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

import { ALL_REASON_CODE_MODULES } from "../lib/defence/reasonCodes/registry";
import type { ReasonCodeGuidance } from "../lib/defence/types";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

/** Same normalisation as lib/defence/admin-queries.ts detectPromptModuleDrift.
 *  Only the five guidance fields the file defaults own are compared. */
const GUIDANCE_KEYS = [
  "prioritize",
  "avoid",
  "mustNotClaim",
  "criticalCategories",
  "allowedFactCategories",
] as const;

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
  const reasons: string[] = [];
  if (bodyDrifted) reasons.push("body");
  if (guidanceDrifted) reasons.push("guidance");
  console.log(
    `[promote] ${mod.key}: DB v${latest.version} → v${nextVersion} (drift in: ${reasons.join(", ")})`,
  );
  promoted += 1;
}

console.log("");
console.log(
  `Done. ${promoted} promoted, ${skipped} already in sync, ${mismatches} kept (intentional_override=true).`,
);
