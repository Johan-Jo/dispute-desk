# Plan A — Stuck backfill jobs & historical-import gap recovery

**Status:** proposed
**Author:** investigation 2026-07-02
**Trigger:** cay-collective (`c497df8d-…`) has 42 of 65 dispute orders missing from `shopify_orders`, despite a "read_all_orders" import that reached 5,905 rows.

---

## 1. What actually happened (root cause, proven)

The historical order backfill for cay-collective **stalled at 2025-09-11 and never resumed.** Evidence:

- `shops.historical_import_status = 'in_progress'` (never flipped to `complete`), `processed = 5800`, `completed_at = null`.
- One `backfill_shop_orders` job stuck in **`status = 'running'` since 13:04 UTC** — locked ~52 min at time of inspection, far past the 240 s soft budget / 300 s worker `maxDuration`. It never wrote `{status:'continue', nextCursor}` nor re-enqueued a successor.
- The stuck job's `entity_id` cursor decodes to `{"last_id":7356534817034,"last_value":"2025-09-11 12:43:15"}` — i.e. pagination halted exactly there.
- Orders-per-month histogram confirms the shape:
  - **2010 → 2025-09:** fully imported (steady monthly counts, 497 in 2025-09).
  - **2025-10 → 2026-05:** **zero rows** — 8-month dead band.
  - **2026-06 (3) + 2026-07 (2):** only the handful of `orders/create` webhook rows since the 2026-07-02 install.
- All 42 missing dispute orders fall inside that 2025-10 → 2026-06 dead band.

So this is **not** a date-window bug and **not** a card-vs-Klarna issue — it's a **crashed job that was never recovered.**

### Why the stall is permanent

`supabase/migrations/008_claim_jobs_rpc.sql` `claim_jobs()`:
- Only ever selects `status = 'queued'` rows (`ordersForBackfill` resume relies on the handler re-enqueuing a *new* queued row per page).
- The per-shop concurrency cap counts `status = 'running'` rows: `(select count(*) … where status='running') < p_max_concurrent` with `p_max_concurrent = 1`.

There is **no stale-lock reclaim** anywhere (`lib/jobs/claimJobs.ts`, the RPC, or the worker). Consequences when a worker dies mid-job:
1. The job is frozen in `running` with `locked_at`/`locked_by` set — `claim_jobs` never looks at it again.
2. That zombie **permanently occupies the shop's single concurrency slot**, so even a *manually* enqueued replacement can never be claimed (`count(running) >= 1`).
3. `backfillShopOrders` never got to its re-enqueue line, so no successor cursor exists.
4. `enqueueShopOrdersBackfill` further refuses to add work while a `running`/`queued` job exists.

Net: one crash → the shop's entire job pipeline is wedged forever. **This is systemic** — it affects every shop, not just cay-collective. (The first-sync email-flood shop earlier this week is a candidate to re-check.)

## 2. Scope decision

Two problems, deliberately separated:

- **A1 — Systemic:** crashed jobs are never reclaimed → wedged pipelines. *This is the real bug.*
- **A2 — Data:** cay-collective (and any already-wedged shop) has a historical gap that must be re-imported once A1 unwedges the pipeline.

Ship A1 (the fix) and A2 (the recovery) together; A2 without A1 just re-wedges.

## 3. A1 — Stale-lock reclaim (the fix)

**Principle:** a `running` job whose `locked_at` is older than a generous timeout is presumed dead and must be reclaimable.

### 3.1 Add reclaim to `claim_jobs` (new migration)

Extend the RPC to, *before* the normal claim loop, reset abandoned jobs:

```sql
-- reclaim stale locks: a job "running" longer than the max plausible
-- run duration is presumed dead (worker OOM/timeout/redeploy).
update jobs
set status = case when attempts < max_attempts then 'queued' else 'failed' end,
    locked_at = null,
    locked_by = null,
    last_error = coalesce(last_error, 'reclaimed: lock expired'),
    run_at = now(),
    updated_at = now()
where status = 'running'
  and locked_at < now() - (p_lock_timeout_seconds || ' seconds')::interval;
```

