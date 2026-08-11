/**
 * D-1 — the POPULATION half of the measurement. READ-ONLY. Plan §7.3.
 *
 * `lib/defence/package/__tests__/d1BillingMatchReplay.test.ts` enumerates the
 * whole 32-cell input space and finds exactly two cells that move
 * `narrow → full` when the orphaned `billing_match` entry is removed. What it
 * could not say — it runs in CI, with no database — is HOW MANY LIVE PACKAGES
 * sit in those two cells. That is the number the removal decision turns on, and
 * it is the number this file measures.
 *
 * Method: every `visa_10_4_fraud` package, its OWN stored `facts_json`, run
 * through the REAL `derivePackageMode` twice — once against the module as it
 * ships, once against the module with the entry removed. Nothing is
 * re-derived and nothing is re-classified; the only difference between the two
 * arms is the one array element D-1 is about.
 *
 * MEASURES, DOES NOT DECIDE. `visa_10_4_fraud.ts` is untouched.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/d1BillingMatchPopulation.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { derivePackageMode } from "@/lib/defence/factClassifier";
import { visa_10_4_fraud } from "@/lib/defence/reasonCodes/visa_10_4_fraud";
import type { EvidenceFact, ReasonCodeGuidance } from "@/lib/defence/types";
import type { CaseStrengthLevel } from "@/lib/argument/types";

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
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + page - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

const BEFORE: ReasonCodeGuidance = visa_10_4_fraud;
const AFTER: ReasonCodeGuidance = {
  ...visa_10_4_fraud,
  criticalCategories: visa_10_4_fraud.criticalCategories.filter((c) => c !== "billing_match"),
};

interface PackageRow {
  id: string;
  dispute_id: string | null;
  version: number | null;
  status: string | null;
  package_mode: string | null;
  reason_code_module: string | null;
  facts_json: unknown;
  created_at: string;
}
interface PackRow {
  dispute_id: string | null;
  pack_json: Record<string, any> | null;
  created_at: string;
}

/**
 * The approved facts a package actually carries.
 *
 * `facts_json` is read as stored and never re-classified: the point is what the
 * package HAS, not what a re-run would produce. A shape this does not recognise
 * is counted as `unreadable_facts` rather than silently treated as empty —
 * empty facts always derive `narrow`, so swallowing them would understate the
 * transition count and understate it in the reassuring direction.
 */
function approvedFactsOf(factsJson: unknown): EvidenceFact[] | null {
  if (!factsJson || typeof factsJson !== "object") return null;
  const raw = Array.isArray(factsJson)
    ? factsJson
    : ((factsJson as { facts?: unknown }).facts ??
       (factsJson as { approved?: unknown }).approved ??
       (factsJson as { approvedFacts?: unknown }).approvedFacts);
  if (!Array.isArray(raw)) return null;
  const facts = raw.filter(
    (f): f is EvidenceFact =>
      !!f && typeof f === "object" && typeof (f as { category?: unknown }).category === "string",
  );
  // A package with a readable array and no approved facts is a real state.
  return facts.filter((f) => (f as { status?: string }).status !== "review_required");
}

