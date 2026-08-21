/**
 * P2b evidence: the strength transition matrix.
 *
 * READ-ONLY. Never writes a pack, never stamps a disposition, never enqueues a
 * job, never touches `submission_state`. Output is a report artefact only.
 * (Plan Verification §3: shadow comparisons must not mutate.)
 *
 * WHAT IT COMPARES — three ways, per the plan's Verification §2, because a
 * persisted value is a record of a past computation, not an authority:
 *
 *   persisted  — `pack_json.case_strength.overall`, written at build time
 *   runtime    — `calculateCaseStrength` re-run NOW on the persisted
 *                `checklist_v2`, i.e. what production computes today on read
 *   model      — the same scorer fed from `CaseEvidenceModel` records
 *
 * `persisted` vs `runtime` disagreeing is itself a finding (stale snapshot or
 * drifted categorizer), and it must be separated from `runtime` vs `model`,
 * which is the change P2b actually proposes.
 *
 * Because `deriveCaseAssessment` calls the SAME scorer with the same gates,
 * every runtime→model difference is attributable to one cause: the model
 * carries records for fields the checklist never had a row for.
 *
 * Run:
 *   npm run analysis:evidence -- scripts/evidence-model/strengthTransition.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import {
  buildCaseGateAssessment,
  gateProvided,
  type CaseGateAssessment,
} from "@/lib/argument/caseGateAssessment";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { deriveCaseAssessment } from "@/lib/evidence/model/assessment";

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
    /* fall through to process.env */
  }
  return vars;
}

const env = loadEnv(ENV_FILE);
const get = (k: string) => (env[k] && env[k] !== "" ? env[k] : process.env[k]);

async function rest<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? get("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(
    /\/$/,
    "",
  );
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      `Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ${ENV_FILE}. ` +
        `Prod credentials live in .env.production.local, NOT .env.local.`,
    );
  }
  // PostgREST caps un-ranged selects at 1000 rows — paginate explicitly.
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
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

interface PackRow {
  id: string;
  dispute_id: string;
  status: string;
  checklist_v2: unknown;
  pack_json: Record<string, unknown> | null;
}
interface DisputeRow {
  id: string;
  reason: string | null;
  order_name: string | null;
  final_outcome: string | null;
}

/** Gates exactly as `buildPack` passed them, read back from `pack_json`. */
function gatesFrom(packJson: Record<string, unknown> | null): CaseGateAssessment {
  const j = (packJson ?? {}) as Record<string, never>;
  return buildCaseGateAssessment({
    coverage: gateProvided((j.coverage as never) ?? null),
    fatalLoss: gateProvided((j.fatal_loss as never) ?? null),
    returnedToSender: gateProvided((j.returned_to_sender as never) ?? null),
    riskWeakness: gateProvided((j.risk_weakness as never) ?? null),
    nameMismatch: gateProvided((j.name_mismatch as never) ?? null),
    creditAlreadyIssued: gateProvided((j.credit_already_issued as never) ?? null),
  });
}

/**
 * The payload source EXACTLY as `buildPack.ts:778-785` builds it: the `list`
 * form over every section, each item carrying its own `fieldsProvided`.
 *
 * Do not "simplify" this to a by-field map. `avs_cvv_match` is emitted by two
 * sections (`paymentSource.ts:93` and `:130`); a first-match map hands the
 * categorizer the wrong one, rates a real AVS match `invalid`, and makes the
 * matrix report a fleet-wide staleness that does not exist.
 */
function payloadSourceFrom(packJson: Record<string, unknown> | null) {
  const sections =
    (packJson?.sections as { fieldsProvided?: string[]; data?: Record<string, unknown> }[]) ??
    [];
  return {
    kind: "list" as const,
    items: sections.map((s) => ({
      payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided },
    })),
  };
}