- Add `p_lock_timeout_seconds int default 600` (2× the 300 s `maxDuration`, safe margin).
- Reclaim → `queued` when attempts remain, else `failed` (so genuinely broken jobs don't loop forever — `max_attempts` is already 3).
- Keep it inside the same function so it runs on every claim tick; no new cron needed.
- **Concurrency-cap interaction:** because reclaim flips the zombie out of `running` first, the per-shop `count(running)` drops and a real successor can be claimed in the same call.

### 3.2 Resume semantics for reclaimed backfills

`backfill_shop_orders` is resumable **only if the cursor survives.** It does: the cursor lives in `entity_id` on the *stuck row itself*. But that row was mid-page when it died — reclaiming it to `queued` re-runs from its `entity_id` cursor, which is the **start** of the page it was processing, not the middle. `persistOrders` is idempotent (existing rows are UPDATE-not-INSERT; risk assessments are hash-deduped), so **re-running a page is safe** — no double-import. Verify this holds for `upsertSignalRow` too (it's an upsert; confirm no append-only duplication).

### 3.3 Guard against the "successor never enqueued" edge

Even with reclaim, if a job dies *after* persisting a page but *before* re-enqueuing the successor, reclaim re-runs that page (fine, idempotent) and then re-enqueues correctly. So reclaim alone closes the hole. No extra bookkeeping needed.

### 3.4 Observability

- Emit a structured log / `audit_events` row when a job is reclaimed (`reason: lock_expired`, jobId, jobType, shopId, prior lockedBy) so we can see how often workers die.
- Add an admin surface: count of jobs `running` with `locked_at < now() - interval '15 min'` — a wedged-pipeline alarm. Hook into the existing `/admin/jobs` view if present.

## 4. A2 — Recover cay-collective (and any wedged shop)

### 4.1 Unwedge

Once A1 ships, the zombie job auto-reclaims on the next worker tick. If we want to recover **before** A1 deploys (cay-collective is a live merchant mid-analysis), do a one-off manual reset:

```sql
-- one-off: release the zombie so the pipeline can resume.
update jobs set status = 'failed', locked_at = null, locked_by = null,
  last_error = 'manual reclaim 2026-07-02 (stuck 52m)'
where id = '9752b96b-b22c-4411-bc61-aeacd36320df';
```

Put reusable SQL in `scripts/sql/`.

### 4.2 Re-drive the import

The stuck job's `entity_id` cursor (`…last_value 2025-09-11…`) is still valid — enqueue a fresh `backfill_shop_orders` with that cursor to resume from the exact stall point:

```
enqueueJob({ shopId, jobType: 'backfill_shop_orders', entityId: '<stuck cursor>', priority: 80 })
```

`historical_import_status` is still `in_progress`, so the first-run bookkeeping is skipped and the existing since-date (2010-01-01) window is reused. It will walk 2025-09-11 → today, filling the dead band and finally flipping to `complete`.

- **Safer alternative for a full audit:** enqueue with `entity_id = null` (start from since-date). Idempotent writes mean it re-verifies the whole history and can't miss a page from a bad cursor. Costs more Shopify reads (~5.9 k) but guarantees completeness. Given this shop's dispute exposure, prefer the full re-drive.

### 4.3 Backfill `payment_method` on the newly imported rows

The `scripts/backfill-payment-method.mjs` run from the earlier session only covered the ~5.9 k rows that existed then. After A2 imports the dead-band orders, **re-run it** so the new rows get `payment_method`. It's idempotent (only touches `payment_method IS NULL`).

### 4.4 Fix the progress counter drift (minor)

Observed `historical_import_orders_processed = 5800` but `count(shopify_orders) = 5905`. The counter is advanced per page and can drift when a page re-runs or a webhook inserts out of band. Low-stakes, but while here: consider deriving `orders_total`/`progress_pct` from an actual `count(*)` at completion rather than the running counter, so the dashboard "X%" is honest. (This is the same `progress_pct = 0 / total = null` cosmetic issue noted at first install.)

## 5. Sweep: is cay-collective the only wedged shop?

Before closing, run a fleet check (prod):

```sql
select shop_id, id, job_type, locked_at, entity_id
from jobs
where status = 'running' and locked_at < now() - interval '15 minutes'
order by locked_at;
```

Every hit is a wedged pipeline needing the same §4 treatment. Also list shops with `historical_import_status = 'in_progress'` and `updated_at` old — stalled imports that never completed.

## 6. Verification / done criteria

1. New migration applied dev → prod; `npm test` covers the reclaim RPC (queued vs failed by attempts; running-but-fresh not reclaimed; concurrency slot frees).
2. cay-collective: `historical_import_status = 'complete'`, monthly histogram has **no gap** 2025-10 → 2026-05, and all 65 dispute `order_gid`s resolve to a `shopify_orders` row.
3. `payment_method` re-backfilled: 0 rows where a card/local method exists but column is null (excluding manual/gift_card/cash).
4. Fleet sweep returns no shop stuck > 15 min.
5. Regression test: simulate a worker dying mid-`backfill_shop_orders` (leave a `running` row with old `locked_at`) → next `claim_jobs` reclaims it → import completes.

## 7. Risks / notes

- **Reclaim timeout too low** would re-run legitimately long jobs. 600 s (2× maxDuration) is safe because the orchestrator's own soft budget (240 s) guarantees a healthy job checkpoints and re-enqueues well before then; anything past 600 s in `running` is genuinely dead.
- **Idempotency is load-bearing.** The whole recovery rests on `persistOrders` + `upsertSignalRow` being safe to re-run. Confirm with a targeted test before the prod re-drive.
- **Confirm dev vs prod target** before any `--linked` write (CLAUDE.md §0). cay-collective is prod (`aokhply`).
