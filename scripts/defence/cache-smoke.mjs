#!/usr/bin/env node
/**
 * G1 gate (Phase 3) — prompt-cache utilisation smoke test.
 *
 * Confirms that with 4 cached system blocks (BASE_SYSTEM_PROMPT,
 * family overlay, module promptBody, strategy bundle) the static
 * prefix (blocks 0–2) actually gets re-used by Anthropic's cache
 * across ≥20 representative dispute fixtures.
 *
 * Pass criterion (per PRD §3 / Phase 3 entry gate):
 *   ≥80% of calls report cache_read_input_tokens > 0 covering the
 *   shared base + family + module prefix.
 *
 * If the gate fails, concatenate base+family+module into a single
 * block before shipping Phase 3 to prod. (The strategy bundle stays
 * separate because its content varies per dispute.)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/defence/cache-smoke.mjs
 *
 * The script invokes the Anthropic Messages API directly so it
 * doesn't require any Supabase config — just a real API key with
 * spending budget. Estimated cost ≈ $0.50 with claude-sonnet-4-6
 * across 20 fixtures (~3k input tokens each, mostly cached after
 * the first call).
 *
 * Output: a JSON summary on stdout + a one-line PASS/FAIL verdict
 * on stderr. Exit code 0 on PASS, 1 on FAIL.
 */

import process from "node:process";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY not set — cache-smoke needs live API access.");
  process.exit(2);
}

const MODEL = process.env.DEFENCE_CACHE_SMOKE_MODEL ?? "claude-sonnet-4-6";
const FIXTURE_COUNT = Number(process.env.DEFENCE_CACHE_SMOKE_COUNT ?? "20");
const CACHE_HIT_THRESHOLD = Number(
  process.env.DEFENCE_CACHE_SMOKE_THRESHOLD ?? "0.8",
);

// Load the REAL production system blocks so the smoke test exercises
// the same cache behaviour prod calls will see. Anthropic's prompt
// cache has a 1024-token minimum prefix; toy blocks (~30 tokens) cache
// at 0% even when the architecture is correct. Reading the actual
// BASE_SYSTEM_PROMPT (~1.5k tokens) and a real module promptBody
// (~600 tokens) clears the threshold.
import { readFileSync } from "node:fs";

function extractBaseSystemPrompt() {
  const src = readFileSync("lib/defence/narrativeWriter.ts", "utf8");
  const m = src.match(/BASE_SYSTEM_PROMPT = `([\s\S]*?)`/);
  if (!m) throw new Error("Could not extract BASE_SYSTEM_PROMPT");
  return m[1];
}

function extractModulePromptBody(moduleFile) {
  const src = readFileSync(moduleFile, "utf8");
  const m = src.match(/promptBody:\s*\[([\s\S]*?)\]\.join\(/);
  if (!m) throw new Error(`Could not extract promptBody from ${moduleFile}`);
  // Pull each "..." string literal out of the array source and join with \n
  const lines = Array.from(m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((x) =>
    x[1].replace(/\\"/g, '"'),
  );
  return lines.join("\n");
}

const BASE_BLOCK = extractBaseSystemPrompt();
const FAMILY_BLOCK =
  "FAMILY OVERLAY — unauthorized_fraud: " +
  "The reason code is the BANK's claim, not a merchant-asserted fact. " +
  "Frame the representment so the argument stands as 'consistent with a cardholder-authorized transaction' " +
  "rather than asserting the cardholder lied or that the reason code itself is invalid. " +
  "Cross-family reminder: every claim in the rendered text must trace to an approved fact id; " +
  "the bank-facing PDF is validated end-to-end (forbidden phrases + claim guards + fact-templated thesis) " +
  "before any bytes hit storage.";
const MODULE_BLOCK = extractModulePromptBody(
  "lib/defence/reasonCodes/visa_10_4_fraud.ts",
);

const STRATEGY_BODIES = [
  // Mirrors the 4 unauthorized_fraud strategies — vary per fixture so
  // the strategy bundle block changes call-to-call (like prod).
  "STRATEGY FOCUS — authentication signal stack: lead with 3-D Secure / AVS+CVV match, frame as 'consistent with' not 'proves'.",
  "STRATEGY FOCUS — repeat customer pattern: cite prior order count, disputeFreeHistory, frame as 'continuing relationship'.",
  "STRATEGY FOCUS — customer engagement history: cite messageCount, lastMessageAt; never claim 'admitted'.",
  "STRATEGY FOCUS — narrow fallback: hedged framing, ≤4 sentences in exec summary, cite only approved facts.",
];

function strategyBlock(i) {
  return STRATEGY_BODIES[i % STRATEGY_BODIES.length];
}

process.stderr.write(
  `[cache-smoke] base=${BASE_BLOCK.length}c family=${FAMILY_BLOCK.length}c module=${MODULE_BLOCK.length}c\n`,
);

async function callOnce(i) {
  const body = {
    model: MODEL,
    max_tokens: 200,
    system: [
      { type: "text", text: BASE_BLOCK, cache_control: { type: "ephemeral" } },
      { type: "text", text: FAMILY_BLOCK, cache_control: { type: "ephemeral" } },
      { type: "text", text: MODULE_BLOCK, cache_control: { type: "ephemeral" } },
      { type: "text", text: strategyBlock(i), cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          fixture: i,
          approvedFacts: [{ id: "f0", category: "payment_authentication", value: { avsResult: "Y", cvvResult: "M" } }],
          packageMode: "narrow",
        }),
      },
    ],
  };
  const started = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const durationMs = Date.now() - started;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const usage = data.usage ?? {};
  return {
    i,
    durationMs,
    inputTokens: usage.input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

async function main() {
  const results = [];
  for (let i = 0; i < FIXTURE_COUNT; i += 1) {
    process.stderr.write(`[cache-smoke] call ${i + 1}/${FIXTURE_COUNT}...\r`);
    const r = await callOnce(i);
    results.push(r);
  }
  process.stderr.write("\n");

  // First call seeds the cache; cache_read should ramp up from call 2.
  const seededCalls = results.slice(1);
  const hits = seededCalls.filter((r) => r.cacheReadTokens > 0);
  const hitRate = hits.length / seededCalls.length;
  const summary = {
    model: MODEL,
    fixtureCount: FIXTURE_COUNT,
    threshold: CACHE_HIT_THRESHOLD,
    hitRate,
    seededCalls: seededCalls.length,
    hits: hits.length,
    avgCacheReadTokens:
      hits.reduce((sum, r) => sum + r.cacheReadTokens, 0) / Math.max(hits.length, 1),
    avgInputTokens:
      results.reduce((sum, r) => sum + r.inputTokens, 0) / results.length,
    perCall: results,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (hitRate >= CACHE_HIT_THRESHOLD) {
    process.stderr.write(
      `[cache-smoke] PASS — ${(hitRate * 100).toFixed(1)}% cache hits ≥ ${(CACHE_HIT_THRESHOLD * 100).toFixed(0)}%\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(
      `[cache-smoke] FAIL — ${(hitRate * 100).toFixed(1)}% cache hits < ${(CACHE_HIT_THRESHOLD * 100).toFixed(0)}%. Consider concatenating base+family+module into a single cached block.\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[cache-smoke] FATAL ${err.message}\n`);
  process.exit(2);
});
