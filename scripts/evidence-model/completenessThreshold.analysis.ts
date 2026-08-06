/**
 * Slice 2 / PR 2.0 — read-only completeness calibration against production.
 *
 * READ-ONLY. Every request is a PostgREST GET. No writes, no enqueues, no
 * disposition stamps, no threshold changes, no feature flags. A CI test
 * (`tests/unit/completenessCalibration.test.ts`) scans this file for write
 * verbs and fails the build if one appears, so the prohibition survives edits
 * by someone who has not read this comment.
 *
 * WHAT THIS REPLACES. The previous version of this file reported three scores
 * per pack and counted threshold crossings in both directions. That was enough
 * to know the fleet moved; it was not enough to DECIDE P-7, because it could
 * not say WHY any individual pack moved, could not tell a corrected defect
 * from a policy change, and counted crossings on packs that never reach the
 * completeness gate at all. It also read a shop's threshold with
 * `setting?.auto_save_min_score ?? 0` — a fallback that silently clears every
 * pack, so a shop whose settings row failed to load would have been reported
 * as a clean fleet.
 *
 * WHAT THIS ADDS.
 *   - the candidate contract as four named, individually ablatable rules
 *     (`calibration/completenessCalibration.ts`), so each transition is
 *     attributed to a rule rather than to "the new semantics";
 *   - the eligible population — packs that can actually reach
 *     `evaluateAutoSaveGate`, which in `pipeline.ts` means auto rule mode AND
 *     `evaluateAutoSubmitGuards` returning `proceed` (Strong, or a
 *     fully-covering prior credit, or a legacy pack with no recorded strength);
 *   - a self-check: the harness must reproduce today's gate outcome from the
 *     model before it may attribute a change away from it. Where it cannot,
 *     the pack is an `unresolved_blocker` and not a classified transition;
 *   - candidate thresholds with the operational trade-off at every real
 *     decision boundary.
 *
 * ADVISORY ONLY. P-7 stays deferred; this harness recommends and does not
 * decide, and nothing here deploys a threshold.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/completenessThreshold.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import {
  deriveCompletenessMetrics,
  evaluateCompletenessV2,
  type OrderContext,
} from "@/lib/automation/completeness";
import {
  collectedFieldsFromPack,
  normalizeChecklistV2Shape,
  reconcileChecklistWithCollectedFields,
} from "@/lib/packs/checklistReconcile";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { pickAutomationAction } from "@/lib/rules/pickAutomationAction";
import type { Rule } from "@/lib/rules/types";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";
import {
  CANDIDATE_SEMANTICS,
  CURRENT_SEMANTICS,
  classifyTransition,
  completenessGateEligibility,
  completenessUnderSemantics,
  dispositionPreservingThreshold,
  divergentFlags,
  gateOutcome,
  resolveShopGateSettings,
  structurallyUnusableFields,
  thresholdTradeOffs,
  withFlag,
  type BlockerReason,
  type GateOutcome,
  type SemanticFlag,
  type ShopGateSettings,
  type TransitionClass,
  type TransitionInput,
} from "./calibration/completenessCalibration";

/* ── environment ──────────────────────────────────────────────────────── */

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
    /* fall through — `rest` throws a clear error below */
  }
  return vars;
}

const env = loadEnv(ENV_FILE);
const get = (k: string) => (env[k] && env[k] !== "" ? env[k] : process.env[k]);

