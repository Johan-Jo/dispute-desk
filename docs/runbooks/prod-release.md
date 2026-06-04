# Production release checklist

Use this when promoting work from `develop` → `master` and pushing any
schema changes to the production database.

This runbook is the per-release script. It pairs with:
- [`prod-rollback.md`](prod-rollback.md) — what to do if anything goes wrong.
- [`prod-release-log.md`](prod-release-log.md) — append-only history of every prod push.
- [`prod-current-state-snapshot.md`](prod-current-state-snapshot.md) — frozen point-in-time record of prod state at 2026-05-13.

## Hard rules

1. **No production push without a green `release:verify` locally.** The
   `release:verify` script runs lint, tsc, every i18n guard, vitest, and
   the production build. All must pass.
2. **No production database migration without `npm run db:push:prod`.**
   That script is the only sanctioned path; it requires `APP_ENV=production`,
   confirms the linked Supabase project, prints the migration delta,
   waits for an interactive confirmation phrase, and appends to
   `prod-release-log.md` on both start and finish.
3. **No CI step writes to prod.** `release:verify` does NOT call
   `supabase db push --linked`. Migrations are operator-driven, always.
4. **No seed script writes to prod unless it has `// PROD_SAFE: true`**
   in its file and uses `requireProdAllowed()` from
   `scripts/internal/seed-guard.mjs`. Synthetic data seeds (`seed:dev:*`)
   refuse to run outside `APP_ENV=development`.

## Per-release checklist

Copy this block into your PR description and tick each item as you go.

```markdown
### Production release checklist

- [ ] PR merged to `develop`. Vercel dev deploy succeeded.
- [ ] `/api/health` on https://dev.disputedesk.app shows `appEnv=development`, `gitSha` matches develop HEAD, `supabaseIsKnownProd=false`.
- [ ] Manually smoke-tested affected feature on `dev.disputedesk.app` against a development store.
- [ ] `npm run release:verify` green locally on develop HEAD.
- [ ] PR opened from `develop` → `master`. CI green.
- [ ] Reviewer signoff.
- [ ] Squash-merge to `master`. Vercel prod deploy completes.
- [ ] `/api/health` on https://disputedesk.app shows new `gitSha`.
- [ ] **If the PR includes migrations under `supabase/migrations/`:**
  - [ ] On a local clone with the merged master checked out, set `APP_ENV=production`.
  - [ ] `npx supabase link --project-ref <prod-ref>` (only if not already linked).
  - [ ] `npm run db:push:prod`. Type the confirmation phrase when prompted.
  - [ ] Confirm `prod-release-log.md` has the SUCCEEDED entry.
- [ ] Post-deploy canary: hit one read endpoint (e.g. `GET /api/health`, `GET /api/portal/disputes?limit=1` from an authed session). Confirm 200.
- [ ] Watch the dispute-sync cron at the next scheduled boundary (5-min cadence). Confirm no error spike via Vercel logs or `/admin/webhooks`.
- [ ] If anything in any of the above failed: STOP and consult `prod-rollback.md`.
```

## Why each step matters

**Develop smoke test before master**
The Phase 0 env-identity check refuses to boot if dev creds and prod
creds get crossed, but it can't catch product-level regressions. A
5-minute manual smoke test on dev (login, view a dispute, open one
pack) catches more than any automated check.

**release:verify must be green locally**
CI runs the same set, but local-green protects against "merge to master,
break it, push to prod immediately" sequences where CI hasn't completed.

**db:push:prod over `supabase db push` direct**
The wrapper enforces `APP_ENV=production`, validates the linked project
matches the known prod ref, prints the delta before asking, and writes
an audit trail. Direct `supabase db push --linked` skips all of that.

**Watch one cron cycle**
Schema migrations that look fine in unit tests can still break a
specific cron's SQL. The 5-minute dispute-sync cycle is the fastest
real-prod signal — wait one tick before declaring success.

## Common pitfalls

- **Forgetting to set `APP_ENV=production` before `db:push:prod`** → the script aborts loudly. Re-run with the env var.
- **Wrong Supabase project linked** → script reads `supabase/.temp/linked-project.json` and refuses if the ref isn't in `KNOWN_PROD_PROJECT_REFS` (currently `aokhplydttxtebvbeuzc`, the Pro prod ref). Re-link with `npx supabase link --project-ref aokhplydttxtebvbeuzc`.
- **Running from a non-master branch** → script warns but allows; you almost always want to push from master.
- **`prod-release-log.md` not updated** → script appends automatically on both start and finish. If you see a "STARTED" entry without a matching "SUCCEEDED" or "FAILED", the push didn't complete — investigate via Supabase Dashboard before retrying.

## After the release

- Update `prod-release-log.md` only if you need to add context the script
  couldn't capture (e.g. "post-deploy verification: confirmed pack
  rebuild on shop X").
- If migrations applied: the build-identity check on the next prod deploy
  will validate that the prod project ref still matches the known-prod
  constant. No code change needed unless you're at a cutover.
- Close the PR. Update any tracking issues.

## Reference

- Phase 5 of [`dev-prod-environment-split.plan.md`](../plans/dev-prod-environment-split.plan.md) — origin spec for this runbook.
- [`scripts/db-push-prod.mjs`](../../scripts/db-push-prod.mjs) — the tool this runbook drives.
- [`scripts/release-verify.mjs`](../../scripts/release-verify.mjs) — the verification pipeline `npm run release:verify` runs.
- [`scripts/internal/seed-guard.mjs`](../../scripts/internal/seed-guard.mjs) — the seed-classification helpers (`requireDev`, `requireProdAllowed`).