describe("P2b — strength transition matrix (prod, read-only)", () => {
  it("reports persisted vs runtime vs model for every open pack", async () => {
    const disputes = await rest<DisputeRow>(
      "disputes?select=id,reason,order_name,final_outcome&final_outcome=is.null",
    );
    const byId = new Map(disputes.map((d) => [d.id, d]));
    const packs = (
      await rest<PackRow>(
        "evidence_packs?select=id,dispute_id,status,checklist_v2,pack_json&status=eq.ready",
      )
    ).filter((p) => byId.has(p.dispute_id));

    const transitions = new Map<string, number>();
    const staleSnapshots: string[] = [];
    const modelChanges: { order: string; from: string; to: string; reason: string }[] = [];

    for (const pack of packs) {
      const dispute = byId.get(pack.dispute_id)!;
      const gates = gatesFrom(pack.pack_json);
      const payloadSource = payloadSourceFrom(pack.pack_json);
      const sections =
        (pack.pack_json?.sections as {
          source?: string;
          fieldsProvided?: string[];
          data?: Record<string, unknown>;
        }[]) ?? [];

      const persisted =
        ((pack.pack_json?.case_strength as { overall?: string } | undefined)?.overall) ??
        "(none)";

      const collected = new Set(sections.flatMap((s) => s.fieldsProvided ?? []));
      const checklist = reconcileChecklistWithCollectedFields(
        pack.checklist_v2 as never,
        collected,
      );
      const runtime = calculateCaseStrength(
        checklist,
        dispute.reason,
        payloadSource,
        gates,
      ).overall;

      const { model } = deriveCaseEvidenceModel({
        disputeId: dispute.id,
        reason: dispute.reason,
        packId: pack.id,
        sections,
      });
      // One policy, not two. This script used to score the pack under both
      // candidate readings of `not_applicable` so the choice could be made on
      // numbers; that choice was made — P-1, strict, approved 2026-08-06 —
      // and the permissive arm now measures a behaviour the product cannot
      // produce. Keeping it would report differences no deployment can cause.
      const modelStrength = deriveCaseAssessment({
        model,
        gates,
        payloadSource,
      }).strength.overall;

      const key = `${persisted} → ${runtime} → ${modelStrength}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
      if (persisted !== runtime) staleSnapshots.push(dispute.order_name ?? dispute.id);
      if (runtime !== modelStrength) {
        modelChanges.push({
          order: dispute.order_name ?? dispute.id,
          from: runtime,
          to: modelStrength,
          reason: dispute.reason ?? "(null)",
        });
      }
    }

    console.log(`\n=== P2b strength transition matrix — ${packs.length} open ready packs ===\n`);
    console.log("persisted → runtime → model            count");
    for (const [k, n] of [...transitions].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(36)} ${n}`);
    }

    console.log(
      `\n-- persisted vs runtime (STALE SNAPSHOTS, a finding in its own right) --`,
    );
    console.log(`   ${staleSnapshots.length} of ${packs.length}`);
    for (const o of staleSnapshots.slice(0, 25)) console.log(`   ${o}`);
    if (staleSnapshots.length > 25) console.log(`   … and ${staleSnapshots.length - 25} more`);

    console.log(`\n-- runtime vs model (WHAT P2b PROPOSES TO CHANGE) --`);
    console.log(`   ${modelChanges.length} of ${packs.length}`);
    const byTransition = new Map<string, number>();
    for (const c of modelChanges) {
      const k = `${c.from} → ${c.to}`;
      byTransition.set(k, (byTransition.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byTransition].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${k.padEnd(28)} ${n}`);
    }
    for (const c of modelChanges.slice(0, 40)) {
      console.log(`   ${(c.order ?? "").padEnd(10)} ${c.reason.padEnd(24)} ${c.from} → ${c.to}`);
    }
    if (modelChanges.length > 40) {
      console.log(`   … and ${modelChanges.length - 40} more`);
    }
    console.log("");
  });
});