/** GET only. The `Range` header paginates; nothing here sends a body. */
async function rest<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? get("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`Need prod credentials in ${ENV_FILE}`);
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
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/* ── row shapes ───────────────────────────────────────────────────────── */

interface PackRow {
  id: string;
  shop_id: string;
  dispute_id: string;
  status: string | null;
  completeness_score: number | null;
  checklist_v2: unknown;
  waived_items: unknown;
  pack_json: Record<string, unknown> | null;
}
interface DisputeRow {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | null;
  phase: string | null;
  order_name: string | null;
}
interface SettingsRow {
  shop_id: string;
  auto_save_enabled: boolean | null;
  auto_save_min_score: number | null;
  enforce_no_blockers: boolean | null;
}
interface ShopRow { id: string; shop_domain: string }
interface RuleRow extends Rule { shop_id: string }

interface PackSection {
  source?: string;
  fieldsProvided?: string[];
  data?: Record<string, unknown>;
}

/* ── per-pack calibration record ──────────────────────────────────────── */

interface PackCalibration {
  shop: string;
  /** Order name — the minimum identifier a maintainer needs to audit a row. */
  order: string;
  packStatus: string | null;
  reason: string | null;
  threshold: number | null;
  autoSaveEnabled: boolean;
  eligible: boolean;
  ineligibleReason: string | null;
  eligibilityPath: string | null;
  caseStrength: string | null;
  ruleMode: "auto" | "review";
  persisted: number | null;
  current: number | null;
  reconstructed: number | null;
  candidate: number | null;
  singleFlagScores: Partial<Record<SemanticFlag, number>>;
  currentOutcome: GateOutcome | null;
  candidateOutcome: GateOutcome | null;
  classification: TransitionClass;
  causes: SemanticFlag[];
  blockerReason: BlockerReason | null;
  /** Fields the candidate stopped counting because their records are `invalid`. */
  unusableFields: string[];
  /** Fields dropped by P-1 that the reconcile append admits today. */
  notApplicableCollected: string[];
  excludedUnavailable: string[];
  satisfiedByWaiver: string[];
}

const DIVERGENT = divergentFlags(CURRENT_SEMANTICS, CANDIDATE_SEMANTICS);

describe("Slice 2 / PR 2.0 — completeness calibration (prod, read-only)", () => {
  it("produces the per-shop calibration report", async () => {
    const queriedAt = new Date().toISOString();

    const [disputes, packs, settings, shops, rules] = await Promise.all([
      rest<DisputeRow>(
        "disputes?select=id,shop_id,reason,status,amount,phase,order_name&final_outcome=is.null",
      ),
      // EVERY pack on an open dispute — deliberately NOT `status=eq.ready`.
      //
      // A pack that PASSES the auto-save gate is immediately moved to
      // `saved_to_shopify`, so `status=ready` is precisely the complement of
      // "packs that cleared the gate". The first run of this harness filtered
      // on `ready` and reported ZERO eligible packs across both shops, which
      // read as "the threshold decides nothing" — when in fact it had already
      // decided, and the winners had left the population. Calibrating a gate
      // on the set of cases the gate rejected is a selection bias that inverts
      // the answer.
      rest<PackRow>(
        "evidence_packs?select=id,shop_id,dispute_id,status,completeness_score,checklist_v2,waived_items,pack_json",
      ),
      rest<SettingsRow>(
        "shop_settings?select=shop_id,auto_save_enabled,auto_save_min_score,enforce_no_blockers",
      ),
      rest<ShopRow>("shops?select=id,shop_domain"),
      rest<RuleRow>("rules?select=*&enabled=is.true"),
    ]);

    const byDispute = new Map(disputes.map((d) => [d.id, d]));
    const settingsByShop = new Map(settings.map((s) => [s.shop_id, s]));
    const domainByShop = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const rulesByShop = new Map<string, RuleRow[]>();
    for (const r of rules) {
      const list = rulesByShop.get(r.shop_id) ?? [];
      list.push(r);
      rulesByShop.set(r.shop_id, list);
    }

    // "Open" = the dispute has no final outcome. A closed dispute's pack can
    // no longer be auto-filed, so including it would inflate every count with
    // decisions that can never be taken again.
    const open = packs.filter((p) => byDispute.has(p.dispute_id));

    const rows: PackCalibration[] = [];
    const pending: TransitionInput[] = [];
    /** field → how often it was collected, and how often it graded `valid`. */
    const fleetFieldStats = new Map<string, { collected: number; valid: number }>();

    for (const pack of open) {
      const dispute = byDispute.get(pack.dispute_id)!;
      const shop = domainByShop.get(pack.shop_id) ?? pack.shop_id;
      const order = dispute.order_name ?? pack.dispute_id.slice(0, 8);
      const missingInputs: BlockerReason[] = [];

      // ── shop settings. NEVER defaulted; see resolveShopGateSettings. ──
      const gateSettings: ShopGateSettings | null = resolveShopGateSettings(
        settingsByShop.get(pack.shop_id),
      );
      if (!gateSettings) missingInputs.push("missing_shop_settings");

      const sections = (pack.pack_json?.sections as PackSection[] | undefined) ?? [];
      if (sections.length === 0) missingInputs.push("missing_pack_sections");

      const persistedChecklist = normalizeChecklistV2Shape(pack.checklist_v2);
      if (persistedChecklist === null) missingInputs.push("unparseable_checklist");

      // ── order context, reconstructed from the PERSISTED checklist ──
      //
      // A row the BUILD marked `unavailable` is exactly a field this order
      // cannot produce. Reading it back is faithful to what production
      // decided and avoids re-fetching every order from Shopify for a
      // read-only report. It is imperfect — a reason template with no row for
      // `delivery_proof` makes `isFulfilled` read false — but the SAME context
      // feeds both sides of every comparison, so the artifact cancels out of
      // the delta and cannot manufacture a transition.
      const checklistRows = persistedChecklist ?? [];
      const persistedFields = new Set(checklistRows.map((c) => c?.field));
      const unavailable = new Set(
        checklistRows.filter((c) => c?.status === "unavailable").map((c) => c.field),
      );
      const notCollectable = (f: string) =>
        unavailable.has(f) || !persistedFields.has(f);
      const orderContext: OrderContext = {
        isFulfilled: !notCollectable("delivery_proof"),
        hasCardPayment: !notCollectable("avs_cvv_match"),
        avsCvvAvailable: !notCollectable("avs_cvv_match"),
        hasShippingEvidence: !notCollectable("shipping_tracking"),
        hasRefund: !notCollectable("refund_record"),
      };

      const waivedItems = (Array.isArray(pack.waived_items)
        ? pack.waived_items
        : []) as WaivedItemRecord[];
      const collected = collectedFieldsFromPack({ sections });

      // ── TODAY's score, from the real engine, re-run now ──
      //
      // Re-run rather than read `evidence_packs.completeness_score`, because a
      // persisted score can predate a template change (`refund_record` joined
      // FRAUDULENT on 2026-08-01, `fraud_risk_screening` later still) and
      // comparing it to the candidate would measure template drift instead of
      // this slice. Staleness is reported separately, below.
      const currentEval = evaluateCompletenessV2(
        dispute.reason,
        collected,
        waivedItems,
        null,
        orderContext,
      );
      // Production reconciles on every read, so the comparable "today" number
      // includes the append. Without it the baseline would be the pre-#505
      // engine, which no surface still shows.
      const currentMetrics = deriveCompletenessMetrics(
        reconcileChecklistWithCollectedFields(currentEval.checklist, collected),
      );

      // ── the model, once. Every semantics variant reads the same model. ──
      const { model } = deriveCaseEvidenceModel({
        disputeId: dispute.id,
        reason: dispute.reason,
        packId: pack.id,
        sections,
        waivedItems,
        orderContext,
        coverage: (pack.pack_json?.coverage as { state?: string } | undefined) ?? null,
      });

      const reconstructed = completenessUnderSemantics(model, CURRENT_SEMANTICS);
      const candidate = completenessUnderSemantics(model, CANDIDATE_SEMANTICS);

      const outcomeFor = (score: number, readiness: typeof candidate.readiness, blockers: string[]) =>
        gateSettings
          ? gateOutcome({ score, settings: gateSettings, readiness, blockers })
          : null;

      const currentOutcome = outcomeFor(
        currentMetrics.completenessScore,
        currentMetrics.submissionReadiness,
        currentMetrics.blockers,
      );
      const reconstructedOutcome = outcomeFor(
        reconstructed.score,
        reconstructed.readiness,
        reconstructed.blockers,
      );
      const candidateOutcome = outcomeFor(
        candidate.score,
        candidate.readiness,
        candidate.blockers,
      );

      // ── single-flag ablation: which rule moved this pack? ──
      const singleFlagScores: Partial<Record<SemanticFlag, number>> = {};
      const singleFlagOutcomes: Partial<Record<SemanticFlag, GateOutcome>> = {};
      for (const flag of DIVERGENT) {
        const variant = completenessUnderSemantics(
          model,
          withFlag(CURRENT_SEMANTICS, flag, CANDIDATE_SEMANTICS),
        );
        singleFlagScores[flag] = variant.score;
        const o = outcomeFor(variant.score, variant.readiness, variant.blockers);
        if (o) singleFlagOutcomes[flag] = o;
      }

      // ── eligibility: can this pack reach the completeness gate at all? ──
      const phaseLower = (dispute.phase ?? "").toLowerCase();
      const ruleResult = pickAutomationAction(rulesByShop.get(pack.shop_id) ?? [], {
        id: dispute.id,
        shop_id: dispute.shop_id,
        reason: dispute.reason,
        status: dispute.status,
        amount: dispute.amount,
        phase:
          phaseLower === "inquiry" || phaseLower === "chargeback"
            ? (phaseLower as "inquiry" | "chargeback")
            : null,
      });
      const packJson = pack.pack_json as {
        case_strength?: { overall?: string };
        fatal_loss?: { triggered?: boolean; reason?: string | null; message?: string | null };
        coverage?: { state?: string };
        credit_already_issued?: { triggered?: boolean; coversDisputedAmount?: boolean };
      } | null;
      const caseStrength = packJson?.case_strength?.overall ?? null;
      const eligibility = completenessGateEligibility({
        ruleMode: ruleResult.action.mode,
        guards: {
          coverageState: packJson?.coverage?.state ?? null,
          fatalLoss: packJson?.fatal_loss ?? null,
          caseStrength,
          creditAlreadyIssued: packJson?.credit_already_issued ?? null,
        },
      });

      // ── explanatory detail, and the fleet-wide field census ──
      //
      // The census is the input to `structurallyUnusableFields`, which is why
      // classification happens in a SECOND pass: whether a pack's
      // usable-evidence attribution is trustworthy depends on how the field
      // behaves across the whole fleet, which is not knowable inside this loop.
      const unusableFields: string[] = [];
      const notApplicableCollected: string[] = [];
      for (const summary of Object.values(model.fields)) {
        if (summary.records.length === 0) continue;
        const stat = fleetFieldStats.get(summary.fieldKey) ?? { collected: 0, valid: 0 };
        stat.collected += 1;
        if (summary.status.available) stat.valid += 1;
        fleetFieldStats.set(summary.fieldKey, stat);

        if (summary.relevance === "not_applicable") {
          notApplicableCollected.push(summary.fieldKey);
        } else if (!summary.status.available) {
          unusableFields.push(summary.fieldKey);
        }
      }

      pending.push({
        currentOutcome,
        reconstructedOutcome,
        candidateOutcome,
        singleFlagOutcomes,
        missingInputs,
      });

      rows.push({
        shop,
        order,
        packStatus: pack.status,
        reason: dispute.reason,
        threshold: gateSettings?.autoSaveMinScore ?? null,
        autoSaveEnabled: gateSettings?.autoSaveEnabled ?? false,
        eligible: eligibility.eligible,
        ineligibleReason: eligibility.reason,
        eligibilityPath: eligibility.path,
        caseStrength,
        ruleMode: ruleResult.action.mode,
        persisted: pack.completeness_score,
        current: currentMetrics.completenessScore,
        reconstructed: reconstructed.score,
        candidate: candidate.score,
        singleFlagScores,
        currentOutcome,
        candidateOutcome,
        // Filled by the second pass, below.
        classification: "unresolved_blocker",
        causes: [],
        blockerReason: null,
        unusableFields,
        notApplicableCollected,
        excludedUnavailable: candidate.excludedUnavailable,
        satisfiedByWaiver: candidate.satisfiedByWaiver,
      });
    }

    /* ── pass 2: classify, now that the fleet census exists ───────────── */

    const structurallyUnusable = structurallyUnusableFields(fleetFieldStats);

    rows.forEach((row, i) => {
      const contaminated = row.unusableFields.some((f) =>
        structurallyUnusable.has(f),
      );
      const verdict = classifyTransition({
        ...pending[i],
        usableEvidenceAttributionContaminated: contaminated,
      });
      row.classification = verdict.classification;
      row.causes = verdict.causes;
      row.blockerReason = verdict.blockerReason;
    });

    /* ── report ─────────────────────────────────────────────────────── */

    const line = (s = "") => console.log(s);
    const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) : "0");

    line();
    line("═".repeat(78));
    line(`  SLICE 2 / PR 2.0 — COMPLETENESS CALIBRATION (read-only)`);
    line(`  queried: ${queriedAt}`);
    line(`  env file: ${ENV_FILE}`);
    line(
      `  population: ${rows.length} packs on open disputes (final_outcome IS NULL), ` +
        `across ${new Set(rows.map((r) => r.shop)).size} shops`,
    );
    line(`  divergent semantics flags: ${DIVERGENT.join(", ")}`);
    line("═".repeat(78));

    const byShop = new Map<string, PackCalibration[]>();
    for (const r of rows) {
      const list = byShop.get(r.shop) ?? [];
      list.push(r);
      byShop.set(r.shop, list);
    }
    const shopOrder = [...byShop].sort((a, b) => b[1].length - a[1].length);

    /* 1 ── population and eligibility */
    line();
    line("── 1. POPULATION AND ELIGIBLE POPULATION ─────────────────────────");
    line();
    line("   Packs per status (a pack that CLEARS the gate leaves `ready`, so");
    line("   filtering on `ready` would measure only the gate's rejects):");
    {
      const byStatus = new Map<string, number>();
      for (const r of rows) {
        const k = r.packStatus ?? "null";
        byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
      }
      for (const [k, v] of [...byStatus].sort((a, b) => b[1] - a[1])) {
        line(`     ${k.padEnd(30)} ${String(v).padStart(4)}`);
      }
      const perDispute = new Map<string, number>();
      for (const p of open) {
        perDispute.set(p.dispute_id, (perDispute.get(p.dispute_id) ?? 0) + 1);
      }
      const multi = [...perDispute.values()].filter((n) => n > 1).length;
      line(`     open disputes with a pack: ${perDispute.size}; of those with >1 pack: ${multi}`);
    }
    line();
    line("shop                        packs  thr  autoSave  eligible  ineligible-by-reason");
    for (const [shop, list] of shopOrder) {
      const eligible = list.filter((r) => r.eligible);
      const reasons = new Map<string, number>();
      for (const r of list) {
        if (r.eligible) continue;
        const k = r.ineligibleReason ?? "unknown";
        reasons.set(k, (reasons.get(k) ?? 0) + 1);
      }
      line(
        `${shop.padEnd(27)} ${String(list.length).padStart(5)}  ` +
          `${String(list[0].threshold ?? "n/a").padStart(3)}  ` +
          `${String(list[0].autoSaveEnabled).padEnd(8)}  ` +
          `${String(eligible.length).padStart(8)}  ` +
          `${[...reasons].map(([k, v]) => `${k}=${v}`).join(" ") || "—"}`,
      );
      const byPath = new Map<string, number>();
      for (const r of eligible) {
        const k = r.eligibilityPath ?? "unknown";
        byPath.set(k, (byPath.get(k) ?? 0) + 1);
      }
      line(
        `${" ".repeat(27)}        eligible by guard arm: ` +
          ([...byPath].map(([k, v]) => `${k}=${v}`).join(" ") || "—"),
      );
    }

    /* 2 ── score distributions */
    line();
    line("── 2. SCORE DISTRIBUTIONS (current engine vs candidate) ──────────");
    const bucket = (n: number) => Math.floor(n / 10) * 10;
    for (const [shop, list] of shopOrder) {
      for (const [label, pick] of [
        ["current  ", (r: PackCalibration) => r.current],
        ["candidate", (r: PackCalibration) => r.candidate],
      ] as const) {
        const hist = new Map<number, number>();
        for (const r of list) {
          const v = pick(r);
          if (v === null) continue;
          hist.set(bucket(v), (hist.get(bucket(v)) ?? 0) + 1);
        }
        const cells = [...hist]
          .sort((a, b) => a[0] - b[0])
          .map(([b, n]) => `${String(b).padStart(3)}s:${n}`)
          .join("  ");
        line(`${shop.padEnd(27)} ${label}  ${cells}`);
      }
      const withScores = list.filter((r) => r.current !== null && r.candidate !== null);
      const mean = (f: (r: PackCalibration) => number) =>
        (withScores.reduce((a, r) => a + f(r), 0) / (withScores.length || 1)).toFixed(1);
      line(
        `${shop.padEnd(27)} mean current=${mean((r) => r.current!)} ` +
          `candidate=${mean((r) => r.candidate!)} ` +
          `Δ=${mean((r) => r.candidate! - r.current!)}`,
      );
      line();
    }

    /* 3 ── readiness / gate outcomes at TODAY's threshold */
    line("── 3. GATE OUTCOMES AT EACH SHOP'S CURRENT THRESHOLD ─────────────");
    line();
    line("shop                        scope       old:auto old:block  new:auto new:block  crossings");
    for (const [shop, list] of shopOrder) {
      for (const [label, scope] of [
        ["all       ", list],
        ["eligible  ", list.filter((r) => r.eligible)],
      ] as const) {
        const oldAuto = scope.filter((r) => r.currentOutcome === "auto_save").length;
        const oldBlock = scope.filter((r) => r.currentOutcome === "block").length;
        const newAuto = scope.filter((r) => r.candidateOutcome === "auto_save").length;
        const newBlock = scope.filter((r) => r.candidateOutcome === "block").length;
        const crossings = scope.filter(
          (r) =>
            r.currentOutcome !== null &&
            r.candidateOutcome !== null &&
            r.currentOutcome !== r.candidateOutcome,
        ).length;
        line(
          `${shop.padEnd(27)} ${label}  ${String(oldAuto).padStart(8)} ${String(oldBlock).padStart(9)}  ` +
            `${String(newAuto).padStart(8)} ${String(newBlock).padStart(9)}  ${String(crossings).padStart(9)}`,
        );
      }
    }

    /* 4 ── transition classification */
    line();
    line("── 4. TRANSITION CLASSIFICATION (every pack, none unclassified) ──");
    line();
    const CLASSES: TransitionClass[] = [
      "current_wrong_corrected",
      "current_correct_preserved",
      "intended_policy_change_requires_approval",
      "unresolved_blocker",
    ];
    for (const [shop, list] of shopOrder) {
      line(`${shop}  (${list.length} packs)`);
      for (const cls of CLASSES) {
        const hits = list.filter((r) => r.classification === cls);
        line(`   ${cls.padEnd(42)} ${String(hits.length).padStart(4)}  (${pct(hits.length, list.length)}%)`);
      }
    }
    const classified = rows.filter((r) => CLASSES.includes(r.classification)).length;
    line();
    line(`   TOTAL classified: ${classified} / ${rows.length}  ` +
      `${classified === rows.length ? "— none unclassified" : "— UNCLASSIFIED ROWS PRESENT"}`);

    line();
    line("   Every pack whose classification is not `current_correct_preserved`:");
    for (const r of rows) {
      if (r.classification === "current_correct_preserved") continue;
      line(
        `     ${r.shop.split(".")[0].padEnd(12)} ${r.order.padEnd(10)} ${String(r.reason).padEnd(22)} ` +
          `cur=${r.current} cand=${r.candidate} thr=${r.threshold} ` +
          `${r.currentOutcome}→${r.candidateOutcome} eligible=${r.eligible} ` +
          `[${r.classification}] causes=${r.causes.join("+") || "—"}` +
          (r.blockerReason ? ` blocker=${r.blockerReason}` : ""),
      );
      if (r.unusableFields.length) {
        line(`        collected but not usable: ${r.unusableFields.join(", ")}`);
      }
      if (r.notApplicableCollected.length) {
        line(`        collected but not_applicable (P-1 drops): ${r.notApplicableCollected.join(", ")}`);
      }
      for (const flag of DIVERGENT) {
        line(`        ${flag} alone → ${r.singleFlagScores[flag]}`);
      }
    }

    const blockers = rows.filter((r) => r.classification === "unresolved_blocker");
    line();
    line(`   UNRESOLVED BLOCKERS: ${blockers.length}` +
      (blockers.length ? "  — these BLOCK completion of PR 2.0" : ""));
    for (const b of blockers) {
      line(
        `     ${b.shop.split(".")[0]} ${b.order} ${b.blockerReason}  ` +
          `eligible=${b.eligible} outcome ${b.currentOutcome}→${b.candidateOutcome}`,
      );
    }
    if (blockers.length) {
      line();
      line("   A blocker is reported even when the two outcomes happen to agree:");
      line("   the order context these packs were scored with was reconstructed");
      line("   from inputs that are absent, so an agreeing outcome is an accident");
      line("   of fabricated inputs and not evidence that nothing changes.");
    }

    /* 5 ── candidate thresholds */
    line();
    line("── 5. CANDIDATE THRESHOLDS AND THEIR OPERATIONAL TRADE-OFF ───────");
    for (const [shop, list] of shopOrder) {
      const eligible = list.filter(
        (r) => r.eligible && r.current !== null && r.candidate !== null && r.threshold !== null,
      );
      const current = list[0].threshold;
      line();
      line(`${shop}  current auto_save_min_score = ${current}  ` +
        `(eligible packs: ${eligible.length} of ${list.length})`);
      if (eligible.length === 0 || current === null) {
        line("   no eligible packs — the threshold decides nothing for this shop today");
        continue;
      }
      const points = eligible.map((r) => ({
        currentScore: r.current!,
        candidateScore: r.candidate!,
      }));
      const preserving = dispositionPreservingThreshold(points, current);
      line(
        preserving !== null
          ? `   disposition-preserving threshold: ${preserving} ` +
              `(highest value at which no eligible pack changes disposition)`
          : `   NO disposition-preserving threshold exists — the candidate semantics ` +
              `REORDER rather than rescale, so some disposition must change`,
      );
      line("   threshold   newly AUTO-FILES   newly BLOCKS   preserved");
      for (const t of thresholdTradeOffs(points, current)) {
        line(
          `   ${String(t.threshold).padStart(9)}   ${String(t.newlyAutoFiles).padStart(16)}   ` +
            `${String(t.newlyBlocks).padStart(12)}   ${String(t.preserved).padStart(9)}`,
        );
      }
    }

    /* 6 ── persisted-vs-runtime staleness (a separate finding) */
    line();
    line("── 6. PERSISTED vs RUNTIME (snapshot staleness, not this slice) ───");
    const stale = rows.filter((r) => r.persisted !== r.current);
    line(`   ${stale.length} of ${rows.length} packs carry a persisted completeness_score that`);
    line(`   the CURRENT engine no longer reproduces. The gate reads the PERSISTED`);
    line(`   value, so this is live drift independent of Slice 2.`);
    for (const s of stale.slice(0, 12)) {
      line(`     ${s.shop.split(".")[0].padEnd(12)} ${s.order.padEnd(10)} persisted=${s.persisted} runtime=${s.current}`);
    }
    if (stale.length > 12) line(`     … and ${stale.length - 12} more`);

    /* 7 ── field census + structural defects */
    line();
    line("── 7. FIELD CENSUS: collected vs graded `valid`, fleet-wide ──────");
    line();
    line("   A field collected many times and NEVER valid is a collector /");
    line("   categorizer contract defect, not weak evidence. Transitions that");
    line("   lean on one are reported as blockers, not as findings.");
    line();
    line("   field                          collected   valid   structural-defect");
    for (const [field, stat] of [...fleetFieldStats].sort(
      (a, b) => b[1].collected - a[1].collected,
    )) {
      line(
        `   ${field.padEnd(30)} ${String(stat.collected).padStart(9)} ${String(stat.valid).padStart(7)}   ` +
          `${structurallyUnusable.has(field) ? "YES" : ""}`,
      );
    }

    /* 8 ── inert-rule evidence */
    line();
    line("── 8. RULES MEASURED AS INERT ON THIS FLEET ──────────────────────");
    const anyWaived = rows.filter((r) => r.satisfiedByWaiver.length > 0);
    const anyUnavailable = rows.filter((r) => r.excludedUnavailable.length > 0);
    line(`   rows satisfied by waiver:            ${anyWaived.length} packs`);
    line(`   packs with ≥1 unavailable exclusion: ${anyUnavailable.length} packs`);
    line(`   (both rules already hold in production; they are carried as flags so`);
    line(`    the report can measure them rather than assert them)`);

    /* machine-readable artifact, for the report's appendix */
    const outPath = join(process.cwd(), "docs/evidence-model/p2/calibration-data.json");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify({ queriedAt, envFile: ENV_FILE, divergentFlags: DIVERGENT, rows }, null, 2),
    );
    line();
    line(`   machine-readable rows → ${outPath}`);
    line();
  });
});
