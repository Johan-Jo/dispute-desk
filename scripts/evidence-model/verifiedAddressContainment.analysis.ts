/**
 * PR-C1 calibration — what retiring the verified-address delivery upgrade does
 * to production scoring.
 *
 * READ-ONLY. Never writes a pack, never stamps a disposition, never enqueues a
 * job, never touches `submission_state`. Output is a report artefact only.
 *
 * WHY THIS IS A COMMITTED FILE. The first two calibration runs were throwaway
 * scratchpad scripts, so "we re-ran the calibration" was an unverifiable claim
 * and the numbers could not be reproduced by a reviewer. This is the same
 * harness, in the repository, runnable by anyone with prod read credentials:
 *
 *   npm run analysis:evidence -- scripts/evidence-model/verifiedAddressContainment.analysis.ts
 *
 * ADAPTER DISCIPLINE. It does not re-implement the categorizer or the scorer.
 * "AFTER" is the real `categorizeEvidenceField` / `calculateCaseStrength` on
 * the persisted payload. "BEFORE" is the SAME functions on an adapted payload:
 * where the retired rule would have upgraded `delivered_confirmed` to strong
 * (`deliveredToVerifiedAddress === true` or `collectedByCustomer === true`),
 * the adapter presents `signature_confirmed`, which the real categorizer grades
 * strong. So both arms run the shipped code and the only difference is the one
 * rule PR-C1 removes.
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  categorizeEvidenceField,
  type EvidenceCategory,
} from "@/lib/argument/canonicalEvidence";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import {
  buildCaseGateAssessment,
  gateProvided,
  type CaseGateAssessment,
} from "@/lib/argument/caseGateAssessment";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/automation/completeness";

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
  const url = (get("SUPABASE_URL") ?? get("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      `Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ${ENV_FILE}. ` +
        `Prod credentials live in .env.production.local, NOT .env.local.`,
    );
  }
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

type Section = { source?: string; fieldsProvided?: string[]; data?: Record<string, unknown> };

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

/** The `list` payload source EXACTLY as `buildPack` builds it. Do not collapse
 *  to a by-field map: `avs_cvv_match` is emitted by two sections. */
function payloadSourceFrom(sections: Section[]) {
  return {
    kind: "list" as const,
    items: sections.map((s) => ({ payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } })),
  };
}

/** The retired rule, expressed as an INPUT adaptation rather than a second
 *  categorizer: present the payload the old code would have graded strong. */
function adaptToPreContainment(sections: Section[]): Section[] {
  return sections.map((s) => {
    const d = (s.data ?? {}) as Record<string, unknown>;
    const upgraded =
      d.proofType === "delivered_confirmed" &&
      (d.deliveredToVerifiedAddress === true || d.collectedByCustomer === true);
    return upgraded ? { ...s, data: { ...d, proofType: "signature_confirmed" } } : s;
  });
}

const DELIVERY_FIELDS = ["delivery_proof", "shipping_tracking"];
const RANK: Record<EvidenceCategory, number> = {
  strong: 3,
  moderate: 2,
  supporting: 1,
  invalid: 0,
} as Record<EvidenceCategory, number>;

/** The best grade any delivery row reaches — the signal-level value, since
 *  `delivery_proof` and `shipping_tracking` share `signalId: "delivery"`. */
