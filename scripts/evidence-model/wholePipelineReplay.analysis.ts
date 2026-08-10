/**
 * PR 2 — the whole-pipeline replay, re-run against the POST-PR-1 production
 * state. READ-ONLY. Plan §9.2 / §9.4.
 *
 * ── WHAT IT COMPARES ──────────────────────────────────────────────────
 *
 * Two arms over the same live rows:
 *
 *   LEGACY   what production decides today (develop@72b81561, switch off) —
 *            `resolveEffectiveCompleteness` → `evaluateAutoSaveGate` +
 *            `evaluateAutoSubmitGuards`, exactly as `pipeline.legacy.ts`
 *            reads them, `?? 0` / `?? undefined` / `?? []` preserved.
 *   CANONICAL what PR 3 would decide — `decideForPack` with the same effective
 *            completeness pair, then `selectFileablePackage` on both triggers.
 *
 * ── WHAT IS HELD CONSTANT, AND WHY ────────────────────────────────────
 *
 * `automationMode` is pinned to `"auto"` in BOTH arms. It is a shared input,
 * not a divergence: a case whose rules resolve to `review` parks identically on
 * either route, and re-deriving it here would need the rules engine, the
 * templates and a client — three more moving parts between the two numbers
 * being compared. Pinning it makes the gate run on every case, which is the
 * strictly larger population, so nothing is hidden by the choice.
 *
 * `evidenceDueAt` is the real `disputes.due_at`. It is an input to the
 * canonical decision (never a relative window) and cannot be pinned.
 *
 * ── POPULATION ────────────────────────────────────────────────────────
 *
 * `disputes.final_outcome IS NULL`. NEVER `evidence_packs.status` — a pack that
 * clears the gate is immediately moved to `saved_to_shopify`, so `status='ready'`
 * is the complement of "packs that cleared the gate", and running the harness
 * that way once reported zero eligible packs on both shops and concluded the
 * threshold decided nothing (§9.4).
 *
 * ── THE §9.3 PRECONDITION ─────────────────────────────────────────────
 *
 * The pre-activation rebuild may not change what the still-live legacy path
 * reads or files. Checked directly: the legacy arm is computed twice, once over
 * `pack_json` as stored and once with the canonical keys STRIPPED
 * (`case_assessment`, `case_assessment_gates`). Any case whose legacy
 * disposition differs between the two is a case the rebuild would move.
 *
 * The expected non-empty answer is the P-7 activated set, where reading
 * `case_assessment` is the activation and shipped in PR 1. Any OTHER case
 * blocks the rebuild.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/wholePipelineReplay.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { evaluateAutoSaveGate } from "@/lib/automation/autoSaveGate";
import { evaluateAutoSubmitGuards } from "@/lib/automation/autoSubmitGuards";
import { resolveEffectiveCompleteness } from "@/lib/evidence/model/completenessActivation";
import { decideForPack } from "@/lib/automation/decision";
import {
  selectFileablePackage,
  type SelectableCandidate,
} from "@/lib/defence/package/selectFileablePackage";
import { assessmentSnapshotUsability } from "@/lib/evidence/model/assessmentSnapshot";
import type {
  CaseAssessmentSnapshot,
  CaseArgumentPlanSnapshot,
} from "@/lib/pipeline/contracts";

/* ── credentials ─────────────────────────────────────────────────────── */

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

/**
 * Paged REST read.
 *
 * PostgREST truncates an un-ranged select at 1000 rows, silently. Every read
 * here pages explicitly for that reason.
 */
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

/* ── row shapes ──────────────────────────────────────────────────────── */

interface DisputeRow {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | null;
  due_at: string | null;
  final_outcome: string | null;
}
interface PackRow {
  id: string;
  shop_id: string;
  dispute_id: string | null;
  completeness_score: number | null;
  blockers: unknown;
  submission_readiness: unknown;
  status: string | null;
  pack_json: Record<string, unknown> | null;
  rebuild_pending: boolean | null;
  created_at: string;
}
interface PackageRow {
  id: string;
  dispute_id: string | null;
  version: number | null;
  status: string | null;
  validation_status: string | null;
  superseded_by_id: string | null;
  facts_json: unknown;
  narrative_json: unknown;
  plan_json: unknown;
  plan_input_hash: string | null;
  policy_version: number | null;
  artifact_id: string | null;
}
interface ShopRow {
  id: string;
  shop_domain: string | null;
}
interface SettingsRow {
  shop_id: string;
  auto_save_enabled: boolean | null;
  auto_save_min_score: number | null;
  enforce_no_blockers: boolean | null;
}

