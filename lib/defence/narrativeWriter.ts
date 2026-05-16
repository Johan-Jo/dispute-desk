/**
 * Grounded narrative writer — the only LLM caller in the defence pipeline.
 *
 * Builds a STRICT user payload from normalised `EvidenceFact[]` records.
 * No raw Shopify JSON crosses this boundary — `factClassifier.ts` is the
 * raw-Shopify cut-off. The user message contains:
 *
 *   - case metadata (dispute id, reason code, packageMode, caseStrength)
 *   - approvedFacts (id + category + label + value + strength)
 *   - manualEvidence (filename + bank-eligibility flags only)
 *   - reasonCodeGuidance (module key + prioritize / avoid / mustNotClaim)
 *   - internalOnlyFactIds (FORBIDDEN references — ids only, no values)
 *   - missingEvidence (category + label for omission decisions only)
 *
 * System payload is split into two cached blocks (static base + module
 * guidance) so Anthropic's prompt cache amortises across calls.
 *
 * One retry on JSON parse error. Every attempt writes a
 * `defence_package_runs` row for cost/health telemetry.
 *
 * Per-shop daily cap (default: 100 generations OR 50k input tokens) is
 * enforced by counting today's `defence_package_runs` rows for the shop.
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  callClaudeMessages,
  type ClaudeSystemBlock,
} from "./anthropicClient";
import type {
  DefenceNarrativeOutput,
  NarrativeInput,
  NarrativeSection,
  PackageMode,
} from "./types";

const DEFAULT_MODEL_ENV = "DEFENCE_PACKAGE_DEFAULT_MODEL";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DAILY_GENERATION_CAP = Number(
  process.env.DEFENCE_PACKAGE_DAILY_GENERATION_CAP ?? "100",
);
const DAILY_TOKEN_CAP = Number(
  process.env.DEFENCE_PACKAGE_DAILY_TOKEN_CAP ?? "50000",
);

const PROMPT_FAMILY = "defence_package_narrative";
const PROMPT_VERSION = 1;

/* ── Static base system prompt (cached, ephemeral) ── */

const BASE_SYSTEM_PROMPT = `You are a chargeback representment narrative writer for DisputeDesk.

Your task is to convert APPROVED dispute evidence into professional, bank-facing
argument sections.

Rules:
1. Use only the facts in approvedFacts.
2. Do not invent, assume, infer, estimate, or embellish.
3. You are not investigating. You are not deciding what happened. You are
   converting approved facts into professional prose.
4. Every paragraph must be traceable to at least one approved fact id, via
   usedFactIds on the section.
5. Do not mention facts whose ids appear in internalOnlyFactIds (those facts
   are forbidden — their values are intentionally absent from this payload).
6. Do not mention missing evidence in bank-facing text. The missingEvidence
   list is for omission decisions only.
7. Professional, neutral, bank-facing language. Prefer evidence-based phrasing:
   "supports", "indicates", "is consistent with", "the available records show",
   "provides evidence that".
8. Do NOT use: "irrefutable", "definitive proof", "undeniable", "fraudulent
   cardholder", "the customer is lying", "the dispute is invalid".
9. If approvedFacts are weak or incomplete, write a NARROWER argument. Do not
   fill gaps. If a section has no supporting facts, return an empty string for
   that section AND list its sectionKey in omittedSections.
10. packageMode governs tone:
    - "full"   → firmer framing allowed.
    - "narrow" → hedged framing required. Use "The available evidence supports…",
                 "The available records indicate…", "The submitted evidence is
                 consistent with…". Executive summary must be one paragraph
                 of ≤ 4 sentences. No aggressive conclusions such as "the
                 dispute is invalid" or "this is clearly not fraud".
11. Return valid JSON only. No markdown. No code fences. No prose outside JSON.
12. Schema of the JSON output:

{
  "executiveSummary":            { "text": "...", "usedFactIds": ["..."] },
  "transactionOverviewArgument": { "text": "...", "usedFactIds": ["..."] },
  "chronologyArgument":          { "text": "...", "usedFactIds": ["..."] },
  "paymentAuthenticationArgument": { "text": "...", "usedFactIds": ["..."] },
  "fulfillmentArgument":         { "text": "...", "usedFactIds": ["..."] },
  "communicationArgument":       { "text": "...", "usedFactIds": ["..."] },
  "policyArgument":              { "text": "...", "usedFactIds": ["..."] },
  "manualEvidenceArgument":      { "text": "...", "usedFactIds": ["..."] },
  "conclusion":                  { "text": "...", "usedFactIds": ["..."] },
  "omittedSections": [{ "sectionKey": "fulfillmentArgument", "reason": "..." }],
  "warnings": []
}

13. If a section has no supporting approved facts, return:
    { "text": "", "usedFactIds": [] }
    and add an entry to omittedSections.`;

