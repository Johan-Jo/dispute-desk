# Production release log

Append-only log of every production state change that isn't a normal code deploy.
Examples: Supabase project migrations, Vercel env-var bulk updates, secret rotations,
manual prod DB migrations applied via `db:push:prod`.

**Rules:**

- Append only. Never delete or edit prior entries. Corrections go in a new entry referencing the old one.
- One entry per state change. Multi-step releases (e.g. Pro migration) get a single entry with sub-bullets.
- Record timestamps in UTC, ISO 8601.
- Reference git SHAs and PR URLs where applicable.
- Never paste secrets, full connection strings, or service-role keys.
  Fingerprints (first 8 chars of non-secret identifiers) are OK.

Companion files:
- [`prod-current-state-snapshot.md`](prod-current-state-snapshot.md) — point-in-time snapshot at 2026-05-13 (frozen, never updated; this log records changes since).
- [`prod-release.md`](prod-release.md) — Phase 5 release checklist (TBD).
- [`prod-rollback.md`](prod-rollback.md) — Phase 5 rollback procedures (TBD).

---

## Entries

<!-- Append new entries at the BOTTOM. Newest entry goes after the last one, never at the top. -->

<!-- Template — copy-paste below the last entry when adding a new one.

### YYYY-MM-DDTHH:MM:SSZ — <one-line summary>

- **Operator:** <name>
- **Git SHA before:** `<7-char>`  (link to commit if useful)
- **Git SHA after:** `<7-char>`
- **PR(s):** <#123, #124>
- **What changed:**
  - <step 1>
  - <step 2>
- **Verification:**
  - <command + output / fingerprint comparison>
- **Notes / follow-ups:**
  - <anything for next release>

-->

<!-- First real entry will be the Supabase Pro migration cutover. -->

### PLANNED — Supabase Pro migration cutover

- **Old prod ref:** `sddzuglxdnkhcnjmcpbj` (Free tier; becomes dev after cutover per `supabase-pro-migration.md` §3)
- **New prod ref:** `aokhplydttxtebvbeuzc` (Pro tier)
- **Runbook:** [`supabase-pro-migration.md`](supabase-pro-migration.md)
- **Status:** schema replay + non-schema settings in progress on the new project. Code-constant PR not yet prepared (cutover-day work).
- **Outstanding before cutover:** schema replay confirmed (`npx supabase db push`), buckets verified, Auth URL config set on new project, Vercel env vars staged but not yet swapped.
- **This stub will be replaced by the real entry at cutover time** with: timestamp, operator, verifier output, health endpoint response, sentinel-table row counts.
