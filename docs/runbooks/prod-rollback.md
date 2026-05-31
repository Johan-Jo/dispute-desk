# Production rollback runbook

What to do when something breaks in production. The right answer is
almost always **roll back to the previous deploy** as fast as possible,
then investigate. Investigating in front of a broken production is how
small incidents become large ones.

## Decision tree

```
                Is prod broken right now?
                          │
              ┌───────────┴───────────┐
            yes                       no
              │                       │
              │                       └─► Open a bug, fix on develop, don't read this doc.
              ▼
   ┌──────────────────────────────┐
   │ Was the most recent change a │
   │ Vercel deploy from master?   │
   └─────┬───────────────────┬────┘
         │                   │
       yes                  no
         │                   │
         ▼                   │
    [§A — Revert Vercel]     │
         │                   ▼
         │           [§B — Migration rollback]
         │                   │
         └───────────────────┴─► [§C — Catastrophic: restore from snapshot]
```

## §A — Revert the Vercel deploy (fastest path; ~30 seconds)

Use when the breakage was introduced by code in the latest deploy, with
no schema change.

**Via Vercel Dashboard:**

1. Open https://vercel.com/estimatepro/dispute-desk/deployments
2. Find the most recent **successful** deployment that was healthy (usually one or two entries down from the broken one — its commit message matches the previous prod release).
3. Click the `…` menu → **"Promote to Production"** (sometimes called "Instant Rollback").
4. Confirm. The healthy deployment is now serving traffic — Vercel rolls back in seconds, no rebuild.

**Via Vercel CLI:**

```
vercel rollback <deployment-url> --scope=estimatepro
```

Where `<deployment-url>` is the Vercel-generated URL of the known-healthy deployment (e.g. `dispute-desk-xyz-estimatepro.vercel.app`).

**Verify after rollback:**

- `curl -sS https://disputedesk.app/api/health` → `gitSha` should match the rolled-back commit.
- The dispute-sync cron should resume normal output within 5 minutes.

**Then:**

- Append an entry to `prod-release-log.md` documenting the rollback (timestamp, broken SHA, rolled-back-to SHA, symptoms, root cause if known).
- Revert the broken commit on `master` via PR (`git revert <bad-sha>`) — don't leave master in a state that can't be re-deployed.

## §B — Migration rollback (slower; minutes to hours)

Use when the breakage was caused by a schema migration that landed via
`npm run db:push:prod` and is incompatible with the now-running prod
code (after step §A reverted the code).

**The rule.** Migrations don't auto-revert on Supabase. There is no
`db push --revert`. Reversing a migration means writing the inverse
SQL by hand and running it manually.

**Standing rule for every migration PR:** the migration's PR description
must include the inverse SQL needed to roll it back. If you've never
done this, treat any migration without an inverse as a release-blocker.

### B.1 Identify what was applied

Read the most recent entry in `prod-release-log.md`. The "Migrations
applied" list is what landed.

### B.2 Compose inverse SQL

For each migration in reverse order, write the SQL that undoes it.
Examples:

| Forward migration | Inverse |
|---|---|
| `ALTER TABLE x ADD COLUMN y text;` | `ALTER TABLE x DROP COLUMN y;` |
| `CREATE INDEX i ON x(y);` | `DROP INDEX i;` |
| `CREATE TABLE t (...);` | `DROP TABLE t;` |
| Data change (`UPDATE`/`INSERT`) | Custom — depends on what was overwritten. Often unrecoverable without a snapshot — see §C. |

### B.3 Apply inverse via canonical SQL path

Per CLAUDE.md non-negotiable #2, ad-hoc SQL on prod goes through `supabase db query --linked`:

```
npx supabase link --project-ref <prod-ref>     # if not already linked
npx supabase db query --linked --file scripts/sql/rollback-<isoTs>.sql
```

Store the inverse SQL in `scripts/sql/rollback-<isoTs>.sql` for the
audit trail. Append the rollback entry to `prod-release-log.md`.

