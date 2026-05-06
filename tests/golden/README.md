# Golden dispute fixtures

Deterministic regression tests that lock the **observable outputs** of the
evidence-strength engine, fatal-loss gate, coverage gate, and Shopify field
mapping for a small set of canonical dispute scenarios.

## Why

If a future refactor (AI-assisted or otherwise) silently changes the
classifier, scorer, or field mapper, these tests fail loudly with a clear
diff per fixture. They are pure-function tests — no Supabase, no Shopify
HTTP, no clocks. Same input → same output, every time.

## What is asserted

For each fixture we compute:

- `summarizeCoverage(order)` → `{ state, isCovered }`
- `detectFatalLoss(order, reason, amount)` → `{ triggered, reason }`
- `calculateCaseStrength(argMap, checklist, reason, payloadSource, coverage, fatalLoss)` →
  `{ overall, strongCount, moderateCount, supportingCount, heroVariant }`
- `buildEvidenceInputFromRaw(packSections)` → set of populated Shopify field
  keys (text bodies are NOT snapshotted — only key presence)

## What is intentionally NOT asserted

- Generated text bodies (`strengthReason`, rebuttal sentences) — these are
  composed from labels and are stable enough to read in a unit test, but
  brittle for a golden-style snapshot.
- Timestamps or any value derived from `Date.now()` / `new Date()`.
- The `score` weighted sum — derived from `strongCount * 3 + moderateCount * 2`;
  asserting both `score` and the counts is redundant and adds churn risk.

## Adding a new fixture

1. Add `tests/golden/fixtures/<short-name>.ts` exporting `fixture: GoldenFixture`.
2. Add `tests/golden/expected/<short-name>.expected.ts` exporting `expected: GoldenExpected`.
3. Add the pair to `tests/golden/fixtures/index.ts`.
4. Run `npm run test:golden`. If a deliberate behavior change made the new
   expected diverge from the engine, update the expected file in the **same
   commit** as the engine change.

## Running

```
npm run test:golden                 # filtered to tests/golden/
npm test                            # also runs golden tests as part of the full suite
```