/* ── dispositions ────────────────────────────────────────────────────── */

type Disposition = "auto_file" | "hold_for_deadline" | "park_for_review" | "block";

/**
 * The legacy disposition, reproduced from `pipeline.legacy.ts`'s own order:
 * the auto-submit guards first (coverage / fatal-loss / strength), then the
 * auto-save gate over the effective completeness pair.
 *
 * The three faithful coercions are preserved deliberately — `?? 0` on the
 * score, `?? undefined` on readiness (which drops the gate onto the legacy
 * blocker-count arm, R1), `?? []` on blockers. Fixing them here would make the
 * baseline something production does not do.
 */
function legacyDisposition(
  pack: PackRow,
  settings: SettingsRow,
  shopDomain: string | null,
  packJson: Record<string, unknown> | null,
): {
  disposition: Disposition;
  score: number;
  threshold: number;
  source: string;
  /** The guard/gate reason the legacy path recorded, for classification. */
  reason: string;
} {
  const effective = resolveEffectiveCompleteness({
    shopDomain,
    packJson,
    rebuildPending: pack.rebuild_pending,
    persistedScore: pack.completeness_score,
    merchantThreshold: settings.auto_save_min_score ?? 60,
  });

  const pj = (packJson ?? {}) as Record<string, any>;
  const guards = evaluateAutoSubmitGuards({
    coverageState: pj.coverage?.state ?? null,
    fatalLoss: pj.fatal_loss ?? null,
    caseStrength: pj.case_strength?.overall ?? null,
    creditAlreadyIssued: pj.credit_already_issued ?? null,
  });

  /* `park` and `block` are kept APART.
   *
   * An earlier draft collapsed both to `park_for_review` on the grounds that
   * neither files anything. It produced one spurious UNEXPLAINED transition —
   * a fatal-loss case the legacy guards BLOCK and the decision also blocks,
   * reported as `park_for_review → block` because only the label had moved.
   * Collapsing distinct verdicts manufactures transitions; the matrix is here
   * to find real ones. */
  if (guards.decision !== "proceed") {
    return {
      disposition: guards.decision === "block" ? "block" : "park_for_review",
      score: effective.score,
      threshold: effective.threshold,
      source: effective.source,
      reason: `guard:${guards.reason}`,
    };
  }

  const gate = evaluateAutoSaveGate({
    autoSaveEnabled: settings.auto_save_enabled ?? false,
    autoSaveMinScore: effective.threshold,
    enforceNoBlockers: settings.enforce_no_blockers ?? true,
    completenessScore: effective.score,
    blockers: (pack.blockers as string[]) ?? [],
    submissionReadiness: (pack.submission_readiness as never) ?? undefined,
  });

  return {
    disposition: gate.action === "auto_save" ? "auto_file" : "block",
    score: effective.score,
    threshold: effective.threshold,
    source: effective.source,
    reason: gate.action === "auto_save" ? "gate:pass" : `gate:${gate.reasons.join("|")}`,
  };
}

function canonicalDisposition(
  pack: PackRow,
  settings: SettingsRow,
  shopDomain: string | null,
  dueAt: string | null,
): { disposition: Disposition; reasonCodes: readonly string[]; score: number; threshold: number } {
  const effective = resolveEffectiveCompleteness({
    shopDomain,
    packJson: pack.pack_json,
    rebuildPending: pack.rebuild_pending,
    persistedScore: pack.completeness_score,
    merchantThreshold: settings.auto_save_min_score ?? 60,
  });

  const decision = decideForPack({
    caseId: pack.dispute_id ?? pack.id,
    pack: {
      id: pack.id,
      dispute_id: pack.dispute_id,
      completeness_score: pack.completeness_score,
      blockers: pack.blockers,
      submission_readiness: pack.submission_readiness,
      pack_json: pack.pack_json,
    },
    settings: {
      auto_save_enabled: settings.auto_save_enabled ?? false,
      auto_save_min_score: settings.auto_save_min_score,
      enforce_no_blockers: settings.enforce_no_blockers ?? true,
    },
    completeness: effective,
    automationMode: "auto",
    evidenceDueAt: dueAt,
  });

  const map: Record<string, Disposition> = {
    auto_file: "auto_file",
    hold_for_deadline: "hold_for_deadline",
    park_for_review: "park_for_review",
    block: "block",
  };
  return {
    disposition: map[decision.action] ?? "block",
    reasonCodes: decision.reasonCodes,
    score: effective.score,
    threshold: effective.threshold,
  };
}

