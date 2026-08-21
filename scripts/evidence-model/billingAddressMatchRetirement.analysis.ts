/**
 * PR-C4 (C-14) calibration — what retiring `billing_address_match` does to
 * production scoring, completeness, citation and claim authority.
 *
 * READ-ONLY. Never writes a pack, never stamps a disposition, never enqueues a
 * job, never touches `submission_state`. Output is a report artefact only.
 *
 *   npm run analysis:evidence -- scripts/evidence-model/billingAddressMatchRetirement.analysis.ts
 *
 * WHY THIS IS A COMMITTED FILE. Deletion criterion 2 of the C-14 proposal
 * requires that "prod read-only measurement enumerates every strength,
 * completeness and citation delta, and confirms no case ends up weaker purely
 * because a genuinely AVS-verified address is not yet represented on the new
 * fact". A number quoted from a scratchpad script cannot be re-derived by a
 * reviewer; this is the same harness `verifiedAddressContainment.analysis.ts`
 * established for PR-C1, in the repository, runnable with prod read credentials.
 *
 * TWO POPULATIONS, DELIBERATELY NOT CONFLATED. The SQL census counts PERSISTED
 * `checklist_v2` rows. This harness counts the rows the pre-C-14 reconcile
 * actually SCORED, which is a different set, because the reconcile flips and
 * appends before completeness ever sees the checklist. Measured here:
 * **97** persisted `available` + **19** appended at read time by the
 * append rule (`optional` priority, for packs that collect the field but were
 * built before it had a template row) = **116** effectively-available rows;
 * plus **15** persisted `missing` rows on packs that never collected it. 97 and
 * 116 are both correct answers to different questions, and quoting one for the
 * other is how the first revision of this PR mislabelled its AVS table.
 *
 * ADAPTER DISCIPLINE. It does not re-implement the categorizer, the scorer or
 * the completeness engine. Both arms call the SAME shipped functions
 * (`calculateCaseStrength`, `deriveCompletenessMetrics`,
 * `reconcileChecklistWithCollectedFields`); the only difference is the one
 * rule C-14 removes, expressed as an INPUT adaptation:
 *
 *   - "AFTER" is the persisted inputs straight through the shipped reconcile,
 *     which now drops the retired row.
 *   - "BEFORE" is the same call with the retired row RE-ATTACHED exactly as
 *     the pre-C-14 reconcile would have left it: a persisted row survives, a
 *     `missing` row flips to `available` when the field was collected, and a
 *     collected field with no row is appended as `optional`.
 *
 * WHAT IS RE-RUNNABLE AFTER THE MERGE, AND WHAT IS NOT. The reconstruction
 * keeps most of this file re-runnable, but NOT all of it, and the difference
 * must not be papered over.
 *
 * Re-runnable — these outputs are identical before and after the merge,
 * confirmed by running the harness on both sides (2026-08-09T11:36Z on the
 * unmodified code, 2026-08-09T12:33Z after):
 *
 *   - the grade census, including its "pre-C-14 rule" arm: `data.match === true`
 *     is read straight off the payload, not through the deleted registry entry;
 *   - the completeness delta distribution and the readiness transitions —
 *     `deriveCompletenessMetrics` reads priority and status only, never a
 *     registry spec;
 *   - the BEFORE-row provenance decomposition;
 *   - the claim-capability probe;
 *   - the case-strength transition histogram (with the caveat below).
 *
 * NOT re-runnable — captured on the unmodified code at 2026-08-09T11:36Z and
 * quoted from that run wherever it appears:
 *
 *   - the **96-pack `coveragePercent` delta**. `calculateCaseStrength` counts a
 *     checklist row only when its field has a `CANONICAL_EVIDENCE` spec, so once
 *     the spec is deleted the re-attached BEFORE row is invisible to the scorer
 *     and the counter reads 0. The consequence runs deeper than one number: the
 *     post-merge BEFORE arm no longer models the retired row's contribution to
 *     the coverage denominator at all. "0 case-strength changes" was therefore
 *     ESTABLISHED pre-implementation, against the real registry, and only
 *     re-confirmed afterwards under a weaker reconstruction.
 *   - the `bankEligibleToday` counter, which is now 0 because
 *     `isFieldBankEligible` short-circuits on retired fields — true by
 *     construction rather than by measurement. The durable evidence for the
 *     zero citation delta is the SQL census (0 `defence_evidence_facts` rows in
 *     category `billing_match`, 0 packages whose `facts_json` embeds one),
 *     which reads persisted data and is re-runnable indefinitely.
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE. `criticalCategories` on
 * `visa_10_4_fraud` still names `billing_match`, and this PR leaves it there —
 * the category has had no member on prod (0 facts) and has none after, so
 * `derivePackageMode` behaves identically. Restating that reason module is a
 * separate decision with its own approval.
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
import {
  collectedFieldsFromPack,
  reconcileChecklistWithCollectedFields,
} from "@/lib/packs/checklistReconcile";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/automation/completeness";
import { isFieldBankEligible } from "@/lib/defence/factClassifier";
import { deriveClaimCapabilities } from "@/lib/defence/claimCapabilities";
import { readPaymentVerification } from "@/lib/argument/paymentVerification";
import type { EvidenceFact } from "@/lib/defence/types";

const RETIRED_FIELD = "billing_address_match";
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

/** The `list` payload source EXACTLY as `buildPack` builds it. */
function payloadSourceFrom(sections: Section[]) {
  return {
    kind: "list" as const,
    items: sections.map((s) => ({
      payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided },
    })),
  };
}

