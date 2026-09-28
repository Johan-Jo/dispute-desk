/**
 * Not-as-described plan — D4 / PR 5 measurement (docs/plans/not-as-described-defence-package.plan.md).
 *
 * READ-ONLY. Never writes a pack, a job or a dispute. Output is a report only.
 *
 * QUESTION. If a collected, item-linked product listing counted as an Axis-1
 * ("it matched what they bought") signal instead of `supportingOnly`, how many
 * PRODUCT_UNACCEPTABLE packs change strength tier — and in which direction?
 *
 * METHOD. Every pack gets an AVAILABLE `product_description` checklist row
 * (what the PR 3 collector would add; 0 of 308 carry one today). It is scored
 * twice by the real `calculateCaseStrength`:
 *   baseline     — the registry as shipped (listing supportingOnly → no effect)
 *   hypothetical — the listing's spec swapped IN MEMORY to a moderate signal
 *                  with signalId `communication`, which is an Axis-1 member
 *                  (`PRODUCT_AXIS1_MATCH`, caseStrength.ts:719). A moderate
 *                  signal can never add to `strongCount`, and an Axis-1 member
 *                  already present dedupes by signalId, so for `overall` this
 *                  proxy is exact: it answers "has Axis 1" and nothing else.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/productListingAxis1.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { buildCaseGateAssessment, gateProvided, type CaseGateAssessment } from "@/lib/argument/caseGateAssessment";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";

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
  if (!url || !key) throw new Error(`Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ${ENV_FILE}.`);
  const page = 500;
  const out: T[] = [];
  for (let offset = 0; ; offset += page) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + page - 1}` },
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
  created_at: string;
  checklist_v2: unknown;
  pack_json: Record<string, unknown> | null;
}
interface DisputeRow {
  id: string;
  reason: string | null;
  order_name: string | null;
  final_outcome: string | null;
  closed_at: string | null;
  phase: string | null;
}

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

/** Same `list` payload source as buildPack (see strengthTransition.analysis.ts). */
function payloadSourceFrom(packJson: Record<string, unknown> | null) {
  const sections = (packJson?.sections as { fieldsProvided?: string[]; data?: Record<string, unknown> }[]) ?? [];
  return {
    kind: "list" as const,
    items: sections.map((s) => ({ payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } })),
  };
}

type Row = { field: string; status: string; [k: string]: unknown };

function withListing(checklist: Row[]): Row[] {
  const rest = checklist.filter((r) => r.field !== "product_description");
  return [
    ...rest,
    { field: "product_description", label: "Product listing", source: "auto_shopify", status: "available", blocking: false, priority: "critical" },
  ];
}

describe("D4 — product listing as Axis-1 (prod, read-only)", () => {
  it("reports tier transitions for every PRODUCT_UNACCEPTABLE pack", async () => {
    const disputes = await rest<DisputeRow>(
      "disputes?select=id,reason,order_name,final_outcome,closed_at,phase&reason=eq.PRODUCT_UNACCEPTABLE",
    );
    const byId = new Map(disputes.map((d) => [d.id, d]));
    const allPacks = await rest<PackRow>(
      "evidence_packs?select=id,dispute_id,created_at,checklist_v2,pack_json&order=created_at.desc",
    );
    // Newest pack per dispute.
    const latest = new Map<string, PackRow>();
    for (const p of allPacks) if (byId.has(p.dispute_id) && !latest.has(p.dispute_id)) latest.set(p.dispute_id, p);

    const original = { ...CANONICAL_EVIDENCE.product_description };
    const hypothetical = {
      ...original,
      signalId: "communication",
      category: "moderate",
      supportingOnly: false,
      excludedFromStrength: false,
    } as typeof original;

    const matrix = new Map<string, number>();
    const byOutcome = new Map<string, number>();
    let scored = 0;
    let noChecklist = 0;
    let sanityBaselineMoved = 0;

    for (const pack of latest.values()) {
      const d = byId.get(pack.dispute_id)!;
      const cl = pack.checklist_v2 as Row[] | null;
      if (!cl?.length) {
        noChecklist++;
        continue;
      }
      scored++;
      const gates = gatesFrom(pack.pack_json);
      const payloadSource = payloadSourceFrom(pack.pack_json);
      const sections = (pack.pack_json?.sections as { fieldsProvided?: string[] }[]) ?? [];
      const collected = new Set(sections.flatMap((s) => s.fieldsProvided ?? []));
      collected.add("product_description");

      const today = calculateCaseStrength(
        reconcileChecklistWithCollectedFields(cl as never, new Set(sections.flatMap((s) => s.fieldsProvided ?? []))),
        d.reason,
        payloadSource,
        gates,
      ).overall;

      const checklist = reconcileChecklistWithCollectedFields(withListing(cl) as never, collected);
      CANONICAL_EVIDENCE.product_description = original;
      const baseline = calculateCaseStrength(checklist, d.reason, payloadSource, gates).overall;
      CANONICAL_EVIDENCE.product_description = hypothetical;
      const hypo = calculateCaseStrength(checklist, d.reason, payloadSource, gates).overall;
      CANONICAL_EVIDENCE.product_description = original;

      if (baseline !== today) sanityBaselineMoved++;
      const state = d.final_outcome == null && d.closed_at == null ? "open" : "decided";
      const key = `${state.padEnd(7)} ${baseline} → ${hypo}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
      if (state === "decided") {
        const k2 = `${baseline} → ${hypo}  outcome=${d.final_outcome ?? "closed"}`;
        byOutcome.set(k2, (byOutcome.get(k2) ?? 0) + 1);
      }
    }

    console.log(`\n=== D4: listing as Axis-1 — ${disputes.length} PRODUCT_UNACCEPTABLE disputes, ${scored} scored, ${noChecklist} without checklist ===`);
    console.log(`sanity: adding a supportingOnly listing moved the baseline tier on ${sanityBaselineMoved} packs (expected 0)\n`);
    console.log("state   baseline → hypothetical        count");
    for (const [k, n] of [...matrix].sort()) console.log(`  ${k.padEnd(34)} ${n}`);
    console.log("\ndecided cases by outcome:");
    for (const [k, n] of [...byOutcome].sort()) console.log(`  ${k.padEnd(44)} ${n}`);
    console.log("");
  });
});
