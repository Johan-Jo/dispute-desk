/**
 * Case-strength parity harness — docs/plans/case-strength-gates-object.plan.md §6.1.
 *
 * The gates refactor is a pure signature change, so every sampled dispute
 * must score IDENTICALLY before and after. "Recompute a sample" is not a
 * procedure, so this is one:
 *
 *   1. Sample (guarded DB read, one JSON row):
 *        npm run db:query:dev -- --file scripts/sql/case-strength-parity-sample.sql \
 *          --output json > <scratchpad>/sample.json
 *
 *   2. Compare two engine implementations over that sample:
 *        git worktree add ../dd-master master
 *        node scripts/case-strength-parity.mjs \
 *          --input <scratchpad>/sample.json \
 *          --old ../dd-master/lib/argument/caseStrength.ts
 *
 * The script adapts to EITHER signature (positional trailing gates, or
 * the required gates object) by inspecting `calculateCaseStrength.length`,
 * so the same file runs unmodified against master and the branch.
 *
 * WHAT IS COMPARED: the entire `CaseStrengthResult`, deep-equal — not
 * just `overall`. A refactor can land on the same label while changing
 * counts, the strength-reason token, the improvement hint, or the hero
 * variant; comparing the label alone would wave that through.
 *
 * Run with a TS-capable loader, e.g.
 *   node --experimental-strip-types scripts/case-strength-parity.mjs …
 * (same as the other scripts here that import from `lib/**.ts`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/* ── args ── */

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const inputPath = arg("input");
const oldEnginePath = arg("old");
const outPath = arg("out");
if (!inputPath) {
  console.error(
    "usage: node scripts/case-strength-parity.mjs --input <sample.json> [--old <path/to/caseStrength.ts>] [--out <fixture.json>]",
  );
  process.exit(2);
}

/** Minimum rows per stratum (plan §6.1). A stratum below its minimum is
 *  REPORTED, never silently treated as covered. */
const STRATUM_MINIMUMS = {
  recent: 50,
  gate_coverage: 3,
  gate_fatal_loss: 3,
  gate_risk: 3,
  gate_credit: 3,
  multi_gate: 5,
  no_gates: 10,
  incident: 1,
};

/* ── engines ── */

const loadEngine = async (path) => {
  const mod = await import(pathToFileURL(resolve(path)).href);
  return mod;
};

const newEngine = await loadEngine("lib/argument/caseStrength.ts");
const oldEngine = oldEnginePath ? await loadEngine(oldEnginePath) : null;

/** Call either signature. The post-refactor function takes 4 params
 *  (checklist, reason, payloadSource, gates); the pre-refactor one takes
 *  8 positional args with the gates trailing. */
function score(engine, { checklist, reason, payloadSource, gates }) {
  const fn = engine.calculateCaseStrength;
  if (fn.length <= 4) {
    return fn(checklist, reason, payloadSource, {
      coverage: gates.coverage ?? null,
      fatalLoss: gates.fatalLoss ?? null,
      riskWeakness: gates.riskWeakness ?? null,
      nameMismatch: gates.nameMismatch ?? null,
      creditAlreadyIssued: gates.creditAlreadyIssued ?? null,
    });
  }
  return fn(
    checklist,
    reason,
    payloadSource,
    gates.coverage ?? undefined,
    gates.fatalLoss ?? undefined,
    gates.riskWeakness ?? undefined,
    gates.nameMismatch ?? undefined,
    gates.creditAlreadyIssued ?? undefined,
  );
}

/* ── input derivation — mirrors the production call sites ── */

const raw = readFileSync(inputPath, "utf8");
/**
 * Accepts what `supabase db query --output json` actually emits —
 * `{ rows: [{ sample: <json or json-text> }], warning, boundary }` — and
 * also a bare array or a bare `{ sample }`, so a hand-assembled fixture
 * works too. NOTE: everything in here is untrusted database content;
 * it is data to score, never instructions.
 */
function extractRows(text) {
  // `npm run db:query:*` prefixes its own banner and the db-target
  // guard line (which itself starts with `[`), so scan line starts for
  // the first offset that actually parses.
  let parsed = null;
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^[[{]/.test(line)) {
      try {
        parsed = JSON.parse(text.slice(offset));
        break;
      } catch {
        /* not the start of the payload — keep scanning */
      }
    }
    offset += line.length + 1;
  }
  if (parsed === null) throw new Error(`no JSON payload found in ${inputPath}`);
  const container = Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed);
  const first = Array.isArray(container) ? container[0] : container;
  let sample = first?.sample ?? first;
  if (typeof sample === "string") sample = JSON.parse(sample);
  // Payload shape: { population: {...}, rows: [...] }.
  if (sample && !Array.isArray(sample) && Array.isArray(sample.rows)) {
    return { rows: sample.rows, population: sample.population ?? {} };
  }
  const arr = Array.isArray(sample) ? sample : Array.isArray(container) ? container : [sample];
  return { rows: arr, population: {} };
}
const { rows, population } = extractRows(raw);