/** AFTER: the field is gone from the collected set. Section DATA is untouched —
 *  `pack_json` is never rewritten, and the order payload keeps carrying the
 *  redacted billing/shipping addresses the operational note reads. */
function withoutRetiredField(sections: Section[]): Section[] {
  return sections.map((s) =>
    (s.fieldsProvided ?? []).includes(RETIRED_FIELD)
      ? { ...s, fieldsProvided: (s.fieldsProvided ?? []).filter((f) => f !== RETIRED_FIELD) }
      : s,
  );
}

/**
 * BEFORE: the reconciled checklist with the retired row re-attached exactly as
 * the pre-C-14 reconcile left it. Three cases, matching the three branches of
 * `reconcileChecklistWithCollectedFields` that the retirement now short-cuts:
 * a persisted row survives as-is; a persisted `missing` row flips to
 * `available` when the field was collected; a collected field with no row is
 * appended as `optional`/`available`.
 */
function withRetiredRow(
  reconciled: ChecklistItemV2[],
  persisted: unknown,
  collected: boolean,
): ChecklistItemV2[] {
  const rows = Array.isArray(persisted)
    ? (persisted as ChecklistItemV2[])
    : ((persisted as { items?: ChecklistItemV2[] } | null)?.items ?? []);
  const row = rows.find((c) => c?.field === RETIRED_FIELD);
  if (row) {
    const restored =
      row.status === "missing" && collected
        ? { ...row, status: "available" as const, unavailableReason: undefined }
        : row;
    return [...reconciled, restored];
  }
  if (!collected) return reconciled;
  return [
    ...reconciled,
    {
      field: RETIRED_FIELD,
      label: "",
      status: "available",
      priority: "optional",
      blocking: false,
      source: "auto_shopify",
    } as ChecklistItemV2,
  ];
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

describe("PR-C4 — billing_address_match retirement calibration (prod, read-only)", () => {
  it("enumerates the strength, completeness, citation and claim-authority delta", async () => {
    // EVERY pack, open or closed, in any status. Scoping to `ready` would let
    // the reported delta shrink as packs are archived, which is not a property
    // of the change being measured.
    const disputes = await rest<DisputeRow>(
      "disputes?select=id,reason,order_name,final_outcome",
    );
    const byId = new Map(disputes.map((d) => [d.id, d]));
    const allPacks = (
      await rest<PackRow>("evidence_packs?select=id,dispute_id,status,checklist_v2,pack_json")
    ).filter((p) => byId.has(p.dispute_id));

    // The population C-14 can possibly touch: a pack that collects the field,
    // or holds a persisted checklist row for it. Everything else is provably
    // unaffected and is reported as such.
    const touched = allPacks.filter((p) => {
      const sections = (p.pack_json?.sections as Section[]) ?? [];
      const collects = sections.some((s) => (s.fieldsProvided ?? []).includes(RETIRED_FIELD));
      const raw = p.checklist_v2;
      const rows = Array.isArray(raw)
        ? raw
        : ((raw as { items?: unknown[] } | null)?.items ?? []);
      const hasRow = (rows as { field?: string }[]).some((c) => c?.field === RETIRED_FIELD);
      return collects || hasRow;
    });

    const gradeCensus: Record<string, number> = {};
    let matchKeyPresent = 0;
    let bankEligibleToday = 0;

    const strengthTransitions: Record<string, number> = {};
    const strengthChanged: Array<{
      order: string;
      status: string;
      reason: string | null;
      from: string;
      to: string;
    }> = [];
    let strongLost = 0;

    const completenessTransitions: Record<string, number> = {};
    const completenessChanged: Array<{
      order: string;
      status: string;
      reason: string | null;
      rowStatus: string;
      before: number;
      after: number;
      readinessBefore: string;
      readinessAfter: string;
      avs: string;
    }> = [];
    const readinessTransitions: Record<string, number> = {};
    let coverageChanged = 0;

    /** Deletion criterion 2, second half: for every pack whose pre-C-14
     *  checklist held an EFFECTIVELY AVAILABLE billing row, how is address
     *  verification represented on the canonical C-12/C-13 AVS fact? */
    const avsRepresentation: Record<string, number> = {};
    /**
     * Where that "effectively available" row came from. The SQL census counts
     * PERSISTED rows; the pre-C-14 reconcile then flipped and appended, so the
     * two populations are not the same number and must not be quoted as if
     * they were.
     */
    const rowOrigin: Record<string, number> = {};

    const capabilityDelta: Record<string, number> = {};

    for (const pack of touched) {
      const dispute = byId.get(pack.dispute_id)!;
      const gates = gatesFrom(pack.pack_json);
      const sectionsBefore = (pack.pack_json?.sections as Section[]) ?? [];
      const sectionsAfter = withoutRetiredField(sectionsBefore);

      // ── 1. Grade census. The pre-C-14 grader was `match === true → strong,
      // else invalid`; the shipped one has no branch at all. Both are reported
      // so the "collected N, valid 0" claim is checked against the data rather
      // than inherited from the proposal.
      let collectsRetired = false;
      for (const s of sectionsBefore) {
        if (!(s.fieldsProvided ?? []).includes(RETIRED_FIELD)) continue;
        collectsRetired = true;
        const data = s.data ?? {};
        bump(gradeCensus, data.match === true ? "strong (pre-C-14 rule)" : "invalid");
        bump(gradeCensus, `shipped: ${categorizeEvidenceField(RETIRED_FIELD, data)}`);
        if ("match" in data) matchKeyPresent += 1;
        if (isFieldBankEligible(RETIRED_FIELD, data)) bankEligibleToday += 1;
      }

      // ── 2. Checklist, through the ONE reconcile both pipelines pass.
      const checklistAfter = reconcileChecklistWithCollectedFields(
        pack.checklist_v2 as never,
        collectedFieldsFromPack({ sections: sectionsAfter }),
      ) as ChecklistItemV2[];
      const checklistBefore = withRetiredRow(
        checklistAfter,
        pack.checklist_v2,
        collectsRetired,
      );

      const row = checklistBefore.find((c) => c.field === RETIRED_FIELD);
      const rowStatus = row ? `${row.status}/${row.priority}` : "(no row)";

      // Provenance of the BEFORE row, so the persisted-vs-effective difference
      // is a measured number rather than an inference.
      const persistedRows = Array.isArray(pack.checklist_v2)
        ? (pack.checklist_v2 as { field?: string; status?: string }[])
        : ((pack.checklist_v2 as { items?: { field?: string; status?: string }[] } | null)
            ?.items ?? []);
      const persisted = persistedRows.find((c) => c?.field === RETIRED_FIELD);
      bump(
        rowOrigin,
        persisted
          ? collectsRetired
            ? `persisted ${persisted.status} + collected -> ${row?.status}`
            : `persisted ${persisted.status}, NOT collected -> ${row?.status}`
          : collectsRetired
            ? "no persisted row, collected -> appended optional/available"
            : "no row, not collected",
      );

      // ── 3. Case strength.
      const sBefore = calculateCaseStrength(
        checklistBefore,
        dispute.reason,
        payloadSourceFrom(sectionsBefore),
        gates,
      );
      const sAfter = calculateCaseStrength(
        checklistAfter,
        dispute.reason,
        payloadSourceFrom(sectionsAfter),
        gates,
      );
      bump(strengthTransitions, `${sBefore.overall} -> ${sAfter.overall}`);
      if (sBefore.overall !== sAfter.overall) {
        strengthChanged.push({
          order: dispute.order_name ?? dispute.id,
          status: pack.status,
          reason: dispute.reason,
          from: sBefore.overall,
          to: sAfter.overall,
        });
        if (sBefore.overall === "strong" && sAfter.overall !== "strong") strongLost += 1;
      }
      // NOT REPRODUCIBLE AFTER THE MERGE, and deliberately left visible rather
      // than deleted. `calculateCaseStrength` counts a checklist row only when
      // the field has a `CANONICAL_EVIDENCE` spec, so once the spec is gone the
      // re-attached BEFORE row stops counting and this reads 0. The
      // pre-implementation run (2026-08-09T11:36Z, on the unmodified code)
      // measured **96 packs whose coveragePercent moved and 0 whose strength
      // band changed** — the whole point being that the retired row was padding
      // a coverage denominator with a field that graded `invalid` anyway.
      if (sBefore.coveragePercent !== sAfter.coveragePercent) coverageChanged += 1;

      // ── 4. Completeness.
      const cBefore = deriveCompletenessMetrics(checklistBefore);
      const cAfter = deriveCompletenessMetrics(checklistAfter);
      const delta = cAfter.completenessScore - cBefore.completenessScore;
      bump(
        completenessTransitions,
        delta === 0 ? "unchanged" : delta > 0 ? `+${delta}` : String(delta),
      );
      bump(
        readinessTransitions,
        `${cBefore.submissionReadiness} -> ${cAfter.submissionReadiness}`,
      );

      // ── 5. AVS representation on the same pack (criterion 2, second half).
      const avsSection = sectionsBefore.find((s) =>
        (s.fieldsProvided ?? []).includes("avs_cvv_match"),
      );
      let avs = "no AVS fact on this pack";
      if (avsSection) {
        const v = readPaymentVerification(avsSection.data ?? {});
        avs = v.citableAddressVerified
          ? `AVS citable address match (${v.network}/${v.avs.code})`
          : v.addressVerified
            ? `AVS address match, not citable (${v.network}/${v.avs.code})`
            : v.avs.unmapped
              ? `AVS unmapped code (${v.network}/${v.avs.code})`
              : `AVS ${v.avs.normalized} (${v.network}/${v.avs.code ?? "absent"})`;
      }
      if (row?.status === "available") bump(avsRepresentation, avs);

      if (delta !== 0 || cBefore.submissionReadiness !== cAfter.submissionReadiness) {
        completenessChanged.push({
          order: dispute.order_name ?? dispute.id,
          status: pack.status,
          reason: dispute.reason,
          rowStatus,
          before: cBefore.completenessScore,
          after: cAfter.completenessScore,
          readinessBefore: cBefore.submissionReadiness,
          readinessAfter: cAfter.submissionReadiness,
          avs,
        });
      }

      // ── 6. Claim authority (deletion criterion 3). A billing fact built the
      // way the classifier would have built it, offered to the capability
      // deriver: nothing may be granted by it.
      const billingFact: EvidenceFact = {
        id: "probe",
        category: "billing_match",
        label: "Billing address match",
        value: { match: true, fieldKey: RETIRED_FIELD },
        source: "shopify_order",
        sourceRef: null,
        strength: "strong",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      };
      const caps = deriveClaimCapabilities([billingFact]);
      bump(capabilityDelta, caps.size === 0 ? "no capability granted" : [...caps].join("+"));
    }

    const untouched = allPacks.length - touched.length;

    console.log("\n=== PR-C4 calibration ===");
    console.log("ranAt", new Date().toISOString());
    console.log("packs total", allPacks.length, "| touched by the retirement", touched.length,
      "| provably unaffected", untouched);
    console.log("billing_address_match grade census (shipped grader)", JSON.stringify(gradeCensus));
    console.log("sections carrying a `match` key at all", matchKeyPresent);
    console.log("bank-eligible today (citation / LLM value)", bankEligibleToday);
    console.log("case-strength transitions", JSON.stringify(strengthTransitions));
    console.log("case-strength changes", strengthChanged.length,
      JSON.stringify(strengthChanged, null, 1));
    console.log("strong -> not-strong crossings", strongLost);
    console.log(
      "coveragePercent changes",
      coverageChanged,
      "(reads 0 post-merge by construction — see the comment at the call site;",
      "the pre-implementation run measured 96, with 0 strength-band crossings)",
    );
    console.log("completeness score delta distribution", JSON.stringify(completenessTransitions));
    console.log("submission-readiness transitions", JSON.stringify(readinessTransitions));
    console.log("completeness/readiness changes", completenessChanged.length);
    console.log(JSON.stringify(completenessChanged, null, 1));
    console.log("BEFORE-row provenance (persisted vs effective)",
      JSON.stringify(rowOrigin, null, 1));
    console.log(
      "AVS representation on packs whose pre-C-14 row was EFFECTIVELY available",
      JSON.stringify(avsRepresentation, null, 1),
    );
    console.log(
      "  sum of the AVS buckets",
      Object.values(avsRepresentation).reduce((a, b) => a + b, 0),
    );
    console.log("claim capabilities granted by a billing_match fact",
      JSON.stringify(capabilityDelta));
  }, 300_000);
});
