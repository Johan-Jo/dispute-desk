/**
 * /admin/defence-package/pipeline
 *
 * Read-only walk of every input, rule, and trigger that shapes a
 * defence-package LLM call. The admin section's source-of-truth view.
 *
 * Eight stages, mapping the in-codebase pipeline order:
 *   1. Trigger      — when enqueue fires + decision tree
 *   2. Classify     — system→LLM boundary (factClassifier)
 *   3. Block 1      — BASE_SYSTEM_PROMPT (hardcoded)
 *   4. Block 2      — reason-code module overlay (DB-overridable)
 *   5. Payload      — buildLlmFactPayload output, rendered from fixture
 *   6. LLM call     — model, params, caps
 *   7. Validators   — forbidden phrases + claim guards
 *   8. Render       — section order, omission rules, thesis library
 *
 * No mutation paths. Every panel reads either an exported in-process
 * constant or the existing admin-queries loaders.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import { ArrowLeft, Workflow } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listPromptModules } from "@/lib/defence/admin-queries";
import { BASE_SYSTEM_PROMPT, buildLlmFactPayload } from "@/lib/defence/narrativeWriter";
import {
  FORBIDDEN_PHRASES,
  NARROW_AGGRESSIVE_PHRASES,
} from "@/lib/defence/validateNarrative";
import { CLAIM_GUARDS } from "@/lib/defence/claimGuards";
import { FACT_PREDICATES } from "@/lib/defence/factPredicates";
import {
  SUBMISSION_RISK_FIELDS,
  INTERNAL_ONLY_FIELDS,
  categoryForField,
} from "@/lib/defence/factClassifier";
import { THESIS_TEMPLATES } from "@/lib/defence/pdf/thesisTemplates";
import { THESIS_TOKENS } from "@/lib/defence/pdf/thesisTokens";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { ALL_REASON_CODE_FAMILIES } from "@/lib/defence/reasonCodes/familyRegistry";
import { STRATEGIES_BY_FAMILY } from "@/lib/defence/strategies/registry";
import type { EvidenceFact, NarrativeInput } from "@/lib/defence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Field keys the fact classifier knows about. Kept in lock-step with
 *  the `categoryForField` switch — adding a case there should add a row
 *  here. */
const KNOWN_FIELD_KEYS = [
  "avs_cvv_match",
  "tds_authentication",
  "billing_address_match",
  "delivery_proof",
  "shipping_tracking",
  "ip_location_check",
  "device_session_consistency",
  "fraud_risk_screening",
  "customer_communication",
  "customer_account_info",
  "activity_log",
  "supporting_documents",
  "refund_policy",
  "shipping_policy",
  "cancellation_policy",
  "order_confirmation",
  "product_description",
  "duplicate_explanation",
];

interface SampleFixture {
  reasonCode: string;
  approvedFacts: EvidenceFact[];
  packageMode: "full" | "narrow";
  caseStrength: "strong" | "moderate" | "weak" | "insufficient";
}