/* ── drift classification (§9.4) ─────────────────────────────────────── */

type DriftCategory =
  | "persisted_score_not_reproducible_by_current_engine"
  | "persisted_strength_stale_vs_recompute"
  | "legacy_no_strength"
  | "hash_churn_r4"
  | "revision_2_strength_never_hard_blocks_rung6"
  | "revision_2_moderate_holds_rung9"
  | "UNEXPLAINED";

/**
 * `revision_2_strength_never_hard_blocks` is a FIFTH category, declared here
 * before the run rather than discovered after it.
 *
 * §9.4's four categories were written against the P-slice comparisons, where
 * both arms shared the guard ladder. This replay compares the ladder to the
 * decision, and contract revision 2 deliberately changed one disposition:
 * weak/insufficient strength no longer hard-blocks, it holds for the deadline.
 * Every such transition is an intended consequence of a decision the plan
 * records, so classifying them as UNEXPLAINED would bury the transitions that
 * genuinely are.
 */
/**
 * A transition is classified only if it MATCHES a declared category. The
 * fall-through is UNEXPLAINED, deliberately — an earlier draft fell through to
 * `persisted_strength_stale_vs_recompute`, which drove UNEXPLAINED to zero by
 * relabelling 72 cases nobody had looked at. §9.4's rule is that anything
 * outside the declared set BLOCKS until explained, and a catch-all is how that
 * rule gets satisfied without being followed.
 */
function classify(
  legacy: Disposition,
  legacyReason: string,
  canonical: Disposition,
  packJson: Record<string, any> | null,
  reasonCodes: readonly string[],
): DriftCategory {
  const strength = packJson?.case_strength?.overall ?? null;

  /* CONTRACT REVISION 2, in its two rungs. Both are the same change — the
   * legacy guards refuse a thin case outright; the decision holds it for the
   * clock instead, and the deadline path files it. They are counted separately
   * because they are different rungs with different reason codes, and a reader
   * checking the count against `deriveCaseAutomationDecision` needs to be able
   * to find each one.
   *
   * The legacy reason is required to be a STRENGTH guard. Matching on the
   * canonical action alone would absorb any other transition that happens to
   * land on `hold_for_deadline`, which is how a category stops being evidence. */
  if (canonical === "hold_for_deadline" && legacyReason.startsWith("guard:")) {
    // Rung 6 — deriveCaseAutomationDecision.ts:262
    if (strength === "weak" || strength === "insufficient") {
      return "revision_2_strength_never_hard_blocks_rung6";
    }
    // Rung 9 — deriveCaseAutomationDecision.ts:289, "MODERATE HOLDS"
    if (strength === "moderate" && reasonCodes.includes("eligible")) {
      return "revision_2_moderate_holds_rung9";
    }
  }
  if (strength === null) return "legacy_no_strength";
  if (reasonCodes.some((c) => c.includes("stale"))) return "hash_churn_r4";
  if (
    (legacy === "auto_file" && canonical === "block") ||
    (legacy === "block" && canonical === "auto_file")
  ) {
    return "persisted_score_not_reproducible_by_current_engine";
  }
  return "UNEXPLAINED";
}

/* ── the replay ──────────────────────────────────────────────────────── */

