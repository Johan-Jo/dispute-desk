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
// Phase 3 (2026-05-16): bumped 1 → 2 with the introduction of the
// family-overlay and strategy-bundle cached system blocks. The G2 audit
// confirmed no downstream consumer keys behaviour off the literal `1`
// (only test fixtures and the constant itself referenced 1). This is a
// global cache invalidation event — first call after deploy pays full
// prompt cost, subsequent calls amortise normally.
//
// v2.2 (2026-05-17): bumped 2 → 3. The unauthorized_fraud family now
// ships a non-empty overlayPromptBody (Block 1), the LLM payload
// includes the new merchant-facing `claimType` field, and module
// promptBodies were rewritten to lead with the claim category instead
// of the network's environment classification. Same cache-invalidation
// pattern as the 2→3 bump above.
// v9 (2026-07-15): rule 8c now explicitly forbids the mechanical
// "fulfillment status of X" phrasing (dispute #C89276B6 kept emitting it
// in transactionOverviewArgument + chronologyArgument and failed
// validation even after the retry). Paired with a validateNarrative.ts
// change that stops banning natural lowercase "fulfilled" prose. Same
// cache-invalidation pattern as prior bumps — first call after deploy
// pays full prompt cost, subsequent calls amortise.
const PROMPT_VERSION = 9;

// Re-export under a stable name for read-only consumers (workspace
// route surfaces this so the embedded card can detect "the submitted
// version was generated with an older prompt — regenerating would
// pick up newer guidance"). Keep PROMPT_VERSION as the in-module
// constant the cache headers and writer reach for.
export const CURRENT_PROMPT_VERSION = PROMPT_VERSION;

/* ── Static base system prompt (cached, ephemeral) ── */