async function loadSamplePayload(): Promise<{
  payload: Record<string, unknown> | null;
  error: string | null;
}> {
  try {
    const fixturePath = path.join(
      process.cwd(),
      "tests/fixtures/defence-package-sample.json",
    );
    const raw = await fs.readFile(fixturePath, "utf-8");
    const fixture = JSON.parse(raw) as SampleFixture;
    const reasonCodeModule = resolveReasonCodeModule(fixture.reasonCode);
    const input: NarrativeInput = {
      packageId: "pipeline-page-sample",
      disputeId: "pipeline-page-sample",
      reasonCode: fixture.reasonCode,
      reasonCodeModule,
      packageMode: fixture.packageMode,
      caseStrength: fixture.caseStrength,
      approvedFacts: fixture.approvedFacts,
      manualEvidence: [],
      internalOnlyFactIds: [],
      missingEvidence: [],
    };
    return { payload: buildLlmFactPayload(input), error: null };
  } catch (err) {
    return {
      payload: null,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

export default async function DefencePackagePipelinePage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const [modules, sample] = await Promise.all([
    listPromptModules(),
    loadSamplePayload(),
  ]);

  return (
    <div className="p-8 space-y-10 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/defence-package"
          className="text-[#64748B] hover:text-[#0F172A]"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Pipeline"
          subtitle="Every input, rule, and trigger that shapes a defence-package LLM call. Admin is the canonical view — nothing material lives outside this page."
          icon={Workflow}
        />
      </div>

      <nav className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4">
        <div className="text-xs text-[#64748B] mb-2">Pipeline stages</div>
        <ol className="flex flex-wrap gap-2 text-sm">
          {[
            ["#stage-1", "1. Trigger"],
            ["#stage-2", "2. Classify"],
            ["#stage-3", "3. Block 1"],
            ["#stage-4", "4. Block 2"],
            ["#stage-5", "5. Payload"],
            ["#stage-6", "6. LLM Call"],
            ["#stage-7", "7. Validators"],
            ["#stage-8", "8. Render"],
          ].map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                className="inline-block px-3 py-1 rounded border border-[#CBD5E1] bg-white hover:border-[#1D4ED8] hover:text-[#1D4ED8]"
              >
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ── Stage 1 — Trigger ────────────────────────────────── */}
      <section id="stage-1" className="space-y-4">
        <StageHeading
          number={1}
          title="Trigger"
          source="lib/defence/enqueue.ts:51 maybeEnqueueDefencePackage"
        />
        <p className="text-sm text-[#475569]">
          Decides whether to create a new draft <code>defence_packages</code>{" "}
          row and enqueue the <code>build_defence_package</code> job. Owns
          version-bumping, stale detection, and coverage-gated{" "}
          <code>skipped</code> insertion.
        </p>

        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">
                  Branch
                </th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">
                  Condition
                </th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["a", "Flag off", <span key="a">No-op. <code>ENABLE_DEFENCE_PACKAGE_BUILDER=false</code>.</span>],
                ["b", "Coverage = covered_shopify", "Insert status=skipped row, no enqueue (Shopify Protect is underwriting)."],
                ["c", "Latest draft, matching evidence_hash", "Idempotent — no-op."],
                ["d", "Latest draft, diverging hash", "Flip prior draft to stale, insert new draft at v+1, enqueue."],
                ["e", "Latest final / submitted", "Insert new draft at v+1. Prior row stays immutable; supersession flipped only when new draft reaches final."],
                ["f", "Latest superseded / failed / skipped", "Insert new draft at v+1."],
                ["g", "No prior row", "Insert draft at v=1."],
              ].map(([branch, cond, action]) => (
                <tr key={String(branch)} className="border-b border-[#F1F5F9] last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs text-[#1D4ED8]">({branch})</td>
                  <td className="px-4 py-2 text-[#0F172A]">{cond}</td>
                  <td className="px-4 py-2 text-[#475569]">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A] mt-4">Callsites</h3>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Callsite</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">When it fires</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 font-mono text-xs">lib/jobs/handlers/buildPackJob.ts</td>
                <td className="px-4 py-2 text-[#475569]">After a successful pack build (auto-build).</td>
              </tr>
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 font-mono text-xs">app/api/packs/[packId]/defence-package/route.ts</td>
                <td className="px-4 py-2 text-[#475569]">Merchant- or admin-initiated regenerate.</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-mono text-xs">app/api/cron/defence-package-deadline-submit/route.ts</td>
                <td className="px-4 py-2 text-[#475569]">Last-day auto-submit fallback (cron).</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[#64748B]">
          The same enqueue path handles initial generation (no prior row, v=1)
          and regeneration on new evidence (diverging hash → v+1). Both paths
          are visible in the run telemetry and the dispute&apos;s package
          version chain.
        </p>
      </section>

      {/* ── Stage 2 — Classify ───────────────────────────────── */}
      <section id="stage-2" className="space-y-4">
        <StageHeading
          number={2}
          title="Classify (system → LLM boundary)"
          source="lib/defence/factClassifier.ts"
        />
        <p className="text-sm text-[#475569]">
          Reads raw <code>pack_json.sections</code>, the canonical evidence
          registry, and case-level gate summaries; emits normalised{" "}
          <code>EvidenceFact[]</code>. Nothing downstream may consume raw
          Shopify JSON — this is the cut-off.
        </p>

        <h3 className="text-sm font-semibold text-[#0F172A]">Field → category map</h3>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Field key</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Fact category</th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_FIELD_KEYS.map((k) => (
                <tr key={k} className="border-b border-[#F1F5F9] last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A]">{k}</td>
                  <td className="px-4 py-2 text-[#475569]">{categoryForField(k, null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChipPanel
            title="SUBMISSION_RISK_FIELDS"
            note="Filtered from the LLM payload unless includeInBankNarrative=true (ops override)."
            items={[...SUBMISSION_RISK_FIELDS]}
          />
          <ChipPanel
            title="INTERNAL_ONLY_FIELDS"
            note="Their ids appear in the payload's internalOnlyFactIds; values are never sent to the model."
            items={[...INTERNAL_ONLY_FIELDS]}
          />
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-[#475569] space-y-2">
          <p className="font-semibold text-[#0F172A]">Bank-eligibility boundary</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Submission-risk fields may inform operator assessment but must not automatically become bank-facing claims.</li>
            <li>Internal-only fields must not appear in bank-facing narrative or PDF.</li>
            <li>Negative evidence (missing-evidence list, fatal-loss reasons) must stay merchant/admin-facing — never quoted in the package output.</li>
          </ul>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A]">
          Fact predicates (v2.1 — emitted as <code>predicateEvaluations</code>)
        </h3>
        <p className="text-xs text-[#64748B]">
          After classification, <code>evaluateAllPredicates()</code> runs every
          named predicate against the approved facts and the result lands on{" "}
          <code>FactClassificationResult.predicateEvaluations</code>. The same
          predicates back (a) claim guards in stage 7, (b) strategy gates in
          stage 4, and (c) thesis tokens in stage 8 — one source of truth for
          every &quot;does the evidence support X?&quot; check.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Predicate id</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Required fact / value</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(FACT_PREDICATES).map((p) => (
                <tr key={p.id} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">{p.id}</td>
                  <td className="px-4 py-2 text-[#475569]">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Stage 3 — Prompt Block 0 (BASE) + 4-block layout ─── */}
      <section id="stage-3" className="space-y-4">
        <StageHeading
          number={3}
          title="Prompt — Block 0 (base system prompt) + v2.1 4-block layout"
          source="lib/defence/narrativeWriter.ts:51 BASE_SYSTEM_PROMPT"
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Hardcoded.</strong> To change, edit{" "}
          <code>lib/defence/narrativeWriter.ts</code> and redeploy. No DB
          override path. This is the majority of the rule surface (~13
          numbered rules including the output JSON schema, fulfillment
          precision, narrow-mode hedging, CNP guards).
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-[#475569] space-y-2">
          <p className="font-semibold text-[#0F172A]">
            v2.1 cached-block layout (4 blocks max)
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              <strong>Block 0</strong> — <code>BASE_SYSTEM_PROMPT</code> (always
              emitted). Below ↓
            </li>
            <li>
              <strong>Block 1</strong> — family overlay (emitted only when
              non-empty; Phase 1 ships these empty so this block is currently
              skipped for every dispute). Stage 4.
            </li>
            <li>
              <strong>Block 2</strong> — module promptBody (always emitted;
              DB-overridable). Stage 4.
            </li>
            <li>
              <strong>Block 3</strong> — strategy bundle (emitted only when
              <code>rankStrategies()</code> selected ≥1 strategy with a
              non-empty <code>promptBody</code>). Stage 4.
            </li>
          </ol>
          <p className="text-xs text-[#64748B]">
            Each block has <code>cache_control: {`{ type: "ephemeral" }`}</code>. The
            cache-smoke script (<code>scripts/defence/cache-smoke.mjs</code>)
            confirmed 100% prefix cache hit rate covering blocks 0–2 across 20
            fixtures, so the layout is validated.
          </p>
          <p className="text-xs text-[#64748B]">
            <code>PROMPT_VERSION = 2</code> — bumped 1 → 2 when the 4-block
            layout shipped (2026-05-16). Persisted on every{" "}
            <code>defence_package_runs</code> row.
          </p>
        </div>

        <pre className="bg-[#0F172A] text-[#F1F5F9] text-xs p-4 rounded overflow-x-auto whitespace-pre-wrap leading-relaxed">
{BASE_SYSTEM_PROMPT}
        </pre>
      </section>

      {/* ── Stage 4 — Family + Module + Strategy resolution ──── */}
      <section id="stage-4" className="space-y-4">
        <StageHeading
          number={4}
          title="Prompt — Family + Module + Strategy (Blocks 1–3)"
          source="lib/defence/reasonCodes/familyRegistry.ts ⊕ reasonCodes/registry.ts ⊕ strategies/registry.ts"
        />
        <p className="text-sm text-[#475569]">
          Three layers below Block 0. <strong>Layer 1 — Family</strong>{" "}
          (<code>resolveReasonCodeFamily</code>): groups reason codes into 9
          cross-cutting clusters. <strong>Layer 2 — Module</strong>{" "}
          (<code>resolveReasonCodeModule</code>): per-reason-code prompt body,
          DB-overridable. <strong>Layer 3 — Strategy</strong>{" "}
          (<code>rankStrategies</code>): selects 1–3 strategies per dispute
          based on fact-predicate gates; the family&apos;s narrow_fallback is
          always appended last so the bundle is never empty.
        </p>

        <h3 className="text-sm font-semibold text-[#0F172A]">
          Layer 1 — Reason-code families (Block 1)
        </h3>
        <p className="text-xs text-[#64748B]">
          Block 1 emits only when <code>overlayPromptBody</code> is non-empty.
          Phase 1 ships every family with an empty overlay — the block is
          currently skipped on every call. Families fill in over time as
          cross-cutting rules emerge.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Family key</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Modules</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Unmodeled codes</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Fallback module</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Overlay</th>
              </tr>
            </thead>
            <tbody>
              {ALL_REASON_CODE_FAMILIES.map((f) => (
                <tr key={f.key} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">{f.key}</td>
                  <td className="px-4 py-2 text-[#475569] font-mono text-xs">
                    {f.moduleKeys.length === 0 ? "—" : f.moduleKeys.join(", ")}
                  </td>
                  <td className="px-4 py-2 text-[#475569] text-xs">
                    {f.unmodeledCodes.length === 0 ? "—" : f.unmodeledCodes.join(", ")}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#475569]">{f.fallbackModuleKey}</td>
                  <td className="px-4 py-2 text-[#475569] text-xs">
                    {f.overlayPromptBody.trim().length > 0 ? `${f.overlayPromptBody.length} chars` : "empty"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A]">
          Layer 2 — Reason-code modules (Block 2)
        </h3>
        <p className="text-xs text-[#64748B]">
          Always emitted. <code>resolveReasonCodeModule</code> reads the latest
          active DB row from <code>defence_prompt_modules</code>; if present
          its <code>prompt_body</code> and <code>guidance_json</code> fields
          win over the file default. Unknown reason codes fall through to{" "}
          <code>generic_fallback</code>.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Key</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Display name</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Reason codes</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Source</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Active version</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Model</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.key} className="border-b border-[#F1F5F9] last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A]">{m.key}</td>
                  <td className="px-4 py-2 text-[#0F172A]">{m.displayName}</td>
                  <td className="px-4 py-2 text-[#475569]">
                    {m.reasonCodeKeys.length === 0 ? "—" : m.reasonCodeKeys.join(", ")}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs ${m.source === "db" ? "bg-blue-50 text-blue-700" : "bg-slate-50 text-slate-600"}`}
                    >
                      {m.source === "db" ? "DB override" : "File default"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#475569]">v{m.version}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[#475569]">{m.model ?? "(default)"}</td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/admin/defence-package/prompts/${m.key}`}
                      className="text-[#1D4ED8] hover:underline text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A]">
          Layer 3 — Strategy submodules (Block 3)
        </h3>
        <p className="text-xs text-[#64748B]">
          <code>rankStrategies({"{familyKey, predicateEvaluations, packageMode, max=3}"})</code>{" "}
          filters by predicate gates (<code>all</code> / <code>any</code> /
          <code>none</code>), sorts by family-canonical order with{" "}
          <code>priority</code> as tiebreaker, caps non-fallback at{" "}
          <code>max - 1</code>, and ALWAYS appends the family&apos;s
          <code>narrow_fallback</code> as the last entry. The concatenated{" "}
          <code>promptBody</code> strings (joined by{" "}
          <code>\n\n---\n\n</code>) become Block 3.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Family</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Strategy key</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Fallback?</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Gate (all)</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Gate (any)</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(STRATEGIES_BY_FAMILY).flatMap(([familyKey, strategies]) =>
                strategies.map((s) => (
                  <tr key={s.key} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                    <td className="px-4 py-2 font-mono text-xs text-[#475569] whitespace-nowrap">{familyKey}</td>
                    <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">{s.key}</td>
                    <td className="px-4 py-2 text-xs">
                      {s.isFallback ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">fallback</span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[#475569] text-xs font-mono">
                      {s.predicates.all && s.predicates.all.length > 0 ? s.predicates.all.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-[#475569] text-xs font-mono">
                      {s.predicates.any && s.predicates.any.length > 0 ? s.predicates.any.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-[#475569] text-xs">{s.priority}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Stage 5 — User payload ───────────────────────────── */}
      <section id="stage-5" className="space-y-4">
        <StageHeading
          number={5}
          title="User payload schema"
          source="lib/defence/narrativeWriter.ts:314 buildLlmFactPayload — example rendered from tests/fixtures/defence-package-sample.json"
        />
        {sample.error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Could not load fixture: {sample.error}
          </div>
        ) : (
          <pre className="bg-[#0F172A] text-[#F1F5F9] text-xs p-4 rounded overflow-x-auto whitespace-pre-wrap leading-relaxed">
{JSON.stringify(sample.payload, null, 2)}
          </pre>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <CaptionPanel
            heading="Filtered out"
            body={
              <>
                Facts with <code>submissionRisk=true && !includeInBankNarrative</code>{" "}
                are dropped from <code>approvedFacts</code> before the payload
                is sent. They never reach the model.
              </>
            }
          />
          <CaptionPanel
            heading="Id-only"
            body={
              <>
                <code>internalOnlyFactIds</code> lists ids whose values are
                intentionally absent from the payload. The model knows they
                exist (so it can&apos;t reference them) but cannot see their
                content.
              </>
            }
          />
          <CaptionPanel
            heading="Omission-only"
            body={
              <>
                <code>missingEvidence</code> is for the LLM&apos;s omission
                decisions only. The narrative must never quote it — the
                bank should not see what we don&apos;t have.
              </>
            }
          />
          <CaptionPanel
            heading="Not bank-safe"
            body={
              <>
                Anything in <code>INTERNAL_ONLY_FIELDS</code> must never
                surface in bank-facing copy regardless of overrides; the
                renderer omits sections that have no supporting bank-eligible
                fact.
              </>
            }
          />
        </div>
      </section>

      {/* ── Stage 6 — LLM call params ────────────────────────── */}
      <section id="stage-6" className="space-y-4">
        <StageHeading
          number={6}
          title="LLM call parameters"
          source="lib/defence/narrativeWriter.ts (generateNarrative)"
        />
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <ParamRow
            label="Model resolution"
            value="ctx.modelOverride → DEFENCE_PACKAGE_DEFAULT_MODEL env → 'claude-sonnet-4-6'"
          />
          <ParamRow label="maxTokens" value="4096" />
          <ParamRow label="temperature" value="0.2" />
          <ParamRow
            label="System blocks"
            value="Up to 4 × cache_control: { type: 'ephemeral' } — Block 0 (base) + Block 1 (family overlay, when non-empty) + Block 2 (module promptBody) + Block 3 (strategy bundle, when ≥1 strategy). Phase 1 ships family overlays empty so Block 1 is skipped today."
          />
          <ParamRow
            label="Retry"
            value="One retry on JSON parse failure; same temperature, same model."
          />
          <ParamRow
            label="Daily cap (generations)"
            value={`${process.env.DEFENCE_PACKAGE_DAILY_GENERATION_CAP ?? "100"} per shop per day`}
          />
          <ParamRow
            label="Daily cap (input tokens)"
            value={`${process.env.DEFENCE_PACKAGE_DAILY_TOKEN_CAP ?? "50000"} per shop per day`}
          />
        </div>
      </section>

      {/* ── Stage 7 — Validators ─────────────────────────────── */}
      <section id="stage-7" className="space-y-6">
        <StageHeading
          number={7}
          title="Validators"
          source="lib/defence/validateNarrative.ts + lib/defence/claimGuards.ts"
        />
        <p className="text-sm text-[#475569]">
          Run after the LLM returns. Validation fails closed — a failure
          blocks PDF render and Shopify submission.
        </p>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-[#475569] space-y-2">
          <p className="font-semibold text-[#0F172A]">
            v2.1: two validators, same kernel
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>
              <code>validateNarrative</code> — runs the kernel against the
              LLM&apos;s JSON output. Layer tag <code>narrative</code>.
            </li>
            <li>
              <code>validateComposedDocument</code> (v2.1, NEW) — runs the
              SAME kernel against every block&apos;s{" "}
              <code>thesisText</code>, <code>llmText</code>, and{" "}
              <code>fallbackText</code> AFTER{" "}
              <code>composePdfBlocks</code> builds the prose and BEFORE the
              renderer is invoked. Each failure is tagged with{" "}
              <code>layer: &quot;thesis&quot; | &quot;llm&quot; | &quot;fallback&quot;</code> so{" "}
              <code>failure_reason</code> reads like{" "}
              <code>composed:thesis &quot;irrefutable&quot; in executiveSummary</code>.
            </li>
          </ul>
          <p className="text-xs text-[#475569]">
            Static renderer prose now obeys the same safety contract as LLM
            output. Pre-v2.1 the static <code>THESIS_LIBRARY</code> bypassed
            every check; that&apos;s structurally closed.
          </p>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A]">Forbidden phrases (all modes)</h3>
        <RegexTable rows={FORBIDDEN_PHRASES} />

        <h3 className="text-sm font-semibold text-[#0F172A]">Narrow-mode aggressive phrases</h3>
        <p className="text-xs text-[#64748B]">
          Additional bans applied only when <code>packageMode=&quot;narrow&quot;</code>.
        </p>
        <RegexTable rows={NARROW_AGGRESSIVE_PHRASES} />

        <h3 className="text-sm font-semibold text-[#0F172A]">Claim guards (fact-property predicates)</h3>
        <p className="text-xs text-[#64748B]">
          Each guard pairs a narrative regex with a predicate over{" "}
          <code>approvedFacts</code>. When the narrative makes the guarded
          claim and the predicate is unsatisfied, validation fails.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Id</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Description</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Pattern</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Required fact</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Applies to</th>
              </tr>
            </thead>
            <tbody>
              {CLAIM_GUARDS.map((g) => (
                <tr key={g.id} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A]">{g.id}</td>
                  <td className="px-4 py-2 text-[#475569]">{g.description}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[#1D4ED8]">{g.pattern.source}</td>
                  <td className="px-4 py-2 text-[#475569]">{g.requiredFact}</td>
                  <td className="px-4 py-2 text-[#475569]">
                    {g.appliesToSections === "all" ? "all sections" : (g.appliesToSections as string[]).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Stage 8 — Render ─────────────────────────────────── */}
      <section id="stage-8" className="space-y-6">
        <StageHeading
          number={8}
          title="Render"
          source="lib/defence/pdf/DefencePackageDocument.tsx"
        />

        <h3 className="text-sm font-semibold text-[#0F172A]">PDF section order</h3>
        <ol className="list-decimal list-inside text-sm text-[#475569] space-y-1 rounded-lg border border-[#E5E7EB] bg-white p-4">
          {[
            "Cover page",
            "Case Details table",
            "Executive Summary",
            "Transaction Overview",
            "Chronology of Events",
            "Order Line Items",
            "Payment Authentication",
            "Fulfillment, Delivery & Access",
            "Customer Communication",
            "Policy Disclosure",
            "Evidence Basis",
            "Supplementary Merchant Evidence",
            "Supporting Evidence Index",
            "Conclusion",
            "Package Metadata (audit trail)",
            "Footer (page numbers, version, mode)",
          ].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <h3 className="text-sm font-semibold text-[#0F172A]">Omission rules</h3>
        <ul className="list-disc list-inside text-sm text-[#475569] space-y-1 rounded-lg border border-[#E5E7EB] bg-white p-4">
          <li>
            <code>SectionBlock</code> returns <code>null</code> when the
            section text is empty or when the sectionKey is in{" "}
            <code>omittedSections</code> — no heading, no placeholder.
          </li>
          <li>
            <code>SupportingEvidenceIndex</code> returns <code>null</code>{" "}
            when zero attachments are flagged <code>includeInPackage</code>.
            The bank never sees &quot;no attachments&quot; copy.
          </li>
          <li>
            <code>EvidenceBasis</code> returns <code>null</code> defensively
            when zero bank-eligible facts exist. Upstream classifier should
            prevent this state.
          </li>
          <li>
            <code>FulfillmentFallback</code> renders a neutral sentence only
            when <code>fulfillmentArgument</code> is omitted by the LLM AND
            the order record marks the order FULFILLED.
          </li>
          <li>
            The thesis blockquote is <strong>fact-templated</strong> (Phase 4).
            Templates live in <code>thesisTemplates.ts</code> with tokens
            extracted from approved facts only. Missing required token →
            blockquote is empty (no fall-back claim).
          </li>
        </ul>

        <h3 className="text-sm font-semibold text-[#0F172A]">Thesis templates</h3>
        <p className="text-xs text-[#64748B]">
          Fact-templated blockquotes that open each section. <code>{"{{token}}"}</code> is
          substituted from approved-fact extractors; <code>{"[["}…<code>{"]]"}</code></code> wraps
          optional clauses that strip when their tokens don&apos;t resolve. The
          composed-PDF validator also runs the forbidden-phrase + claim-guard
          regex set against the rendered output before the PDF is written.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Key (section : family : mode)</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Template</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Required tokens</th>
              </tr>
            </thead>
            <tbody>
              {THESIS_TEMPLATES.map((t) => (
                <tr key={t.key} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">{t.key}</td>
                  <td className="px-4 py-2 text-[#475569] font-mono text-xs">{t.template}</td>
                  <td className="px-4 py-2 text-[#475569] text-xs">
                    {t.requiredTokens.length > 0 ? t.requiredTokens.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-[#0F172A]">Thesis tokens</h3>
        <p className="text-xs text-[#64748B]">
          Named extractors over approved facts. Each token is optionally gated
          on a fact predicate — a token cannot resolve when its predicate is
          false, so the templates structurally cannot claim a fact that isn&apos;t
          on record.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Token</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Predicate gate</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(THESIS_TOKENS).map((tok) => (
                <tr key={tok.name} className="border-b border-[#F1F5F9] last:border-b-0 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">{tok.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[#0F172A] whitespace-nowrap">
                    {tok.predicateId ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{tok.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-xs text-[#475569]">
          The renderer decides what appears in the final PDF even after the
          LLM output passes validation. Empty sections are omitted entirely
          (no placeholder, no padding) — the &quot;NEVER weaken the case by
          referencing what is absent&quot; rule from{" "}
          <code>lib/shopify/formatEvidenceForShopify.ts</code> applies to the
          defence-package renderer too.
        </div>
      </section>
    </div>
  );
}

/* ── Tiny helpers ───────────────────────────────────────────── */

function StageHeading({
  number,
  title,
  source,
}: {
  number: number;
  title: string;
  source: string;
}) {
  return (
    <div className="border-b border-[#E5E7EB] pb-2">
      <h2 className="text-xl font-bold text-[#0F172A]">
        <span className="text-[#1D4ED8] font-mono mr-2">{number}.</span>
        {title}
      </h2>
      <div className="text-xs text-[#64748B] font-mono mt-1">{source}</div>
    </div>
  );
}

function ChipPanel({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: string[];
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0F172A] font-mono">{title}</h3>
      <p className="text-xs text-[#64748B] mt-1 mb-3">{note}</p>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <span className="text-xs text-[#94A3B8]">(empty)</span>
        ) : (
          items.map((k) => (
            <span
              key={k}
              className="inline-block px-2 py-0.5 rounded text-xs bg-slate-50 text-slate-700 font-mono border border-slate-200"
            >
              {k}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function CaptionPanel({
  heading,
  body,
}: {
  heading: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0F172A]">{heading}</h3>
      <p className="text-xs text-[#475569] mt-1">{body}</p>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-[#64748B]">{label}</span>
      <span className="text-sm font-mono text-[#0F172A]">{value}</span>
    </div>
  );
}

function RegexTable({ rows }: { rows: RegExp[] }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
          <tr>
            <th className="text-left px-4 py-2 text-[#64748B] font-medium w-2/3">
              Pattern (regex)
            </th>
            <th className="text-left px-4 py-2 text-[#64748B] font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#F1F5F9] last:border-b-0">
              <td className="px-4 py-2 font-mono text-xs text-[#1D4ED8] break-all">
                {r.source}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-[#475569]">{r.flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
