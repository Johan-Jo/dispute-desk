/**
 * Not-as-described plan PR 1 release gate: write the letter for decided
 * disputes with THIS checkout's prompts, then run the narrative and
 * composed-document validators. Run it once in a develop checkout and once on
 * the PR branch, then compare the two output files.
 *
 * READ-ONLY against the database. Facts are re-derived from each dispute's
 * current evidence pack with this checkout's classifier (`classifyFacts`), then
 * narrowed the way the argument plan narrows them: the reason module's
 * allowed categories and the bank-inclusion predicate. Pass `--stored-facts` to
 * use the facts stored on the latest package instead. The model call
 * goes through the staging pilot route (the local Anthropic key is unusable),
 * with the production model and temperature, so only the prompts differ.
 *
 *   npx tsx scripts/defence/compare-nad-letters.mts --env-file .env.production.local \
 *     --token-file <pilot.token> --out <file.json> --dispute <uuid> [--dispute <uuid> ...]
 */
import fs from "node:fs";
import { config } from "dotenv";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
const envFile = arg("env-file");
const tokenFile = arg("token-file");
const out = arg("out");
const disputeIds = args("dispute");
if (!envFile || !tokenFile || !out || disputeIds.length === 0) {
  console.error("usage: --env-file <f> --token-file <f> --out <f.json> --dispute <uuid> [...]");
  process.exit(1);
}
config({ path: envFile, override: true });

const { getServiceClient } = await import("../../lib/supabase/server");
const { BASE_SYSTEM_PROMPT, buildLlmFactPayload, CURRENT_PROMPT_VERSION } = await import("../../lib/defence/narrativeWriter");
const { resolveReasonCodeModule } = await import("../../lib/defence/reasonCodes/registry");
const { familyForModule } = await import("../../lib/defence/reasonCodes/familyRegistry");
const { rankStrategies } = await import("../../lib/defence/strategies/registry");
const { paymentOverlayFor } = await import("../../lib/defence/paymentOverlays");
const { evaluateAllPredicates } = await import("../../lib/defence/factPredicates");
const { validateNarrative, validateComposedDocument, VALIDATOR_VERSION } = await import("../../lib/defence/validateNarrative");
const { composePdfBlocks } = await import("../../lib/defence/pdf/composePdfBlocks");
const { disputedAmountDisplay } = await import("../../lib/defence/shipmentRecordSections");
const { classifyFacts, hasArgumentBeyondRecordContext } = await import("../../lib/defence/factClassifier");
const { bankIncludedFacts } = await import("../../lib/defence/bankInclusion");
const { alwaysAdmissibleCategories } = await import("../../lib/defence/alwaysAdmissible");
const storedFacts = process.argv.includes("--stored-facts");
type Facts = import("../../lib/defence/types").EvidenceFact[];
type Narrative = import("../../lib/defence/types").DefenceNarrativeOutput;

const TOKEN = fs.readFileSync(tokenFile, "utf8").trim();
const ROUTE = "https://dev.disputedesk.app/api/public/pilot-inr-letter";
const SECTIONS = [
  "executiveSummary", "transactionOverviewArgument", "chronologyArgument", "paymentAuthenticationArgument",
  "fulfillmentArgument", "communicationArgument", "policyArgument", "manualEvidenceArgument", "conclusion",
] as const;

function parse(raw: string): Narrative | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try {
    const p = JSON.parse(raw.slice(s, e + 1)) as Record<string, { text?: unknown; usedFactIds?: unknown }> & {
      omittedSections?: { sectionKey: string; reason?: string }[];
      warnings?: unknown[];
    };
    const n: Record<string, unknown> = {};
    for (const k of SECTIONS) {
      const sec = p[k];
      if (!sec || typeof sec.text !== "string" || !Array.isArray(sec.usedFactIds)) return null;
      n[k] = { text: sec.text, usedFactIds: sec.usedFactIds.filter((x) => typeof x === "string") };
    }
    n.omittedSections = (p.omittedSections ?? []).map((o) => ({ sectionKey: o.sectionKey, reason: o.reason ?? "" }));
    n.warnings = (p.warnings ?? []).filter((x) => typeof x === "string");
    return n as unknown as Narrative;
  } catch {
    return null;
  }
}

