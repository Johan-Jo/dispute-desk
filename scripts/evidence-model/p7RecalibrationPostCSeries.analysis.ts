/**
 * P-7 recalibration on the POST-C-SERIES baseline, plus the activation-OFF
 * divergence introduced by the ungated `decideForPack`. READ-ONLY.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * P-7's threshold of 60 was calibrated when the canonical scale sat −1…−7 /
 * +2…+17 against the persisted column. The four packs rebuilt after the
 * 2026-08-11 promotion landed 20–36 points BELOW it — one of them at 62,
 * two points from blocking. That calibration predates C-12/C-13/C-14, which
 * changed evidence classification.
 *
 * Four packs is a sample, not a distribution. This reconstructs the canonical
 * score for the WHOLE open-unsubmitted population using the REAL
 * `deriveCaseEvidenceModel` + `deriveCompletenessSnapshot` — the same two calls
 * `buildCaseAssessmentSnapshot` makes — over each pack's own stored
 * `pack_json`. Nothing is re-implemented, and nothing is written.
 *
 * FIDELITY NOTE, stated because it bounds every number below. The canonical
 * COMPLETENESS score is a pure function of the evidence model, which is a pure
 * function of `pack_json.sections` + `waived_items` + coverage. All three are
 * persisted, so the reconstruction is exact for completeness. The canonical
 * STRENGTH is not: it needs `CaseGateAssessment`, three of whose five gates
 * come from the Shopify order, which only `buildPack` loads. Strength is
 * therefore read from the persisted snapshot where one exists and reported as
 * unavailable otherwise — never guessed.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/p7RecalibrationPostCSeries.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { deriveCompletenessSnapshot } from "@/lib/evidence/model/completenessSnapshot";
import { evaluateAutoSubmitGuards } from "@/lib/automation/autoSubmitGuards";
import { decideForPack } from "@/lib/automation/decision";
import { resolveEffectiveCompleteness } from "@/lib/evidence/model/completenessActivation";

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

async function page<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`Need credentials in ${ENV_FILE}`);
  const out: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + 499}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

interface PackRow {
  id: string;
  shop_id: string;
  dispute_id: string | null;
  completeness_score: number | null;
  blockers: unknown;
  submission_readiness: unknown;
  status: string | null;
  saved_to_shopify_at: string | null;
  pack_json: Record<string, any> | null;
  waived_items: unknown;
  rebuild_pending: boolean | null;
  created_at: string;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

describe("P-7 recalibration — post-C-series", () => {
  it("reconstructs the canonical score for the whole open-unsubmitted population", async () => {
    const disputes = await page<{
      id: string;
      shop_id: string;
      reason: string | null;
      due_at: string | null;
      final_outcome: string | null;
    }>("disputes?select=id,shop_id,reason,due_at,final_outcome&final_outcome=is.null");
    const open = new Map(disputes.map((d) => [d.id, d]));

    const packs = await page<PackRow>(
      "evidence_packs?select=id,shop_id,dispute_id,completeness_score,blockers,submission_readiness,status,saved_to_shopify_at,pack_json,waived_items,rebuild_pending,created_at&order=created_at.desc",
    );
    const latest = new Map<string, PackRow>();
    for (const p of packs) {
      if (p.dispute_id && open.has(p.dispute_id) && !latest.has(p.dispute_id)) {
        latest.set(p.dispute_id, p);
      }
    }
    const population = [...latest.values()].filter((p) => p.saved_to_shopify_at === null);

    const shops = await page<{ id: string; shop_domain: string | null }>(
      "shops?select=id,shop_domain",
    );
    const domainOf = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const settingsRows = await page<{
      shop_id: string;
      auto_save_enabled: boolean | null;
      auto_save_min_score: number | null;
      enforce_no_blockers: boolean | null;
    }>(
      "shop_settings?select=shop_id,auto_save_enabled,auto_save_min_score,enforce_no_blockers",
    );
    const settingsOf = new Map(settingsRows.map((s) => [s.shop_id, s]));

    console.log(`\nPOPULATION (open + unsubmitted): ${population.length}`);

    interface Row {
      disputeId: string;
      shop: string;
      persisted: number;
      canonical: number;
      delta: number;
      strength: string | null;
      carriesSnapshot: boolean;
      snapshotScore: number | null;
      fatalLoss: boolean;
      coverage: string | null;
      retiredSeen: number;
    }
    const rows: Row[] = [];
    let unreconstructable = 0;

    for (const p of population) {
      const d = open.get(p.dispute_id!)!;
      const pj = p.pack_json ?? {};
      const sectionsRaw = (pj.sections as unknown[]) ?? [];
      if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
        unreconstructable += 1;
        continue;
      }

      const derived = deriveCaseEvidenceModel({
        disputeId: p.dispute_id!,
        reason: d.reason ?? null,
        packId: p.id,
        sections: (sectionsRaw as Array<Record<string, unknown>>).map((sec) => ({
          source: (sec.source as string | undefined) ?? null,
          fieldsProvided: (sec.fieldsProvided as string[] | undefined) ?? [],
          data: (sec.data as Record<string, unknown> | undefined) ?? null,
        })),
        waivedItems: (p.waived_items as never) ?? [],
        coverage: {
          state: (pj.coverage?.state as string | undefined) ?? null,
          shopifyProtectStatus:
            (pj.coverage?.shopifyProtectStatus as string | undefined) ?? null,
        },
      });

      const snap = deriveCompletenessSnapshot(derived.model);
      const persistedSnapshot = pj.case_assessment as
        | { completeness?: { score?: number }; strength?: { overall?: string } }
        | undefined;

      rows.push({
        disputeId: p.dispute_id!,
        shop: domainOf.get(p.shop_id) ?? p.shop_id,
        persisted: p.completeness_score ?? 0,
        canonical: snap.score,
        delta: snap.score - (p.completeness_score ?? 0),
        strength: (pj.case_strength?.overall as string | undefined) ?? null,
        carriesSnapshot: !!persistedSnapshot,
        snapshotScore: persistedSnapshot?.completeness?.score ?? null,
        fatalLoss: pj.fatal_loss?.triggered === true,
        coverage: (pj.coverage?.state as string | undefined) ?? null,
        retiredSeen: (derived as { retiredKeysSeen?: unknown[] }).retiredKeysSeen?.length ?? 0,
      });
    }

    console.log(`  reconstructed: ${rows.length}   unreconstructable (no sections): ${unreconstructable}`);

    /* ── Guard the reconstruction against the four known-good packs ────── */
    const known = rows.filter((r) => r.carriesSnapshot && r.snapshotScore !== null);
    const mismatched = known.filter((r) => r.canonical !== r.snapshotScore);
    console.log(
      `\n── RECONSTRUCTION FIDELITY ──\n  packs carrying a real snapshot: ${known.length}` +
        `\n  reconstruction disagrees with the persisted snapshot: ${mismatched.length}`,
    );
    for (const m of mismatched) {
      console.log(`      ${m.disputeId.slice(0, 8)} reconstructed=${m.canonical} persisted_snapshot=${m.snapshotScore}`);
    }
    if (known.length && mismatched.length === 0) {
      console.log("  → the reconstruction reproduces the real writer exactly on every checkable pack.");
    }

    /* ── Distributions ────────────────────────────────────────────────── */
    const deltas = rows.map((r) => r.delta).sort((a, b) => a - b);
    const canon = rows.map((r) => r.canonical).sort((a, b) => a - b);
    const pers = rows.map((r) => r.persisted).sort((a, b) => a - b);

    console.log("\n── SCORE DISTRIBUTION ──");
    const dist = (label: string, s: number[]) =>
      console.log(
        `  ${label.padEnd(11)} min=${s[0]} p10=${pct(s, 10)} p25=${pct(s, 25)} median=${pct(s, 50)} ` +
          `p75=${pct(s, 75)} p90=${pct(s, 90)} max=${s[s.length - 1]}`,
      );
    dist("persisted", pers);
    dist("canonical", canon);
    dist("delta", deltas);

    /* ── Threshold sweep ──────────────────────────────────────────────── */
    console.log("\n── THRESHOLD SWEEP (canonical scale) ──");
    console.log("  thr | pass | block | (persisted@merchant-thr for reference)");
    for (let t = 50; t <= 80; t += 5) {
      const pass = rows.filter((r) => r.canonical >= t).length;
      console.log(`  ${String(t).padStart(3)} | ${String(pass).padStart(4)} | ${String(rows.length - pass).padStart(5)}`);
    }

    /* ── Who changes at 60 ────────────────────────────────────────────── */
    console.log("\n── P-7 RESULT CHANGES AT THRESHOLD 60 ──");
    const changed = rows.filter((r) => {
      const s = settingsOf.get(population.find((p) => p.dispute_id === r.disputeId)!.shop_id);
      const merchantThr = s?.auto_save_min_score ?? 60;
      const legacyPasses = r.persisted >= merchantThr;
      const canonicalPasses = r.canonical >= 60;
      return legacyPasses !== canonicalPasses;
    });
    console.log(`  cases whose pass/block flips when P-7 engages: ${changed.length}`);
    for (const c of changed.slice(0, 25)) {
      console.log(
        `      ${c.disputeId.slice(0, 8)} ${c.shop} persisted=${c.persisted} canonical=${c.canonical} ` +
          `delta=${c.delta} strength=${c.strength}`,
      );
    }
    if (changed.length > 25) console.log(`      … ${changed.length - 25} more`);

    const margin = rows.filter((r) => r.canonical >= 60 && r.canonical < 70);
    console.log(`\n  cases within 10 points ABOVE 60 (would block on a small further drop): ${margin.length}`);
    for (const m of margin.slice(0, 15)) {
      console.log(`      ${m.disputeId.slice(0, 8)} canonical=${m.canonical} persisted=${m.persisted}`);
    }

    /* ── Why the gap ──────────────────────────────────────────────────── */
    console.log("\n── WHY THE DIFFERENCE ──");
    const bigDrops = rows.filter((r) => r.delta <= -20);
    console.log(`  packs dropping ≥20 points: ${bigDrops.length}`);
    console.log(`  packs with fatal_loss triggered: ${rows.filter((r) => r.fatalLoss).length}`);
    console.log(`  packs with coverage != not_covered: ${rows.filter((r) => r.coverage && r.coverage !== "not_covered").length}`);
    console.log(`  packs where the derive step saw RETIRED keys (C-14): ${rows.filter((r) => r.retiredSeen > 0).length}`);
    const byShop = new Map<string, number[]>();
    for (const r of rows) {
      if (!byShop.has(r.shop)) byShop.set(r.shop, []);
      byShop.get(r.shop)!.push(r.delta);
    }
    for (const [shop, ds] of byShop) {
      const s = [...ds].sort((a, b) => a - b);
      console.log(`  ${shop}: n=${s.length} min=${s[0]} median=${pct(s, 50)} max=${s[s.length - 1]}`);
    }
  });

  /* ── Item 1: the activation-OFF divergence, quantified ───────────────── */

  it("quantifies the ungated decideForPack divergence with activation OFF", async () => {
    const disputes = await page<{
      id: string;
      shop_id: string;
      due_at: string | null;
      final_outcome: string | null;
    }>("disputes?select=id,shop_id,due_at,final_outcome&final_outcome=is.null");
    const open = new Map(disputes.map((d) => [d.id, d]));
    const packs = await page<PackRow>(
      "evidence_packs?select=id,shop_id,dispute_id,completeness_score,blockers,submission_readiness,status,saved_to_shopify_at,pack_json,waived_items,rebuild_pending,created_at&order=created_at.desc",
    );
    const latest = new Map<string, PackRow>();
    for (const p of packs) {
      if (p.dispute_id && open.has(p.dispute_id) && !latest.has(p.dispute_id)) latest.set(p.dispute_id, p);
    }
    const population = [...latest.values()].filter((p) => p.saved_to_shopify_at === null);
    const shops = await page<{ id: string; shop_domain: string | null }>("shops?select=id,shop_domain");
    const domainOf = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const settingsRows = await page<{
      shop_id: string;
      auto_save_enabled: boolean | null;
      auto_save_min_score: number | null;
      enforce_no_blockers: boolean | null;
    }>("shop_settings?select=shop_id,auto_save_enabled,auto_save_min_score,enforce_no_blockers");
    const settingsOf = new Map(settingsRows.map((s) => [s.shop_id, s]));

    /* `buildDefencePackageJob` reaches this only when the rules resolve to
     * `auto`. Both arms are given `auto`, which is the strictly larger
     * population and keeps the comparison about the ladders alone. */
    const matrix = new Map<string, string[]>();

    for (const p of population) {
      const d = open.get(p.dispute_id!)!;
      const s = settingsOf.get(p.shop_id);
      if (!s) continue;
      const pj = p.pack_json ?? {};

      // LEGACY: exactly what this handler ran before CP-C.
      const verdict = evaluateAutoSubmitGuards({
        coverageState: (pj.coverage?.state as string | undefined) ?? null,
        fatalLoss: pj.fatal_loss ?? null,
        caseStrength: (pj.case_strength?.overall as string | undefined) ?? null,
        creditAlreadyIssued: pj.credit_already_issued ?? null,
      });
      const legacyFiles = verdict.decision === "proceed";

      // CURRENT: the ungated canonical decision, activation OFF (no plan, so
      // reviewRequiredCount is 0 — exactly what the live route passes).
      const effective = resolveEffectiveCompleteness({
        shopDomain: domainOf.get(p.shop_id) ?? null,
        packJson: p.pack_json,
        rebuildPending: p.rebuild_pending,
        persistedScore: p.completeness_score,
        merchantThreshold: s.auto_save_min_score ?? 60,
      });
      const decision = decideForPack({
        caseId: p.dispute_id!,
        pack: {
          id: p.id,
          dispute_id: p.dispute_id,
          completeness_score: p.completeness_score,
          blockers: p.blockers,
          submission_readiness: p.submission_readiness,
          pack_json: p.pack_json,
        },
        settings: {
          auto_save_enabled: s.auto_save_enabled ?? false,
          auto_save_min_score: s.auto_save_min_score,
          enforce_no_blockers: s.enforce_no_blockers ?? true,
        },
        completeness: effective,
        automationMode: "auto",
        evidenceDueAt: d.due_at,
        reviewRequiredCount: 0,
      });
      const canonicalFiles = decision.action === "auto_file";

      const key = `legacy=${legacyFiles ? "FILE" : "no"} → canonical=${canonicalFiles ? "FILE" : "no"}`;
      if (!matrix.has(key)) matrix.set(key, []);
      matrix
        .get(key)!
        .push(
          `${p.dispute_id!.slice(0, 8)} guard=${verdict.decision}${
            verdict.decision !== "proceed" ? `/${verdict.reason}` : ""
          } canonical=${decision.action}[${decision.reasonCodes.join(",")}]`,
        );
    }

    console.log("\n── ACTIVATION-OFF FILING DIVERGENCE (buildDefencePackageJob) ──");
    for (const [k, v] of [...matrix].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(v.length).padStart(4)}  ${k}`);
    }
    const regressions = matrix.get("legacy=no → canonical=FILE") ?? [];
    const tightened = matrix.get("legacy=FILE → canonical=no") ?? [];
    console.log(`\n  NEW filings the legacy ladder would NOT have made: ${regressions.length}`);
    for (const r of regressions) console.log(`      ${r}`);
    console.log(`  filings the legacy ladder WOULD have made, now withheld: ${tightened.length}`);
    for (const t of tightened.slice(0, 20)) console.log(`      ${t}`);
    if (tightened.length > 20) console.log(`      … ${tightened.length - 20} more`);
  });
});
