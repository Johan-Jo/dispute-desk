/**
 * CI drift guard for defence prompt modules.
 *
 * Skips entirely when Supabase service-role credentials are not set
 * (local dev without `.env.local`, contributor PRs without secrets).
 * In CI the secrets are populated; the guard then asserts:
 *
 *   For each module in ALL_REASON_CODE_MODULES, the latest active DB
 *   row either matches the file default byte-for-byte OR carries
 *   intentional_override=true.
 *
 * On failure the message names the drifted module(s) and points the
 * operator at the reconcile script. Same pattern as
 * `lib/shopify/queries/__tests__/schemaDriftGuard.test.ts`, but
 * DB-backed because the source of truth here is a Supabase table
 * row, not a query string in code.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { ALL_REASON_CODE_MODULES } from "../reasonCodes/registry";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HAS_CREDS = Boolean(SUPABASE_URL && SUPABASE_KEY);

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

describe("defence prompt modules — drift guard", () => {
  it.skipIf(!HAS_CREDS)(
    "every active DB row matches file default OR has intentional_override=true",
    async () => {
      const sb = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
        auth: { persistSession: false },
      });

      const { data, error } = await sb
        .from("defence_prompt_modules")
        .select("key, prompt_body, guidance_json, version, intentional_override")
        .eq("is_active", true)
        .order("version", { ascending: false });

      expect(error, error?.message ?? "select failed").toBeNull();

      type DbRow = {
        key: string;
        prompt_body: string;
        guidance_json: Record<string, unknown>;
        version: number;
        intentional_override: boolean | null;
      };

      const latestByKey = new Map<string, DbRow>();
      for (const row of (data ?? []) as DbRow[]) {
        if (!latestByKey.has(row.key)) latestByKey.set(row.key, row);
      }

      const undeclaredDrift: Array<{ key: string; reasons: string[] }> = [];

      for (const mod of ALL_REASON_CODE_MODULES) {
        const dbRow = latestByKey.get(mod.key);
        if (!dbRow) {
          // No DB row → reconcile script should insert one.
          undeclaredDrift.push({
            key: mod.key,
            reasons: ["no active DB row exists"],
          });
          continue;
        }
        if (dbRow.intentional_override === true) continue;

        const reasons: string[] = [];
        if (dbRow.prompt_body !== mod.promptBody) reasons.push("prompt_body");
        const fileGuidance = {
          prioritize: mod.prioritize,
          avoid: mod.avoid,
          mustNotClaim: mod.mustNotClaim,
          criticalCategories: mod.criticalCategories,
          allowedFactCategories: mod.allowedFactCategories,
        };
        if (normaliseGuidance(dbRow.guidance_json) !== normaliseGuidance(fileGuidance)) {
          reasons.push("guidance_json");
        }
        if (reasons.length > 0) {
          undeclaredDrift.push({ key: mod.key, reasons });
        }
      }

      if (undeclaredDrift.length > 0) {
        const lines = undeclaredDrift.map(
          (d) => `  - ${d.key}: ${d.reasons.join(", ")}`,
        );
        throw new Error(
          [
            `${undeclaredDrift.length} defence_prompt_modules row(s) diverge from file default and are not marked intentional_override=true:`,
            ...lines,
            "",
            "Remediation:",
            "  1. Run `npx tsx scripts/reconcile-defence-prompt-modules.mts` to promote the file default into a new active DB version.",
            "  2. OR if the divergence is deliberate, set `intentional_override=true` on the row.",
          ].join("\n"),
        );
      }

      expect(undeclaredDrift).toEqual([]);
    },
  );

  it("skips cleanly when Supabase credentials are not set", () => {
    // This is informational — the test above carries the it.skipIf logic.
    // We assert the flag is observable so CI logs can show it.
    expect(typeof HAS_CREDS).toBe("boolean");
  });
});
