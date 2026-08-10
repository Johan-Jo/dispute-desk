/**
 * C-11 census re-run — §7.2's invariant. READ-ONLY.
 *
 * The plan pins prod-measured behaviour that `selectFileablePackage` must
 * preserve: **212 of 280 package versions blocked, across 91 disputes**. A
 * different count on the same population is wrong until explained.
 *
 * This runs the REAL `assessPackageCandidateSafety` over every stored package
 * version, so the number is produced by the predicate rather than recalled from
 * the plan. The selector arm of the whole-pipeline replay cannot reproduce it —
 * with no canonical identity columns on prod, staleness short-circuits before
 * the content verdict is ever consulted — so it is measured directly here.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/c11PackageSafetyCensus.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { assessPackageCandidateSafety } from "@/lib/defence/packageSafety";

const ENV_FILE = process.env.ANALYSIS_ENV_FILE ?? ".env.production.local";

function loadEnv(file: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(process.cwd(), file), "utf-8").split("\n")) {
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
  } catch {
    /* ignore */
  }
  return vars;
}
const env = loadEnv(ENV_FILE);
const get = (k: string) => (env[k] && env[k] !== "" ? env[k] : process.env[k]);

async function rest<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`Need credentials in ${ENV_FILE}`);
  const page = 500;
  const out: T[] = [];
  for (let offset = 0; ; offset += page) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + page - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

interface Row {
  id: string;
  dispute_id: string | null;
  version: number | null;
  status: string | null;
  facts_json: unknown;
  narrative_json: unknown;
}

describe("C-11 census", () => {
  it("reproduces the blocked count the plan pins", async () => {
    const rows = await rest<Row>(
      "defence_packages?select=id,dispute_id,version,status,facts_json,narrative_json",
    );
    console.log(`\nPACKAGE VERSIONS (all): ${rows.length}`);

    let blocked = 0;
    const blockedDisputes = new Set<string>();
    const reasons = new Map<string, number>();

    for (const r of rows) {
      const verdict = assessPackageCandidateSafety({
        factsJson: r.facts_json,
        narrativeJson: r.narrative_json,
      });
      if (verdict.safe) continue;
      blocked += 1;
      if (r.dispute_id) blockedDisputes.add(r.dispute_id);
      for (const reason of verdict.reasons) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }

    console.log(`BLOCKED: ${blocked} of ${rows.length}, across ${blockedDisputes.size} disputes`);
    console.log(`PLAN §7.2 pins: 212 of 280, across 91 disputes`);
    console.log(`REASONS: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  });
});