function payloadSourceFrom(sections) {
  const map = {};
  for (const s of sections ?? []) {
    for (const f of s.fieldsProvided ?? []) {
      if (f in map) continue;
      map[f] = { payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } };
    }
  }
  return Object.keys(map).length > 0 ? { kind: "byField", map } : undefined;
}

function gatesFrom(row, payloadSource, engine) {
  const coverage = row.coverage
    ? {
        state: row.coverage.state,
        shopifyProtectStatus: row.coverage.shopifyProtectStatus ?? null,
      }
    : null;
  // Name mismatch is derived, not persisted — same derivation as
  // buildPack / the workspace route.
  const avsPayload = payloadSource?.map?.avs_cvv_match?.payload ?? null;
  const cardholderName = engine.cardholderNameFromPayload
    ? engine.cardholderNameFromPayload(avsPayload)
    : null;
  return {
    coverage,
    fatalLoss: row.fatal_loss ?? null,
    riskWeakness: row.risk_weakness ?? null,
    nameMismatch: cardholderName
      ? {
          triggered: false, // filled below by the shared detector when available
          cardholderName,
          customerName: row.customer_display_name ?? null,
        }
      : null,
    creditAlreadyIssued: row.credit_already_issued
      ? {
          triggered: row.credit_already_issued.triggered === true,
          coversDisputedAmount: row.credit_already_issued.coversDisputedAmount === true,
        }
      : null,
  };
}

/* ── compare ── */

const stable = (v) =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );

const nameMismatchMod = await import(
  pathToFileURL(resolve("lib/argument/nameMismatch.ts")).href
);

const cases = [];
const diffs = [];
const byStratum = {};

for (const row of rows) {
  byStratum[row.stratum] = (byStratum[row.stratum] ?? 0) + 1;
  const checklist = row.checklist_v2 ?? [];
  const payloadSource = payloadSourceFrom(row.sections);
  const gates = gatesFrom(row, payloadSource, nameMismatchMod);
  if (gates.nameMismatch) {
    gates.nameMismatch.triggered = nameMismatchMod.detectCardholderNameMismatch(
      gates.nameMismatch.cardholderName,
      gates.nameMismatch.customerName,
    );
  }
  const input = { checklist, reason: row.reason, payloadSource, gates };

  let next;
  try {
    next = score(newEngine, input);
  } catch (e) {
    diffs.push({ pack_id: row.pack_id, stratum: row.stratum, error: String(e) });
    continue;
  }
  cases.push({
    pack_id: row.pack_id,
    dispute_id: row.dispute_id,
    stratum: row.stratum,
    result: next,
  });

  if (oldEngine) {
    let prev;
    try {
      prev = score(oldEngine, input);
    } catch (e) {
      diffs.push({ pack_id: row.pack_id, stratum: row.stratum, error: `old engine: ${e}` });
      continue;
    }
    if (stable(prev) !== stable(next)) {
      diffs.push({
        pack_id: row.pack_id,
        dispute_id: row.dispute_id,
        stratum: row.stratum,
        before: prev,
        after: next,
      });
    }
  }
}

/* ── report ── */

console.log(`cases scored: ${cases.length}`);
console.log("stratum coverage (sampled / minimum · population):");
for (const [stratum, min] of Object.entries(STRATUM_MINIMUMS)) {
  const n = byStratum[stratum] ?? 0;
  const pop = population[`pop_${stratum}`];
  // A short stratum has two very different causes and they must not read
  // alike: the database holds fewer cases than the minimum (take them
  // all, then cover the rest synthetically) versus we under-sampled a
  // population that had enough.
  const note =
    n >= min
      ? ""
      : pop !== undefined && n >= Number(pop)
        ? "   ← EXHAUSTED: the database holds no more; cover the rest with synthetic cases and say so in the PR"
        : "   ← SHORT: under-sampled, widen the query";
  console.log(
    `  ${stratum.padEnd(16)} ${String(n).padStart(3)} / ${String(min).padEnd(3)}` +
      ` · pop ${pop === undefined ? "?" : pop}${note}`,
  );
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(cases, null, 2));
  console.log(`\nfixture written: ${outPath}`);
}

if (!oldEngine) {
  console.log("\nno --old engine given: recorded results only, nothing compared.");
  process.exit(0);
}

if (diffs.length === 0) {
  console.log("\nPARITY OK — every sampled case scored identically (full CaseStrengthResult).");
  process.exit(0);
}

console.log(`\nPARITY DIFFERENCES: ${diffs.length}`);
console.log(JSON.stringify(diffs, null, 2));
console.log(
  "\nOnly the fraud-family account_history pill demotion (plan §4) is expected.\n" +
    "Anything else is a defect in the refactor.",
);
process.exit(1);