describe("D-1 — population", () => {
  it("counts every live visa_10_4_fraud package that would change mode", async () => {
    const packages = (
      await rest<PackageRow>(
        "defence_packages?select=id,dispute_id,version,status,package_mode,reason_code_module,facts_json,created_at&reason_code_module=eq.visa_10_4_fraud",
      )
    ).filter((p) => p.dispute_id);

    const disputes = await rest<{ id: string; final_outcome: string | null }>(
      "disputes?select=id,final_outcome",
    );
    const openIds = new Set(
      disputes.filter((d) => d.final_outcome === null).map((d) => d.id),
    );

    const packs = await rest<PackRow>(
      "evidence_packs?select=dispute_id,pack_json,created_at&order=created_at.desc",
    );
    const latestPack = new Map<string, PackRow>();
    for (const p of packs) if (p.dispute_id && !latestPack.has(p.dispute_id)) latestPack.set(p.dispute_id, p);

    console.log(`\nVISA 10.4 PACKAGES (all time): ${packages.length}`);
    console.log(`  on an OPEN dispute: ${packages.filter((p) => openIds.has(p.dispute_id!)).length}`);

    const persistedModes = new Map<string, number>();
    for (const p of packages) {
      const k = p.package_mode ?? "null";
      persistedModes.set(k, (persistedModes.get(k) ?? 0) + 1);
    }
    console.log(`  persisted package_mode: ${[...persistedModes].map(([k, v]) => `${k}=${v}`).join(" ")}`);

    let unreadable = 0;
    let noStrength = 0;
    const transitions: string[] = [];
    /* The decision-relevant subset: the HIGHEST version per open dispute.
     * Superseded/stale/failed versions are history — they are counted in the
     * all-time figure for completeness, but nothing will ever file them, and a
     * removal decision taken on a number inflated by 15 dead versions of one
     * case would be taken on the wrong number. `case_strength` is read from the
     * LATEST pack, which is only strictly correct for the latest version, so
     * this subset is also the one where the strength input is exact. */
    const latestVersionPerCase = new Map<string, number>();
    for (const p of packages) {
      if (!p.dispute_id || !openIds.has(p.dispute_id)) continue;
      const v = p.version ?? 0;
      if ((latestVersionPerCase.get(p.dispute_id) ?? -1) < v) latestVersionPerCase.set(p.dispute_id, v);
    }
    const currentTransitions: string[] = [];
    const unchanged = new Map<string, number>();
    const openTransitions: string[] = [];

    for (const pkg of packages) {
      const facts = approvedFactsOf(pkg.facts_json);
      if (!facts) {
        unreadable += 1;
        continue;
      }
      const pack = latestPack.get(pkg.dispute_id!);
      const strength = pack?.pack_json?.case_strength?.overall as CaseStrengthLevel | undefined;
      if (!strength) {
        noStrength += 1;
        continue;
      }
      const fatalLoss = {
        triggered: pack?.pack_json?.fatal_loss?.triggered === true,
        reason: (pack?.pack_json?.fatal_loss?.reason as string | null) ?? null,
      };

      const before = derivePackageMode({
        approvedFacts: facts,
        caseStrength: strength,
        fatalLoss,
        reasonCodeModule: BEFORE,
      });
      const after = derivePackageMode({
        approvedFacts: facts,
        caseStrength: strength,
        fatalLoss,
        reasonCodeModule: AFTER,
      });

      if (before === after) {
        const k = `${before} (unchanged)`;
        unchanged.set(k, (unchanged.get(k) ?? 0) + 1);
        continue;
      }
      const open = openIds.has(pkg.dispute_id!);
      const row =
        `${pkg.dispute_id!.slice(0, 8)} v${pkg.version} ${pkg.status} ${before}→${after} ` +
        `strength=${strength} categories=${new Set(facts.map((f) => f.category)).size} ` +
        `${open ? "OPEN" : "closed"}`;
      transitions.push(row);
      if (open) openTransitions.push(row);
      if (open && latestVersionPerCase.get(pkg.dispute_id!) === (pkg.version ?? 0)) {
        currentTransitions.push(row);
      }
    }

    console.log(`\n  unreadable facts_json: ${unreadable}`);
    console.log(`  no case_strength on the latest pack: ${noStrength}`);
    console.log(`  recomputed BEFORE === AFTER: ${[...unchanged].map(([k, v]) => `${k}=${v}`).join(" ")}`);

    console.log(`\n── D-1 TRANSITIONS (narrow → full if the entry is removed) ──`);
    console.log(`  all time: ${transitions.length}`);
    console.log(`  on OPEN disputes (all versions): ${openTransitions.length}`);
    console.log(
      `  CURRENT version on an OPEN dispute — the decision-relevant count: ` +
        `${currentTransitions.length} packages across ${new Set(currentTransitions.map((r) => r.slice(0, 8))).size} cases`,
    );
    for (const r of currentTransitions) console.log(`      ${r}`);
    for (const r of transitions.slice(0, 40)) console.log(`      ${r}`);
    if (transitions.length > 40) console.log(`      … ${transitions.length - 40} more`);
  });
});