export const BASE_SYSTEM_PROMPT = `You are a chargeback representment narrative writer for DisputeDesk.

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
7. Professional, bank-facing language. In FULL mode you may use firm
   evidentiary framing — verbs like "establishes", "demonstrates",
   "confirms", "evidences", "corroborates", "records", "documents", "shows".
   Quote specific values from approved facts to ground each claim
   (e.g. "delivered 2026-05-12 to the verified address", "the customer
   confirmed receipt on 2026-05-13"). State the relationship between
   fact and reason code explicitly (e.g. "These authentication results
   are consistent with a cardholder-initiated transaction under Visa 10.4.").

   PAYMENT AUTHENTICATION CODES (AVS / CVV) — DO NOT quote the raw
   single-letter gateway result codes ("Y", "M", "N", "Z", "A", "W",
   "X", etc.) in any merchant prose. The fact value carries a
   pre-translated verificationSummary string (e.g. "the billing
   address matched the issuer's records and the card verification
   code matched the issuer's records") — quote that summary instead.
   Raw letter codes look unhinged in bank-facing prose and force the
   reader to look up the AVS/CVV reference. If verificationSummary
   is null, summarise neutrally ("the available payment authentication
   signals are consistent with a cardholder-initiated transaction")
   without naming the underlying letter codes.
8. Do NOT use overclaim or accusatory language: NEVER use "irrefutable",
   "definitive proof", "definitively proves", "definitively shows
   authorization", "undeniable", "unequivocally", "baseless", "invalidates
   the claim", "fraudulent cardholder", "the customer is lying", "the
   dispute is invalid". These are bank-side red flags. Restraint is more
   persuasive than confidence.

8a. Do NOT use absolute authorization conclusions. NEVER write:
   - "establishes that the transaction was authorized"
   - "proves the transaction was authorized"
   - "confirms the transaction was authorized"
   - "definitively shows authorization"
   Use softer evidentiary framing instead:
   - "strongly supports that the transaction was authorized by the cardholder"
   - "is consistent with a cardholder-authorized transaction"
   - "supports the conclusion that the transaction was authorized"
   - "contradicts the claim of an unauthorized transaction"

8b. CARD-NOT-PRESENT disputes only: NEVER claim the cardholder had
   "possession of the physical card", "had the physical card", "held
   the card", or that the "card was physically present". AVS and CVV
   confirm access to verification credentials and billing details on
   record with the issuer, not physical possession. Use:
   - "had access to card verification credentials and billing details
     associated with the cardholder account"
   - "provided verification details that matched issuer records"
   - "submitted billing and card verification data that matched the
     cardholder account"

8c. FULFILLMENT precision. order.fulfillmentStatus=FULFILLED alone is
   NOT delivery, access, use, or service completion. The forbidden
   words below MUST NOT appear in ANY section unless a matching
   approved fact exists in approvedFacts:

     FORBIDDEN WITHOUT MATCHING FACT:
       "received", "delivered", "accessed", "used", "downloaded",
       "logged in", "streamed", "completed", "fulfilled",
       "shipped", "dispatched"

   This applies in EVERY section including chronologyArgument.

   NEVER echo the raw order-system status enum. Do NOT write the
   mechanical phrase "fulfillment status of FULFILLED/UNFULFILLED/
   PARTIAL" (in any casing) and never write the bare token UNFULFILLED.
   Describe what the record shows in plain bank-facing language instead:
     WRONG → "the order's fulfillment status of fulfilled"
     RIGHT → "the order was fulfilled and the goods were delivered"
             (only when a delivery/access fact supports it — see below)
     RIGHT → "the order record shows the goods left the merchant"

   Concrete examples for an UNFULFILLED order with no delivery_proof:

     WRONG → "the order was placed and dispatched"
     WRONG → "the package was shipped from the merchant"
     WRONG → "the customer received the order"
     RIGHT → "the order record was created"
     RIGHT → "the payment was authorised"
     RIGHT → "the order was placed via the web channel"

   When in doubt about whether a fact supports a fulfilment word,
   use the neutral phrasing.
   - "received" / "delivered to the customer" → delivery_proof or
     shipping_tracking with proofType=delivered_confirmed or
     =signature_confirmed, OR
     digital_access_log with digitalAccessUsed=true, OR service_access
     with serviceDelivered=true.
   - "accessed" / "used" / "downloaded" / "logged in" / "streamed" →
     digital_access_log or service_access with digitalAccessUsed=true.
   - "access granted" → digital_access_log or service_access with
     digitalAccessGranted=true.
   - "service completed" / "service delivered" → service_access with
     serviceDelivered=true or serviceCompleted=true.
   If only fulfillmentStatus=FULFILLED exists with no delivery/access
   fact, leave fulfillmentArgument EMPTY and add it to omittedSections
   — the renderer will emit a minimal neutral sentence in its place.
9. If approvedFacts are weak or incomplete, write a NARROWER argument. Do not
   fill gaps. If a section has no supporting facts, return an empty string for
   that section AND list its sectionKey in omittedSections.
10. packageMode governs tone:
    - "full"   → firm evidentiary framing as in rule 7. Sections may close
                 with a one-sentence assertion linking the cited facts to
                 the reason code in question (e.g. "These signals are
                 consistent with cardholder-initiated activity under
                 [reason code]."). Length: 3–6 sentences per section.
    - "narrow" → hedged framing required. Use "The available evidence
                 supports…", "The available records indicate…", "The
                 submitted evidence is consistent with…". Executive
                 summary must be one paragraph of ≤ 4 sentences. No
                 declarative reason-code conclusions.
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
  /**
   * Validator-feedback for retry attempts. When the previous attempt
   * produced a parseable narrative that then failed `validateNarrative`
   * (e.g. the LLM wrote "dispatched" in chronologyArgument without a
   * supporting delivery fact), the build handler retries with the
   * errors stuffed into the user payload so the LLM sees exactly what
   * to fix. Each entry is a short string the model can act on.
   *
   * Empty / undefined → first attempt; no feedback injected.
   */
  validationFeedback?: string[] | null;
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
  // Validator-feedback retry: when present, prepend a `retryGuidance`
  // block to the user payload listing the previous attempt's errors.
  // The LLM treats this as priority context — much more reliable than
  // expecting it to re-read the rules list. See
  // `lib/jobs/handlers/buildDefencePackageJob.ts` for the caller.
  if (ctx.validationFeedback && ctx.validationFeedback.length > 0) {
    (userPayload as Record<string, unknown>).retryGuidance = {
      attempt: "second",
      previousAttemptErrors: ctx.validationFeedback,
      directive:
        "Your previous response was rejected by the fact-grounding validator for the errors above. Rewrite the affected sections using only language that is supported by approvedFacts. If a claim cannot be grounded in an approved fact, omit it entirely.",
    };
  }
  // System payload layout (cached, ephemeral):
  //   [0] BASE_SYSTEM_PROMPT                  (always)
  //   [1] family overlay   — Phase 1+         (only when non-empty)
  //   [2] module promptBody                   (always)
  //   [3] strategy bundle  — Phase 3+         (only when non-empty)
  // The optional blocks are only emitted when they have content so the
  // prompt-cache prefix stays stable while overlays/strategies fill in
  // over time.
  const system: ClaudeSystemBlock[] = [
    {
      type: "text",
      text: BASE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (input.familyOverlay && input.familyOverlay.trim().length > 0) {
    system.push({
      type: "text",
      text: input.familyOverlay,
      cache_control: { type: "ephemeral" },
    });
  }
  // Payment-method overlay (BNPL / Klarna / Affirm). Sits between the
  // family overlay and the reason module so it can override card-framing
  // in the module's guidance. Only emitted for non-card disputes.
  if (input.paymentOverlay && input.paymentOverlay.trim().length > 0) {
    system.push({
      type: "text",
      text: input.paymentOverlay,
      cache_control: { type: "ephemeral" },
    });
  }
  system.push({
    type: "text",
    text: input.reasonCodeModule.promptBody,
    cache_control: { type: "ephemeral" },
  });
  if (input.strategies && input.strategies.length > 0) {
    const strategyBundle = input.strategies
      .map((s) => s.promptBody)
      .filter((body) => body.trim().length > 0)
      .join("\n\n---\n\n");
    if (strategyBundle.length > 0) {
      system.push({
        type: "text",
        text: strategyBundle,
        cache_control: { type: "ephemeral" },
      });
    }
  }

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

    const strategyKeys = (input.strategies ?? []).map((s) => s.key);
    if (callRes.error || !callRes.raw) {
      await writeRun(sb, ctx, {
        model,
        packageMode: input.packageMode,
        promptTokens: callRes.promptTokens,
        completionTokens: callRes.completionTokens,
        durationMs: callRes.durationMs,
        validationStatus: "error",
        strategyKeys,
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
        strategyKeys,
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
      strategyKeys,
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
 *  no raw Shopify JSON keys appear.
 *
 *  CONTRACT — bank-inclusion predicates live in `factClassifier.ts` only.
 *  Do NOT add new "should this reach the bank?" predicates here. The
 *  filter below re-reads `submissionRisk` + `includeInBankNarrative`,
 *  both of which are set by `factClassifier.classifyFact()`. If a future
 *  rule says "fact X must not be cited as positive bank evidence,"
 *  encode it in the classifier so every consumer (UI `EvidenceLineItem`,
 *  PDF Evidence Basis rows, this LLM payload) agrees by construction.
 *  Test `narrativeWriter.bankInclusionInvariant.test.ts` locks in that
 *  every fact in the payload satisfies the classifier's contract. */
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
      claimType: input.reasonCodeModule.claimType,
      prioritize: input.reasonCodeModule.prioritize,
      avoid: input.reasonCodeModule.avoid,
      mustNotClaim: input.reasonCodeModule.mustNotClaim,
      criticalCategories: input.reasonCodeModule.criticalCategories,
      allowedFactCategories: input.reasonCodeModule.allowedFactCategories,
    },
    // Phase 3 telemetry: the strategy keys selected for this dispute.
    // Useful context for the model ("the user has decided these
    // framings apply") and persisted alongside the run row for
    // post-hoc analysis. Empty array when no family strategies
    // qualified (or the family has none declared yet).
    strategyKeys: (input.strategies ?? []).map((s) => s.key),
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
    strategyKeys: string[];
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
    strategy_keys: row.strategyKeys,
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