/* ── Public surface ── */

export interface GenerateNarrativeResult {
  narrative: DefenceNarrativeOutput | null;
  modelUsed: string;
  promptVersion: number;
  promptFamily: string;
  tokens: { prompt: number; completion: number; cached: number };
  durationMs: number;
  capReached: boolean;
  error: string | null;
}

export interface GenerateNarrativeContext {
  shopId: string;
  packageId: string;
  /** Override model. Falls through to env var, then default. */
  modelOverride?: string | null;
}

export async function generateNarrative(
  input: NarrativeInput,
  ctx: GenerateNarrativeContext,
): Promise<GenerateNarrativeResult> {
  const model =
    ctx.modelOverride ?? process.env[DEFAULT_MODEL_ENV] ?? DEFAULT_MODEL;
  const sb = getServiceClient();

  // Per-shop daily cap check.
  const cap = await checkDailyCap(sb, ctx.shopId);
  if (cap.capReached) {
    return {
      narrative: null,
      modelUsed: model,
      promptVersion: PROMPT_VERSION,
      promptFamily: PROMPT_FAMILY,
      tokens: { prompt: 0, completion: 0, cached: 0 },
      durationMs: 0,
      capReached: true,
      error: `Per-shop daily cap reached (${cap.generations}/${DAILY_GENERATION_CAP} gens, ${cap.inputTokens}/${DAILY_TOKEN_CAP} tokens)`,
    };
  }

  const userPayload = buildLlmFactPayload(input);
  const system: ClaudeSystemBlock[] = [
    {
      type: "text",
      text: BASE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: input.reasonCodeModule.promptBody,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Attempt 1.
  let attempt = 1;
  let lastError: string | null = null;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCached = 0;
  let totalDuration = 0;

  while (attempt <= 2) {
    const callRes = await callClaudeMessages({
      model,
      system,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      maxTokens: 4096,
      temperature: 0.2,
    });
    totalPrompt += callRes.promptTokens;
    totalCompletion += callRes.completionTokens;
    totalCached += callRes.cachedTokens;
    totalDuration += callRes.durationMs;

    if (callRes.error || !callRes.raw) {
      await writeRun(sb, ctx, {
        model,
        packageMode: input.packageMode,
        promptTokens: callRes.promptTokens,
        completionTokens: callRes.completionTokens,
        durationMs: callRes.durationMs,
        validationStatus: "error",
      });
      lastError = callRes.error ?? "empty response";
      // Network/API errors are retriable but we don't loop here — return
      // and let the caller (job handler) decide.
      return {
        narrative: null,
        modelUsed: model,
        promptVersion: PROMPT_VERSION,
        promptFamily: PROMPT_FAMILY,
        tokens: { prompt: totalPrompt, completion: totalCompletion, cached: totalCached },
        durationMs: totalDuration,
        capReached: false,
        error: lastError,
      };
    }

    const parsed = tryParseNarrative(callRes.raw);
    if (parsed) {
      await writeRun(sb, ctx, {
        model,
        packageMode: input.packageMode,
        promptTokens: callRes.promptTokens,
        completionTokens: callRes.completionTokens,
        durationMs: callRes.durationMs,
        validationStatus: "ok",
      });
      return {
        narrative: parsed,
        modelUsed: model,
        promptVersion: PROMPT_VERSION,
        promptFamily: PROMPT_FAMILY,
        tokens: { prompt: totalPrompt, completion: totalCompletion, cached: totalCached },
        durationMs: totalDuration,
        capReached: false,
        error: null,
      };
    }

    // Parse failed — one retry, lower temperature.
    await writeRun(sb, ctx, {
      model,
      packageMode: input.packageMode,
      promptTokens: callRes.promptTokens,
      completionTokens: callRes.completionTokens,
      durationMs: callRes.durationMs,
      validationStatus: "failed",
    });
    lastError = `JSON parse failed on attempt ${attempt}: ${truncate(callRes.raw, 200)}`;
    attempt += 1;
  }

  return {
    narrative: null,
    modelUsed: model,
    promptVersion: PROMPT_VERSION,
    promptFamily: PROMPT_FAMILY,
    tokens: { prompt: totalPrompt, completion: totalCompletion, cached: totalCached },
    durationMs: totalDuration,
    capReached: false,
    error: lastError,
  };
}

/* ── Helpers ── */

/** Build the strict JSON user payload. ONLY normalised EvidenceFact records
 *  cross this boundary. Test `narrativeWriter.payload.test.ts` asserts that
 *  no raw Shopify JSON keys appear. */
export function buildLlmFactPayload(input: NarrativeInput): Record<string, unknown> {
  // Filter: never expose submission-risk facts unless includeInBankNarrative override.
  const approvedFacts = input.approvedFacts
    .filter((f) => !f.submissionRisk || f.includeInBankNarrative)
    .map((f) => ({
      id: f.id,
      category: f.category,
      label: f.label,
      strength: f.strength,
      value: f.value,
    }));

  return {
    packageId: input.packageId,
    disputeId: input.disputeId,
    reasonCode: input.reasonCode,
    packageMode: input.packageMode,
    caseStrength: input.caseStrength,
    reasonCodeGuidance: {
      key: input.reasonCodeModule.key,
      displayName: input.reasonCodeModule.displayName,
      prioritize: input.reasonCodeModule.prioritize,
      avoid: input.reasonCodeModule.avoid,
      mustNotClaim: input.reasonCodeModule.mustNotClaim,
      criticalCategories: input.reasonCodeModule.criticalCategories,
      allowedFactCategories: input.reasonCodeModule.allowedFactCategories,
    },
    approvedFacts,
    manualEvidence: input.manualEvidence
      .filter((m) => m.includeInPackage)
      .map((m) => ({
        id: m.id,
        filename: m.filename,
        evidenceCategory: m.evidenceCategory,
        bankEligible: m.bankEligible,
        includeInBankNarrative: m.includeInBankNarrative,
        description: m.description,
      })),
    internalOnlyFactIds: input.internalOnlyFactIds,
    missingEvidence: input.missingEvidence.map((m) => ({
      category: m.category,
      label: m.label,
    })),
  };
}

function tryParseNarrative(raw: string): DefenceNarrativeOutput | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sectionKeys = [
      "executiveSummary",
      "transactionOverviewArgument",
      "chronologyArgument",
      "paymentAuthenticationArgument",
      "fulfillmentArgument",
      "communicationArgument",
      "policyArgument",
      "manualEvidenceArgument",
      "conclusion",
    ] as const;

    const sections: Partial<Record<(typeof sectionKeys)[number], NarrativeSection>> = {};
    for (const k of sectionKeys) {
      const s = parsed[k];
      if (!s || typeof s !== "object") return null;
      const text = (s as Record<string, unknown>).text;
      const usedFactIds = (s as Record<string, unknown>).usedFactIds;
      if (typeof text !== "string") return null;
      if (!Array.isArray(usedFactIds)) return null;
      sections[k] = {
        text,
        usedFactIds: usedFactIds.filter((x): x is string => typeof x === "string"),
      };
    }

    const omittedSections = Array.isArray(parsed.omittedSections)
      ? (parsed.omittedSections as Array<Record<string, unknown>>)
          .map((o) => ({
            sectionKey: o.sectionKey as DefenceNarrativeOutput["omittedSections"][number]["sectionKey"],
            reason: typeof o.reason === "string" ? o.reason : "",
          }))
      : [];

    const warnings = Array.isArray(parsed.warnings)
      ? (parsed.warnings as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    return {
      ...(sections as Required<typeof sections>),
      omittedSections,
      warnings,
    } as DefenceNarrativeOutput;
  } catch {
    return null;
  }
}

async function checkDailyCap(
  sb: ReturnType<typeof getServiceClient>,
  shopId: string,
): Promise<{ capReached: boolean; generations: number; inputTokens: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("defence_package_runs")
    .select("prompt_tokens")
    .eq("shop_id", shopId)
    .eq("daily_bucket", today);
  if (error) {
    // Soft-fail: log and proceed. We'd rather make the call than block on a
    // count query.
    console.warn("[defence] daily-cap query failed", error.message);
    return { capReached: false, generations: 0, inputTokens: 0 };
  }
  const generations = data?.length ?? 0;
  const inputTokens = (data ?? []).reduce(
    (sum, r) => sum + ((r as { prompt_tokens?: number | null }).prompt_tokens ?? 0),
    0,
  );
  const capReached =
    generations >= DAILY_GENERATION_CAP || inputTokens >= DAILY_TOKEN_CAP;
  return { capReached, generations, inputTokens };
}

async function writeRun(
  sb: ReturnType<typeof getServiceClient>,
  ctx: GenerateNarrativeContext,
  row: {
    model: string;
    packageMode: PackageMode | null;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    validationStatus: "ok" | "failed" | "skipped" | "error";
  },
): Promise<void> {
  await sb.from("defence_package_runs").insert({
    package_id: ctx.packageId,
    shop_id: ctx.shopId,
    prompt_version: PROMPT_VERSION,
    model: row.model,
    package_mode: row.packageMode,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    duration_ms: row.durationMs,
    validation_status: row.validationStatus,
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
