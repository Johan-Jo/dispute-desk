# Scale Readiness — 100-Merchant Job & LLM Pipeline Plan

**Status:** proposed (2026-07-23)
**Origin:** Blume Box onboarding hit the per-shop daily LLM cap (30 defence packages failed terminal, manual requeue required, no notification), which surfaced the broader question: does the async pipeline scale to +100 merchants? Analysis answer: the architecture (SKIP LOCKED claim, per-shop concurrency isolation, priority tiers) scales; the fixed throughput settings and cap failure-handling do not.

## Baseline facts (measured 2026-07-22/23, prod)

- Worker: Vercel cron `*/2 * * * *` → one invocation claims **5 jobs** (`claimJobs(workerId, 5)`) and runs them **sequentially** (`app/api/jobs/worker/route.ts`). Global ceiling ≈ **150 jobs/hour**, all shops combined.
- Per-shop concurrency: `MAX_CONCURRENT_PER_SHOP = 1`, enforced inside the `claim_jobs` RPC (SKIP LOCKED). One shop's backfill cannot monopolize the fleet; multiple workers are safe by construction.
- Measured: 30 `build_defence_package` jobs drained in ~50 min (~1 job/100s effective).
- Hourly `sync-disputes` cron is per-shop work: at 100 shops ≈ 100 jobs/hour → **~2/3 of the entire global ceiling consumed by sync alone**.
- LLM cap (`lib/defence/narrativeWriter.ts`): per shop per UTC day, `100 gens OR 50k input tokens`. Measured ~1,060 input tokens/gen → the token cap binds at **~47 gens**, half the advertised gen cap.
- Cap-hit today is **terminal**: `defence_packages.status='failed'` + `failure_code='daily_cap_reached'`; an immutability trigger forbids `failed → draft`, and the build handler only accepts `draft` — so cap-failed packages never self-heal after the midnight-UTC reset. Manual requeue script: `scripts/sql/requeue-cap-failed-defence-packages.sql`.
- No global (cross-shop) LLM spend ceiling or alarm exists. 100 shops × 50k tokens/day = ~5M input tokens/day theoretical exposure.
- Merchant-facing copy for a cap-hit is "Validation failed" — wrong and alarming.

## Sequencing

Phases 1–2 touch `lib/jobs/claimJobs.ts`, `lib/jobs/handlers/*`, `lib/jobs/priorities.ts` — the same files as Phase 0's in-flight branch, so Phase 0 lands first; each later phase branches off `develop`. Ship order: P0 → P1 → P2 → P3/P4 (independent) → P5. Every phase: PR → `develop` (staging soak) → prod only with explicit per-change approval (CLAUDE.md #9).

---

## Phase 0 — Land the interactive job-priority PR (in flight)

The existing `fix/interactive-job-priority` branch: merchant-click chains run at `JOB_PRIORITY_INTERACTIVE = 20` with chain inheritance, backfills at ≥500, so interactive work never queues behind bulk imports. This is the fairness half of scale readiness — Phase 1 raises total throughput, Phase 0 guarantees who goes first when the queue is deep. Finish, PR, land on `develop`, then promote per the normal prod gate.

**Acceptance:** existing branch's tests green; a priority-20 job enqueued mid-backfill claims within 2 worker ticks on staging.

---

## Phase 1 — Worker throughput (the big lever)

**Goal:** ~10–20× drain rate without new infrastructure.

1. Raise claim limit from 5 to `WORKER_CLAIM_LIMIT` env (default 20).
2. Execute claimed jobs **concurrently** with `Promise.allSettled`, replacing the sequential `for` loop. Refactor the `switch` into a handler map (`Record<jobType, handler>`) so the dispatch is data, not control flow.
3. **Verify (not assume) the RPC's batch semantics:** `claim_jobs` must not hand out two jobs for the same shop *within one claimed batch* (per-shop cap must count rows claimed in the same statement, not just already-`running` rows). Read `supabase/migrations/*claim_jobs*` and add a regression test / fix the SQL if it only checks `running`.
4. Bound per-invocation wall-clock: keep `maxDuration = 300`; with concurrency 20 the batch takes max(job) not sum(jobs), so the existing 240s self-checkpoint convention for long jobs is unchanged.
5. Concurrency safety audit of shared handler state (module-level caches, rate-limited Shopify clients): handlers were written for sequential execution; sweep for anything that assumes it.

**Acceptance:** synthetic 200-job queue across ≥10 fake shops drains ≥10× faster in a staging test; no shop ever has 2 running jobs (assert via `jobs` table snapshot during drain).

