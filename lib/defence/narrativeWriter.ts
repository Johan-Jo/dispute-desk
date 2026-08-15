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

import { alwaysAdmissibleCategories } from "./alwaysAdmissible";
import { reachesLlmPayloadLegacy } from "./bankInclusion";
import { deriveClaimCapabilities } from "./claimCapabilities";
import { projectScreeningValueForBank } from "@/lib/argument/fraudScreeningSignals";
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
  StrategySubmodule,
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
// v10 (PR-C1, 2026-08-07): rule 14 — structural claim capabilities; the
// verified-address delivery claim is prohibited on every case.
// v11 (2026-08-11, AVS hotfix): the prompt contained four paths to the
// claim the C-12 validator refuses. 4 of 6 regenerations on 2026-08-11
// failed, every one on that rule.
//   * rule 7's worked example WAS the forbidden string ("…and the card
//     verification code matched the issuer's records"), so with a null
//     verificationSummary the model reproduced its own instructions;
//   * rule 8b offered two "softer" replacements that both asserted
//     card-verification evidence — on an AVS-only case they imply a CVV
//     result that does not exist, and the first names no code or value so
//     the CVV guard cannot catch it. REMOVED, not conditioned: rule 7 is
//     the whole contract;
//   * rule 14 forbade describing an address as verified/matched under any
//     circumstances, contradicting rule 7's licensed clause. Now scoped to
//     the DELIVERY DESTINATION, matching `isLicensedAvsClause`;
//   * `visa_10_4_fraud`'s module block, appended after this one, still said
//     "Prioritise … AVS+CVV match" and carried the same replacement
//     sentence. Fixed there, module version 7 → 8.
// v12 (2026-08-11, same day): reading the RUNTIME strings rather than the
// diff showed the fix still had the failure mechanism in it. Rule 7's null
// branch PRINTED all three observed failure forms as negative examples, and
// rule 14 printed the licensed clause twice as a RIGHT example. The model
// sees those strings on every call, including calls where the case carries
// no verificationSummary — which is exactly how the regression happened.
// Neither section now contains any concrete AVS, billing-address or
// security-code sentence, in either direction. The only permitted text on
// the subject is a verbatim copy of the runtime verificationSummary value.
// v13 (2026-08-11): rule 14 printed THREE address-delivery sentences as WRONG
// examples. The same mechanism as rule 7's v12 fix, one rule further down, and
// it survived that pass because only the AVS examples were removed. Three of
// four packages in the post-deploy canary failed on `unauthorized_claim` /
// address_delivery, in chronologyArgument, fulfillmentArgument and
// paymentAuthenticationArgument. No fact in those cases carried an address —
// the payload was clean, so the model was reproducing the prompt. The
// prohibition is now stated as a class; only the permitted form is
// illustrated.
// v14 (2026-08-13) — "destination" is an address.
// Rule 14 named addresses but never the OTHER nouns for a place, so
// "the goods reached their destination" read to the model as permitted while
// `classifyAddressDeliveryClaim` rates it `affirmative` (DESTINATION_TERMS has
// covered it all along). Five production packages failed on exactly that
// shape — #12936, #352555, #352236, #352220 (fulfillmentArgument) and #345459
// (conclusion) — every one a CLOSING sentence restating correctly worded
// evidence as an arrival. The rule now prohibits the class (destination,
// premises, residence, home, location) and says to stop at the evidence
// rather than summarise it. Still no forbidden example is printed: v13's
// finding was that printing one makes the model reproduce it.
// v15 (2026-08-15) — the summarising sections are not exempt.
// v14 named the class and told the model to stop at the evidence, and the
// empirical list it cited was fulfillmentArgument and conclusion. It did not
// name executiveSummary, and "stop at the evidence" is close to
// self-contradictory in a section that exists to restate — so the model was
// told to summarise and told not to summarise, and resolved it the way the
// section's purpose pointed. Package 6b47d368 (dispute 70c0a077, order
// #352554) failed on exactly that, in executiveSummary AND fulfillmentArgument,
// AFTER a retry, at prompt 14 / validator 2 — the one failure in the 25-case
// rebuild batch of 2026-08-15. The rule now binds the summarising sections by
// name and gives them somewhere else to close: a section with a job it cannot
// do without breaking a rule will break the rule.
const PROMPT_VERSION = 15;

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
   (e.g. "the carrier confirmed delivery on 2026-05-12, tracking
   1234567890 (PostNord)", "the customer
   confirmed receipt on 2026-05-13"). State the relationship between
   fact and reason code explicitly (e.g. "These authentication results
   are consistent with a cardholder-initiated transaction under Visa 10.4.").

   PAYMENT AUTHENTICATION CODES (AVS / CVV) — DO NOT quote the raw
   single-letter gateway result codes ("Y", "M", "N", "Z", "A", "W",
   "X", etc.) in any merchant prose. Raw letter codes look unhinged in
   bank-facing prose and force the reader to look up the AVS/CVV
   reference.

   QUOTE verificationSummary VERBATIM. It is the ONLY approved wording
   for address or security-code verification. Do not paraphrase it, do
   not extend it, and do not write address- or security-code language
   that is not in it.

   IF verificationSummary IS NULL OR ABSENT: the case has no citable
   verification. OMIT THE ENTIRE SUBJECT. Write nothing asserting that
   an address, a billing detail or a security code was checked,
   verified, matched, confirmed, accepted, on record or in agreement
   with anything — in any wording, in any section. Do not hedge it
   either: a softened, qualified or "consistent with" version of an
   unsupported assertion is the same assertion. Argue the case from the
   facts you do have.

   NO EXAMPLE SENTENCES ARE GIVEN HERE, in either direction. Concrete
   claim text in this prompt is what produced the failure this rule
   exists to prevent: printed as an illustration, it was reproduced as
   output on cases that did not carry the evidence. The only text you
   may write on this subject is a verbatim copy of the runtime value of
   verificationSummary.

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
   the card", or that the "card was physically present". Card-not-present
   evidence does not establish physical possession — and the reason it does
   not is NOT a licence to describe what it does establish instead. Any
   statement about what was verified, checked or held on record is governed
   by rule 7 and by nothing else.

   NO REPLACEMENT SENTENCE IS OFFERED, and none is quoted here — a
   prompt that prints the sentence it is banning teaches that sentence.
   The suggestions that used to sit at this point all asserted
   card-verification evidence, so on an address-only case they implied
   a security-code result that did not exist. Rule 7 is the whole
   contract: quote verificationSummary verbatim and add nothing. If you
   cannot say it by quoting, do not say it.

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
    and add an entry to omittedSections.

14. CLAIM CAPABILITIES. The payload carries a \`claimCapabilities\` array —
    the claim classes this case is AUTHORIZED to make, derived from the
    approved facts. A claim class absent from that array must not appear in
    any section, in any wording.

    "address_delivery" is NOT authorized on any case today. You must never
    state, imply, or paraphrase that a delivery occurred AT a particular
    physical address, and never characterise the DELIVERY DESTINATION at all —
    not as verified, matched, confirmed, the cardholder's, the customer's own,
    held on record, nor as corresponding to any other address on the order.
    DisputeDesk holds no evidence connecting a delivery event to an address,
    so there is nothing true you can say about where the parcel went.

    NO EXAMPLE OF THE FORBIDDEN SENTENCE IS PRINTED HERE. Three were, until
    2026-08-11, and the model reproduced them: three of four packages in that
    day's canary failed on this rule, in the very sections the examples were
    written for. An illustration of a banned claim is still an instance of the
    claim, sitting in the context window on every call.

    WHAT THIS RULE DOES NOT PROHIBIT. Rule 7's standalone
    payment-authentication clause stays permitted — a verbatim copy of the
    runtime verificationSummary, presented as an AUTHENTICATION statement and
    nothing else. What is forbidden is COUPLING that clause to a delivery, so
    that the address becomes a destination. Authentication and delivery are
    claims about different facts and different evidence.

    The same distinction is enforced structurally by \`isLicensedAvsClause\`: a
    clause opening in a destination role — a directional preposition
    introducing the delivery predicate's argument — is refused however it goes
    on to read. So the copied clause may stand on its own; it may not become
    the place something was delivered to. No sample sentence is printed here
    for either case, for the reason rule 7 gives.

    Permitted delivery wording (when a delivery fact is approved): the
    carrier name, the tracking number, the tracking URL, the delivery status,
    and the delivery date. A captured signature may be cited only when the
    fact carries signedByName.
    Only the PERMITTED form is illustrated, because a positive template can be
    copied safely and carries no address:
      RIGHT → "the carrier confirmed delivery on 12 May 2026 (PostNord,
               tracking 1234567890)"
      RIGHT → "the carrier recorded a signature on delivery"

    A PLACE IS AN ADDRESS, WHATEVER YOU CALL IT. The prohibition is on
    asserting that the parcel ARRIVED SOMEWHERE, not on the word "address".
    Nouns naming where it ended up — destination, premises, residence, home,
    location — are the same claim and are equally forbidden. The delivery
    fact records that the carrier marked the shipment delivered; it does not
    record where, and the where cannot be proven from it.

    DO NOT CLOSE A SECTION BY RESTATING THE DELIVERY AS AN ARRIVAL. Once you
    have cited carrier, tracking number and date, the fulfilment point is
    made. A summarising final sentence adds no fact, and it is where this
    claim keeps appearing: measured on production 2026-08-13, five packages
    failed validation on precisely this shape — four in fulfillmentArgument,
    one in conclusion, every one a closing arrival sentence written AFTER
    correctly worded evidence. Stop at the evidence.

    THE SUMMARISING SECTIONS ARE NOT EXEMPT — executiveSummary LEAST OF ALL.
    "Stop at the evidence" can read as a contradiction in a section whose whole
    purpose is to restate, so state it plainly: executiveSummary and conclusion
    are bound by this rule exactly as fulfillmentArgument is. Measured on
    production 2026-08-15, a package failed on this shape in executiveSummary
    and fulfillmentArgument TOGETHER, after a retry, on a case whose delivery
    evidence was otherwise worded correctly — the summary reached for an
    arrival precisely because summarising is what the section is for.
    A summary may restate the delivery in the permitted form above, verbatim if
    need be. What it may not do is convert that evidence into a statement about
    where the parcel ended up. If the permitted form feels too thin to close on,
    close on something else — the authorisation, the account history, the
    absence of a return — or close on nothing.

    If a section has no fact that can be expressed in that permitted form,
    return an empty string for it and list it in omittedSections (rules 9 and
    13). An empty section is correct; a section filled with a claim about
    where the parcel went is not.

    This is enforced structurally after generation. A section that makes an
    unauthorized claim fails validation and the package is not filed.`;

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
        narrative: applySectionSuppression(parsed, input.strategies),
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
  // Filter: never expose submission-risk facts unless includeInBankNarrative
  // override. Delegated to `lib/defence/bankInclusion.ts`, which owns the rule
  // AND names this call site's divergence from it (C-1): the payload filter is
  // strictly weaker than `isBankIncludedFact`, and converging the two changes
  // what the model sees on live disputes — a reviewed change with a measured
  // delta, not a silent one. Behaviour here is unchanged.
  /* SCREENING VERIFICATION PHRASES NEVER ENTER THE PAYLOAD.
   *
   * `value` used to pass through unchanged, so a `fraud_screening` fact
   * carried Shopify's raw `positiveFacts` — including sentences asserting an
   * address match or a correct card code — straight into the context window.
   * The model was shown the forbidden assertion AS EVIDENCE and then refused
   * when it repeated it. Removing those strings from the system prompt did not
   * touch this path.
   *
   * The classification is `lib/argument/fraudScreeningSignals.ts`, shared with
   * the Evidence Basis row, so the model is never asked to decide which of its
   * own inputs are safe to quote. A fact whose signals were ALL verification
   * assertions is dropped entirely — an empty corroborator corroborates
   * nothing. */
  const approvedFacts = input.approvedFacts
    .filter(reachesLlmPayloadLegacy)
    .map((f) => ({
      id: f.id,
      category: f.category,
      label: f.label,
      strength: f.strength,
      value: projectScreeningValueForBank(f.value),
    }))
    .filter((f) => f.value !== null);

  // Some facts are admissible under ANY claim type and must not be gated on
  // the reason code, because the reason code comes from the BANK's label and
  // the label is demonstrably unreliable (see lib/defence/alwaysAdmissible.ts
  // for the admission test, the members, and what is deliberately excluded).
  const admitted = alwaysAdmissibleCategories(input.approvedFacts);
  const allowedFactCategories = admitted.length
    ? [
        ...input.reasonCodeModule.allowedFactCategories,
        ...admitted.filter(
          (c) => !input.reasonCodeModule.allowedFactCategories.includes(c),
        ),
      ]
    : input.reasonCodeModule.allowedFactCategories;

  return {
    packageId: input.packageId,
    disputeId: input.disputeId,
    reasonCode: input.reasonCode,
    packageMode: input.packageMode,
    caseStrength: input.caseStrength,
    // PR-C1 — structural claim authorization. Derived from the SAME approved
    // facts the validator re-derives from, so the model is shown exactly the
    // claim classes the case holds and nothing else. `address_delivery` is
    // absent on every case today.
    claimCapabilities: [...deriveClaimCapabilities(input.approvedFacts)].sort(),
    reasonCodeGuidance: {
      key: input.reasonCodeModule.key,
      displayName: input.reasonCodeModule.displayName,
      claimType: input.reasonCodeModule.claimType,
      prioritize: input.reasonCodeModule.prioritize,
      avoid: input.reasonCodeModule.avoid,
      mustNotClaim: input.reasonCodeModule.mustNotClaim,
      criticalCategories: input.reasonCodeModule.criticalCategories,
      allowedFactCategories,
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

/**
 * Blank the sections an active strategy declares it suppresses.
 *
 * The output schema has a FIXED section list, so the model writes into
 * every section that exists — including ones the active strategy has
 * told it not to argue. On blume-box 162042cd the credit-already-issued
 * strategy is exclusive and its prompt forbids arguing authorization,
 * and the model still produced a `paymentAuthenticationArgument`
 * (softened to "supporting context only", but present) on a case with a
 * failed AVS and a cardholder-name mismatch.
 *
 * Prompt instructions are a request. This is the enforcement: after
 * parsing, suppressed sections are emptied and recorded in
 * `omittedSections` so the PDF and the reviewer see a stated omission
 * rather than a silent gap.
 */
function applySectionSuppression(
  narrative: DefenceNarrativeOutput,
  strategies: StrategySubmodule[] | undefined,
): DefenceNarrativeOutput {
  const suppressed = new Set<string>();
  for (const s of strategies ?? []) {
    for (const key of s.suppressesSections ?? []) suppressed.add(key);
  }
  if (suppressed.size === 0) return narrative;

  const out = { ...narrative };
  const omitted = [...(narrative.omittedSections ?? [])];
  for (const key of suppressed) {
    const section = (out as unknown as Record<string, unknown>)[key] as
      | NarrativeSection
      | undefined;
    // Nothing to strip when the model already left it empty.
    if (!section || section.text.trim().length === 0) continue;
    (out as unknown as Record<string, unknown>)[key] = {
      text: "",
      usedFactIds: [],
    } satisfies NarrativeSection;
    if (!omitted.some((o) => o.sectionKey === key)) {
      omitted.push({
        sectionKey: key as (typeof omitted)[number]["sectionKey"],
        reason:
          "Suppressed: the active strategy argues a different theory, and " +
          "presenting this section alongside it would hedge two arguments.",
      });
    }
  }
  out.omittedSections = omitted;
  return out;
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