describe("whole-pipeline replay — post-PR-1 production state", () => {
  it("classifies every legacy → canonical transition", async () => {
    const disputes = await rest<DisputeRow>(
      "disputes?final_outcome=is.null&select=id,shop_id,reason,status,amount,due_at,final_outcome",
    );
    const openIds = new Set(disputes.map((d) => d.id));
    console.log(`\nPOPULATION  open disputes (final_outcome IS NULL): ${disputes.length}`);

    const packs = (
      await rest<PackRow>(
        "evidence_packs?select=id,shop_id,dispute_id,completeness_score,blockers,submission_readiness,status,pack_json,rebuild_pending,created_at&order=created_at.desc",
      )
    ).filter((p) => p.dispute_id && openIds.has(p.dispute_id));

    // Newest pack per dispute — the row the pipeline would be evaluating.
    const latestPack = new Map<string, PackRow>();
    for (const p of packs) if (!latestPack.has(p.dispute_id!)) latestPack.set(p.dispute_id!, p);

    const shops = await rest<ShopRow>("shops?select=id,shop_domain");
    const domainOf = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const settingsRows = await rest<SettingsRow>(
      "shop_settings?select=shop_id,auto_save_enabled,auto_save_min_score,enforce_no_blockers",
    );
    const settingsOf = new Map(settingsRows.map((s) => [s.shop_id, s]));
    const disputeOf = new Map(disputes.map((d) => [d.id, d]));

    console.log(`ELIGIBLE    open disputes carrying a pack: ${latestPack.size}`);

    const matrix = new Map<string, number>();
    const drift = new Map<DriftCategory, string[]>();
    const rebuildMoves: string[] = [];
    const byShop = new Map<string, { legacy: Map<string, number>; canonical: Map<string, number> }>();
    let withCanonicalAssessment = 0;
    let usableCanonicalAssessment = 0;

    for (const [disputeId, pack] of latestPack) {
      const settings = settingsOf.get(pack.shop_id);
      if (!settings) continue;
      const domain = domainOf.get(pack.shop_id) ?? null;
      const dispute = disputeOf.get(disputeId)!;

      const assessment = (pack.pack_json as Record<string, unknown> | null)?.case_assessment;
      if (assessment) {
        withCanonicalAssessment += 1;
        if (
          assessmentSnapshotUsability({ snapshot: assessment, rebuildPending: pack.rebuild_pending })
            .usable
        ) {
          usableCanonicalAssessment += 1;
        }
      }

      const legacy = legacyDisposition(pack, settings, domain, pack.pack_json);
      const canonical = canonicalDisposition(pack, settings, domain, dispute.due_at);

      const key = `${legacy.disposition} → ${canonical.disposition}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);

      const shopKey = domain ?? pack.shop_id;
      if (!byShop.has(shopKey)) byShop.set(shopKey, { legacy: new Map(), canonical: new Map() });
      const s = byShop.get(shopKey)!;
      s.legacy.set(legacy.disposition, (s.legacy.get(legacy.disposition) ?? 0) + 1);
      s.canonical.set(canonical.disposition, (s.canonical.get(canonical.disposition) ?? 0) + 1);

      if (legacy.disposition !== canonical.disposition) {
        const cat = classify(
          legacy.disposition,
          legacy.reason,
          canonical.disposition,
          pack.pack_json as never,
          canonical.reasonCodes,
        );
        if (!drift.has(cat)) drift.set(cat, []);
        drift
          .get(cat)!
          .push(
            `${disputeId.slice(0, 8)} ${shopKey} ${legacy.disposition}→${canonical.disposition} ` +
              `legacy=${legacy.reason} strength=${(pack.pack_json as any)?.case_strength?.overall ?? "null"} ` +
              `canonical=[${canonical.reasonCodes.join(",") || "-"}] ` +
              `score=${legacy.score}/${legacy.threshold} (${legacy.source})`,
          );
      }

      /* §9.3 — would the rebuild move what the LEGACY path reads? */
      const stripped = { ...(pack.pack_json ?? {}) } as Record<string, unknown>;
      delete stripped.case_assessment;
      delete stripped.case_assessment_gates;
      const legacyStripped = legacyDisposition(pack, settings, domain, stripped);
      if (legacyStripped.disposition !== legacy.disposition) {
        rebuildMoves.push(
          `${disputeId.slice(0, 8)} ${shopKey} ${legacyStripped.disposition}→${legacy.disposition} ` +
            `(${legacyStripped.score}/${legacyStripped.threshold} → ${legacy.score}/${legacy.threshold}, ${legacy.source})`,
        );
      }
    }

    console.log(
      `CANONICAL   packs carrying case_assessment: ${withCanonicalAssessment} ` +
        `(usable: ${usableCanonicalAssessment})`,
    );

    console.log("\n── TRANSITION MATRIX (legacy → canonical) ──");
    for (const [k, v] of [...matrix].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}${k.split(" → ")[0] === k.split(" → ")[1] ? "  (unchanged)" : ""}`);
    }

    console.log("\n── PER SHOP ──");
    for (const [shop, s] of byShop) {
      const fmt = (m: Map<string, number>) =>
        [...m].sort().map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`  ${shop}\n      legacy:    ${fmt(s.legacy)}\n      canonical: ${fmt(s.canonical)}`);
    }

    console.log("\n── DRIFT CLASSIFICATION ──");
    for (const cat of [
      "revision_2_strength_never_hard_blocks_rung6",
      "revision_2_moderate_holds_rung9",
      "persisted_score_not_reproducible_by_current_engine",
      "persisted_strength_stale_vs_recompute",
      "legacy_no_strength",
      "hash_churn_r4",
      "UNEXPLAINED",
    ] as DriftCategory[]) {
      const rows = drift.get(cat) ?? [];
      console.log(`  ${cat}: ${rows.length}`);
      for (const r of rows.slice(0, 12)) console.log(`      ${r}`);
      if (rows.length > 12) console.log(`      … ${rows.length - 12} more`);
    }

    console.log("\n── §9.3 PRECONDITION: does the rebuild move the LEGACY path? ──");
    console.log(`  cases whose legacy disposition depends on canonical pack_json keys: ${rebuildMoves.length}`);
    for (const r of rebuildMoves) console.log(`      ${r}`);
    if (rebuildMoves.length === 0) {
      console.log("  → the rebuild writes only fields the legacy path does not read.");
    }
  });

  it("runs the selector on both triggers for every open case with a package", async () => {
    const disputes = await rest<DisputeRow>("disputes?final_outcome=is.null&select=id,due_at");
    const openIds = new Set(disputes.map((d) => d.id));

    /* PROD CARRIES NO CANONICAL IDENTITY COLUMNS, and that is the point.
     *
     * `20260810120000_defence_package_canonical_identity.sql` is applied to DEV
     * only — PR 2 is dark and its migration has not been promoted. So
     * `plan_json`, `plan_input_hash`, `policy_version` and `artifact_id` do not
     * exist on prod, and selecting them 400s.
     *
     * Rather than skip the arm, they are read as ABSENT — which is exactly the
     * post-R4 legacy package shape §1A predicted, and exactly what every live
     * package will look like to the selector on the day the switch flips and
     * before the rebuild runs. The distribution below is therefore not a
     * degraded measurement; it is the measurement that matters most. */
    const packages = (
      await rest<PackageRow>(
        "defence_packages?select=id,dispute_id,version,status,validation_status,superseded_by_id,facts_json,narrative_json&order=version.desc",
      )
    )
      .map((p) => ({
        ...p,
        plan_json: null,
        plan_input_hash: null,
        policy_version: null,
        artifact_id: null,
      }))
      .filter((p) => p.dispute_id && openIds.has(p.dispute_id));

    const byCase = new Map<string, PackageRow[]>();
    for (const p of packages) {
      if (!byCase.has(p.dispute_id!)) byCase.set(p.dispute_id!, []);
      byCase.get(p.dispute_id!)!.push(p);
    }
    console.log(`\nOPEN CASES WITH A PACKAGE: ${byCase.size} (candidates: ${packages.length})`);

    const outcomes = { normal: new Map<string, number>(), deadline: new Map<string, number>() };

    for (const [caseId, rows] of byCase) {
      const candidates: SelectableCandidate[] = rows.map((r) => ({
        packageId: r.id,
        packageVersion: r.version ?? 0,
        artifactId: r.artifact_id,
        status: r.status ?? "",
        planInputHash: r.plan_input_hash,
        policyVersion: r.policy_version,
        validationPassed: r.validation_status === "ok",
        validationStatus: r.validation_status,
        supersededById: r.superseded_by_id,
        factsJson: r.facts_json,
        narrativeJson: r.narrative_json,
        planDeadlineOnly:
          (r.plan_json as { deadlineOnly?: boolean } | null)?.deadlineOnly === true,
      }));

      /* The plan and assessment as PERSISTED. Nothing is re-derived: a replay
       * that re-derived them would be measuring the derivation, not the
       * selection. Absent snapshots are the post-R4 legacy shape and are
       * EXPECTED to be non-fileable (§1A). */
      const plan = (rows[0]?.plan_json as CaseArgumentPlanSnapshot | null) ?? null;

      for (const trigger of ["normal", "deadline"] as const) {
        const selection = selectFileablePackage({
          caseId,
          trigger,
          candidates,
          assessment: null as CaseAssessmentSnapshot | null,
          plan,
          decision: null,
          current: {
            assessmentInputHash: "current",
            planInputHash: "current",
            decisionInputHash: "current",
            policyVersion: 1,
          },
        });
        const key =
          selection.outcome === "none"
            ? `none:${selection.reason}${selection.staleness ? `/${selection.staleness}` : ""}`
            : "selected";
        outcomes[trigger].set(key, (outcomes[trigger].get(key) ?? 0) + 1);
      }
    }

    for (const trigger of ["normal", "deadline"] as const) {
      console.log(`\n── SELECTOR (${trigger}) ──`);
      for (const [k, v] of [...outcomes[trigger]].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(v).padStart(4)}  ${k}`);
      }
    }
  });
});