**Est:** ~30-line worker diff + handler-map refactor + RPC verification/possible migration + tests.

## Phase 2 — Cap-hit = deferral, not failure (+ ops notification)

**Goal:** hitting the daily LLM cap delays work to tomorrow; nobody has to notice, but the operator is told.

1. In `buildDefencePackageJob`: on `narrativeRes.capReached`, do **not** `markFailed`. Leave the package `draft`, and reschedule the *job*: `status='queued'`, `run_at = next UTC midnight + 5min + jitter(0–30min)`, **without burning an attempt** (new `markJobDeferred` in `lib/jobs/claimJobs.ts`; `markJobFailed`'s attempts-based backoff is wrong for a known 24h horizon).
2. Same treatment for the Gorgias analyzer's cap path (`enrichGorgiasCommsJob` / `relevanceAnalyzer`) — same class of bug, close the class.
3. Audit event `defence_package_cap_deferred` (shop, counts, tokens) on each deferral.
4. **Ops email** (existing admin-email plumbing, errors swallowed as elsewhere): sent on the **first** cap trip per shop per UTC day (dedupe by querying today's `defence_package_cap_deferred` events before sending). Content: shop, gens/tokens consumed, number of deferred packages, resume time.
5. Rebalance defaults so the advertised cap is the binding one: `DEFENCE_PACKAGE_DAILY_TOKEN_CAP` default 50k → **150k** (100 gens × ~1.1k tokens + headroom). Env override unchanged. *(Decision point: confirm the ~3× LLM spend ceiling per shop-day is acceptable.)*
6. Merchant-facing copy: cap-deferral renders as its own state — "Evidence package generation resumes tomorrow (daily generation budget reached)" — not "Validation failed". i18n tokens per structural rule (CLAUDE.md #5), translated for all 6 locales in the same PR.
7. Retire the manual path: keep `scripts/sql/requeue-cap-failed-defence-packages.sql` for any rows that failed *before* this ships (one final sweep on deploy), note in the script header that new code no longer produces `daily_cap_reached` failures.

**Acceptance:** vitest — cap-reached run leaves package `draft`, job requeued with tomorrow's `run_at`, attempts unchanged, exactly one email per shop-day; UI snapshot shows the deferred copy in all locales (`scripts/verify-i18n-parity.mjs` green).

## Phase 3 — Global LLM budget alarm (cost governance, no throttling)

1. Extend an existing daily cron (e.g. `snapshot-daily-metrics`) to sum the day's LLM usage across shops from `defence_package_runs` (+ Gorgias analyzer runs table).
2. Alert-only ops email when the fleet total exceeds `GLOBAL_LLM_DAILY_TOKEN_ALERT` (default e.g. 2M input tokens/day). No automatic throttling — a human decides.

**Acceptance:** unit test on the aggregation + threshold; manual staging fire with a low threshold.

## Phase 4 — Spread the hourly sync

1. In the `sync-disputes` cron, stagger enqueued jobs: `run_at = top-of-hour + (hash(shop_id) mod 55min)` — deterministic per shop, so each shop syncs at a stable minute and the 100-shop burst becomes a flat ~2 jobs/min trickle.
2. Leave webhook-driven syncs untouched (they're per-event, already spread).

**Acceptance:** test asserting stable per-shop offset and full-hour spread; staging: worker tick claim counts stay <50% of limit during the sync hour.

## Phase 5 — Load validation & guardrail docs

1. Staging load test: seed 20 synthetic shops × 50-job onboarding chains (`npm run seed:dev:synthetic-disputes` + a small seeder for jobs); measure drain time, interactive-job latency (a priority-20 job enqueued mid-drain must claim within 2 worker ticks).
2. Update `docs/technical.md` (worker concurrency model, cap-deferral semantics, global alarm) — same-commit rule.
3. Ops runbook snippet in `docs/technical.md`: what the cap-deferral email means, when to raise per-shop caps, how to read the global alarm.

## Explicit non-goals

- No queue-infrastructure swap (no SQS/Upstash/etc.) — Postgres SKIP LOCKED is nowhere near its limits at this scale.
- No per-shop cap *removal* — the cap protects against runaway-generation incidents (July 2026 hub-article account drain); it becomes invisible-when-healthy, not absent.
- No automatic global throttling — alarm + human decision only.

## Verification gate (every phase)

`npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`; staging soak on `develop`; explicit in-chat approval before any `master` merge.