const sb = getServiceClient();
const results = [];
for (const disputeId of disputeIds) {
  const { data: d } = await sb
    .from("disputes")
    .select("id, order_name, reason, network_reason_code, amount, currency_code, initiated_at, final_outcome")
    .eq("id", disputeId)
    .single();
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("id, version, package_mode, facts_json, source_pack_id")
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  const { data: pack } = await sb.from("evidence_packs").select("id, pack_json, checklist_v2").eq("id", pkg!.source_pack_id).single();
  const packJson = (pack!.pack_json ?? {}) as Record<string, unknown>;
  const family = (packJson as { payment_context?: { family?: string } })?.payment_context?.family ?? null;
  const module = resolveReasonCodeModule(d!.network_reason_code ?? "13.3");

  let facts = (pkg!.facts_json ?? []) as Facts;
  let packageMode = pkg!.package_mode as "full" | "narrow";
  let skipped = false;
  if (!storedFacts) {
    const { data: items } = await sb.from("evidence_items").select("id, payload, source").eq("pack_id", pack!.id);
    const sections = ((packJson.sections ?? []) as Array<Record<string, unknown>>).map((sec) => ({
      type: sec.type as string, label: sec.label as string, source: sec.source as string,
      data: (sec.data ?? {}) as Record<string, unknown>, fieldsProvided: (sec.fieldsProvided ?? []) as string[],
    }));
    const c = classifyFacts({
      packageId: pkg!.id,
      sections,
      evidenceItems: (items ?? []).map((it) => ({ id: it.id, payload: it.payload, source: it.source ?? null })),
      checklist: ((pack!.checklist_v2 ?? []) as Array<{ field: string; status: string }>).map((x) => ({ field: x.field, status: x.status })),
      coverage: { state: (packJson.coverage as { state?: string } | undefined)?.state === "covered_shopify" ? "covered_shopify" : "not_covered" },
      fatalLoss: { triggered: (packJson.fatal_loss as { triggered?: boolean } | undefined)?.triggered === true, reason: null },
      caseStrength: "moderate",
      manualRows: [],
      reasonCodeModule: module,
    } as never);
    const allowed = new Set<string>([
      ...module.allowedFactCategories,
      ...alwaysAdmissibleCategories(c.approved, familyForModule(module.key).key),
    ]);
    facts = bankIncludedFacts(c.approved.filter((f: { category: string }) => allowed.has(f.category)));
    packageMode = c.packageMode;
    skipped = facts.length === 0 || !hasArgumentBeyondRecordContext(facts);
  }
  const fam = familyForModule(module.key);
  const strategies = rankStrategies({ familyKey: fam.key, predicateEvaluations: evaluateAllPredicates(facts), packageMode });
  const { overlay: paymentOverlay, prohibitedPhrases } = paymentOverlayFor(family, { shopifyReason: d!.reason, subProduct: null });

  const input = {
    packageId: pkg!.id,
    disputeId,
    reasonCode: d!.network_reason_code,
    reasonCodeModule: module,
    familyOverlay: fam.overlayPromptBody || null,
    paymentOverlay,
    strategies,
    packageMode,
    caseStrength: "moderate" as const,
    approvedFacts: facts,
    manualEvidence: [],
    internalOnlyFactIds: [],
    missingEvidence: [],
    bankClaim: null,
  };
  const system = [BASE_SYSTEM_PROMPT, input.familyOverlay, paymentOverlay, module.promptBody, strategies.map((s) => s.promptBody).join("\n\n---\n\n")]
    .filter((b): b is string => !!b && b.trim().length > 0)
    .join("\n\n");
  const res = await fetch(ROUTE, {
    method: "POST",
    headers: { "x-pilot-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ system, user: JSON.stringify(buildLlmFactPayload(input as never)), model: "claude-sonnet-4-6", temperature: 0.2, maxTokens: 4096 }),
  });
  const body = (await res.json()) as { text?: string; raw?: string; content?: { text: string }[]; error?: string; usage?: unknown };
  const raw = body.text ?? body.raw ?? body.content?.map((c) => c.text).join("") ?? "";
  const narrative = parse(raw);
  const hard = [...fam.prohibitedBankPhrases, ...prohibitedPhrases];
  const narrativeCheck = narrative
    ? validateNarrative({
        narrative, approvedFacts: facts, reasonCodeModule: module, packageMode,
        internalOnlyFactIds: [], extraHardPhrases: hard, guardedPhrases: fam.guardedBankPhrases,
      } as never)
    : null;
  const blocks = narrative
    ? composePdfBlocks({
        narrative, approvedFacts: facts, packageMode, familyKey: fam.key, moduleKey: module.key,
        fulfillmentStatus: null,
        caseContext: { orderName: d!.order_name, disputeOpenedAt: d!.initiated_at, disputedAmount: disputedAmountDisplay(Number(d!.amount), d!.currency_code) },
      } as never)
    : [];
  const composedCheck = narrative
    ? validateComposedDocument({ blocks, approvedFacts: facts, packageMode, extraHardPhrases: hard, guardedPhrases: fam.guardedBankPhrases } as never)
    : null;
  results.push({
    skipped, factCategories: facts.map((f) => f.category),
    disputeId, order: d!.order_name, outcome: d!.final_outcome, paymentFamily: family, packageMode,
    strategies: strategies.map((s) => s.key), status: res.status, error: body.error ?? null, usage: body.usage ?? null,
    narrative: narrative ? Object.fromEntries(SECTIONS.map((k) => [k, (narrative as never as Record<string, { text: string }>)[k].text])) : raw.slice(0, 2000),
    composed: blocks.map((b: { sectionKey: string; thesisText?: string; llmText?: string }) => ({ section: b.sectionKey, thesis: b.thesisText ?? "", llm: b.llmText ?? "" })),
    narrativeValidation: narrativeCheck ? { ok: narrativeCheck.ok, errors: narrativeCheck.errors } : null,
    composedValidation: composedCheck ? { ok: composedCheck.ok, errors: composedCheck.errors } : null,
  });
  console.log(`${d!.order_name}: http ${res.status} narrative=${narrativeCheck?.ok} composed=${composedCheck?.ok}`);
}
fs.writeFileSync(out, JSON.stringify({ promptVersion: CURRENT_PROMPT_VERSION, validatorVersion: VALIDATOR_VERSION, results }, null, 2));
console.log(`wrote ${out}`);