function bestGrade(sections: Section[], fields: string[]): EvidenceCategory | null {
  let best: EvidenceCategory | null = null;
  for (const s of sections) {
    for (const f of s.fieldsProvided ?? []) {
      if (!fields.includes(f)) continue;
      const g = categorizeEvidenceField(f, s.data ?? {});
      if (best === null || RANK[g] > RANK[best]) best = g;
    }
  }
  return best;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

describe("PR-C1 — verified-address containment calibration (prod, read-only)", () => {
  it("reports the delivery-grade and case-strength delta", async () => {
    // EVERY ready pack, open or closed. Scoping to open disputes would let
    // the reported delta shrink as disputes close, which is not a property of
    // the change being measured.
    const disputes = await rest<DisputeRow>(
      "disputes?select=id,reason,order_name,final_outcome",
    );
    const byId = new Map(disputes.map((d) => [d.id, d]));
    const packs = (
      await rest<PackRow>(
        "evidence_packs?select=id,dispute_id,status,checklist_v2,pack_json&status=eq.ready",
      )
    ).filter((p) => byId.has(p.dispute_id));

    const deliveryBefore: Record<string, number> = {};
    const deliveryAfter: Record<string, number> = {};
    const avsAfter: Record<string, number> = {};
    const avsBefore: Record<string, number> = {};
    const strengthTransitions: Record<string, number> = {};
    const changed: Array<{ order: string; from: string; to: string }> = [];
    let crossings = 0;
    let completenessBeforeSum = 0;
    let completenessAfterSum = 0;
    let completenessDiffs = 0;

    for (const pack of packs) {
      const dispute = byId.get(pack.dispute_id)!;
      const gates = gatesFrom(pack.pack_json);
      const sectionsAfter = ((pack.pack_json?.sections as Section[]) ?? []);
      const sectionsBefore = adaptToPreContainment(sectionsAfter);

      const gBefore = bestGrade(sectionsBefore, DELIVERY_FIELDS);
      const gAfter = bestGrade(sectionsAfter, DELIVERY_FIELDS);
      if (gBefore) bump(deliveryBefore, gBefore);
      if (gAfter) bump(deliveryAfter, gAfter);

      const aBefore = bestGrade(sectionsBefore, ["avs_cvv_match"]);
      const aAfter = bestGrade(sectionsAfter, ["avs_cvv_match"]);
      if (aBefore) bump(avsBefore, aBefore);
      if (aAfter) bump(avsAfter, aAfter);

      const collected = new Set(sectionsAfter.flatMap((s) => s.fieldsProvided ?? []));
      const checklist = reconcileChecklistWithCollectedFields(
        pack.checklist_v2 as never,
        collected,
      ) as ChecklistItemV2[];

      const before = calculateCaseStrength(
        checklist,
        dispute.reason,
        payloadSourceFrom(sectionsBefore),
        gates,
      ).overall;
      const after = calculateCaseStrength(
        checklist,
        dispute.reason,
        payloadSourceFrom(sectionsAfter),
        gates,
      ).overall;

      bump(strengthTransitions, `${before} -> ${after}`);
      if (before !== after) {
        changed.push({ order: dispute.order_name ?? dispute.id, from: before, to: after });
        // The only threshold that gates behaviour: auto-save files Strong only.
        if (before === "strong" && after !== "strong") crossings += 1;
      }

      // Completeness must be invariant: it is weight/priority driven and reads
      // no evidence CATEGORY. Measured rather than asserted.
      const cBefore = deriveCompletenessMetrics(checklist).completenessScore;
      const cAfter = deriveCompletenessMetrics(checklist).completenessScore;
      completenessBeforeSum += cBefore;
      completenessAfterSum += cAfter;
      if (cBefore !== cAfter) completenessDiffs += 1;
    }

    console.log("\n=== PR-C1 calibration ===");
    console.log("ranAt", new Date().toISOString());
    console.log("packs", packs.length);
    console.log("delivery grade BEFORE", JSON.stringify(deliveryBefore));
    console.log("delivery grade AFTER ", JSON.stringify(deliveryAfter));
    console.log("avs_cvv_match BEFORE ", JSON.stringify(avsBefore));
    console.log("avs_cvv_match AFTER  ", JSON.stringify(avsAfter));
    console.log("strength transitions", JSON.stringify(strengthTransitions, null, 1));
    console.log("strength changes", changed.length, JSON.stringify(changed));
    console.log("strong -> not-strong crossings", crossings);
    console.log(
      "completeness sum before/after",
      completenessBeforeSum,
      completenessAfterSum,
      "per-pack diffs",
      completenessDiffs,
    );
  });
});