### B.4 Update `supabase_migrations.schema_migrations`

The Supabase CLI tracks applied migrations in `supabase_migrations.schema_migrations`.
After applying the inverse, manually delete the corresponding row so
future `supabase db push` runs don't think the migration is still applied:

```sql
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '<version-number-of-rolled-back-migration>';
```

Otherwise the migration will be considered "applied" on the next push
even though its effect is gone.

## §C — Catastrophic restore from snapshot

Use when:
- Code rollback (§A) and migration rollback (§B) aren't enough.
- Data was corrupted, truncated, or lost.
- You need to return prod to a known-good state from a snapshot.

This is the rollback floor. The verified restorable backup recorded
under §1 of `prod-current-state-snapshot.md` (Phase −1 of the
env-split plan) is what this section relies on.

### C.1 Confirm backup availability

- For Supabase Free tier: backups are kept by Supabase for ~7 days (or whatever the current Free retention is). Check Dashboard → Project → Database → Backups.
- For Supabase Pro tier: Point-in-Time Recovery is available for the last 7 days.
- Operator-verified backup recorded in `prod-current-state-snapshot.md` is the historical record.

### C.2 Choose restore strategy

- **PITR (Pro tier only)**: restore the live project to a specific timestamp. Vercel env vars unchanged. Fastest if you know exactly when the breakage happened.
- **Restore to a new project**: Supabase Dashboard → Restore backup → Create new project. Then update Vercel env vars to point at the new project (same flow as the Pro migration in `supabase-pro-migration.md`).
- **Manual pg_restore from external dump**: only if Supabase's internal restore is unavailable. Use the dump file from `prod-current-state-snapshot.md` §1.

### C.3 Cutover

Whichever path:
1. Update Vercel prod project's `SUPABASE_*` env vars to point at the restored project.
2. Update `KNOWN_PROD_SUPABASE_PROJECT_REF` in `lib/env/build-identity.ts` + `scripts/verify-env-identity.mjs` if the project ref changed.
3. Update `KNOWN_PROD_PROJECT_REFS` in `scripts/db-push-prod.mjs` to recognize the new ref.
4. Merge the constant-update PR. Vercel redeploys. Build-time identity check confirms env vars + code constants agree.
5. Verify `/api/health` shows new project fingerprint, `supabaseIsKnownProd=true`.

### C.4 Post-restore audit

- Run `node scripts/verify-supabase-migration.mjs` between the restored project and the (now-isolated) broken project on sentinel tables to confirm data integrity.
- Notify any affected merchants (if applicable). Even a partial outage is a notify-the-merchant event for a chargeback app.
- Append everything to `prod-release-log.md` — timestamp, root cause, what was restored, how long the impact lasted.

## Hard NO list

- **No `DROP DATABASE` against prod.** Ever. There is no scenario where this is the right move.
- **No `git push --force` against `master`.** Even if a commit is bad, revert via a new commit. Force-push rewrites history that downstream consumers (Vercel, dependent merchants, audit logs) rely on.
- **No skipping `prod-release-log.md` updates.** Every prod state change is logged, including rollbacks. The audit trail is what lets the next incident be diagnosed.

## After every rollback

- Open a postmortem doc (even informal — bullet points in a Linear issue or Notion page works) within 24h.
- Identify the regression: tests that should have caught it, runbook steps that were missed, env-identity checks that didn't fire.
- Decide if the regression is a one-off or a systemic gap. Systemic gaps go into Phase 7 (Hardening) of the env-split plan.

## Reference

- Phase 5 of [`dev-prod-environment-split.plan.md`](../plans/dev-prod-environment-split.plan.md).
- [`prod-release.md`](prod-release.md) — the forward path. This doc is the inverse.
- [`prod-release-log.md`](prod-release-log.md) — append every rollback here.
- [`scripts/verify-supabase-migration.mjs`](../../scripts/verify-supabase-migration.mjs) — row-count diff between two Supabase projects, useful for confirming data integrity after a restore.
