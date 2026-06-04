# Supabase dev project — repurposing the existing project

> ⚠️ **SUPERSEDED (2026-06-04) — historical record only.** This runbook's plan
> ("repurpose the old free-tier prod project `sddzuglxdnkhcnjmcpbj` as dev") was
> **not** the path taken. A **fresh** dev project `vrpkgudqmpyunekrkpnc` was stood
> up instead (see [`prod-release-log.md`](prod-release-log.md)), and that is the
> live dev database today — it backs `dev.disputedesk.app` and the `disputedesk-dev`
> Vercel project. `sddzuglxdnkhcnjmcpbj` is now an **idle old-prod leftover** slated
> for deletion. Treat every `sddzuglx…`-as-dev reference below as the abandoned plan,
> not current truth. Authoritative refs live in [`CLAUDE.md`](../../CLAUDE.md) and
> [`branching-and-deploys.md`](../branching-and-deploys.md).

**Goal.** After the [Pro migration cutover](supabase-pro-migration.md) moves
production to the new Pro project, the existing project (`sddzuglxdnkhcnjmcpbj`)
becomes the dev database. Its schema, RLS, RPCs, storage buckets, and trigger
functions are already in place — that's exactly why we keep it instead of
spinning up a fresh empty project.

This is Phase 1 of [`dev-prod-environment-split.plan.md`](../plans/dev-prod-environment-split.plan.md),
adapted for the "existing project becomes dev" decision.

> **Order.** Do NOT start this runbook until the Pro migration cutover (Steps
> 1–7 of `supabase-pro-migration.md`) is complete and the new Pro project is
> serving prod traffic. The old project must be confirmed read-only and
> non-authoritative before you start mutating it.

> **One-way conversion.** Once you wipe data and rotate the encryption key
> (Steps 1–3 below), this project can no longer decrypt the prod offline
> tokens it used to hold. The Pro project must be authoritative before this
> point — there is no rollback to "old project as prod" after Step 3.

## 0. Pre-conditions

Before starting, confirm:

- [ ] Pro migration cutover Steps 1–7 are complete (data restored, Vercel env vars repointed at new Pro, `/api/health` shows new project fingerprint).
- [ ] Pro project has been serving prod for at least 24h with no errors.
- [ ] You have a final backup of the old project's data stored offline (Section 1 below).
- [ ] No code or env still references the old project as authoritative.

If any of these aren't true, stop and finish the Pro migration first.

## 1. Final backup of the old project

This is the last point at which the old project still holds production data.
Take a clean backup before any wipe — keep it as the historical record.

```
pg_dump \
  --schema=public \
  --no-owner \
  --no-acl \
  --file=./backups/old-prod-final-$(date -u +%Y%m%dT%H%M%SZ).sql \
  "$OLD_SUPABASE_URL_POSTGRES"
```

Store the dump file outside this repo (it's gitignored anyway, but keep a copy
elsewhere). Record the timestamp in `docs/runbooks/prod-release-log.md`.

## 2. Wipe data

The schema stays. Every data row in `public.*` goes. Reference data that
ships with the schema (constants seeded by migrations, not by ops scripts)
also gets re-seeded after the wipe.

```
psql "$OLD_SUPABASE_URL_POSTGRES" --single-transaction <<'SQL'
-- Disable triggers while we delete — RLS + foreign keys would otherwise
-- block the wipe. session_replication_role = 'replica' is the standard
-- Supabase pattern for this kind of bulk operation.
SET session_replication_role = 'replica';

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_migrations', 'schema_migrations')
  LOOP
    EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
  END LOOP;
END $$;

SET session_replication_role = 'origin';
SQL
```

Then re-seed the prod-safe constants (the ones the Pro project also has).
Phase 4 of the plan will rename these to `seed:prod-safe:*`; for now use the
existing scripts pointed at the old project's URL:

```
# Point local env temporarily at the old project, then:
npm run seed:resources
# pack_templates, reason_template_mappings come from migrations — no script
# needed. Confirm they're present via:
npx supabase db query --linked "SELECT count(*) FROM pack_templates;"
```

## 3. Rotate secrets

The dev project must not share any secret with the new prod. Rotate every
shared key:

### 3.1 Database password

Supabase Dashboard → old project → Settings → Database → Reset database
password. Capture the new password.

### 3.2 Encryption key

```
openssl rand -hex 32
```

This goes into the dev `.env.local` as `TOKEN_ENCRYPTION_KEY_V1` (see Step 5
below). **Do not reuse the prod value.** After this rotation, any
prod-encrypted token still in the project's database (there shouldn't be any
after Step 2, but the encryption-key drill in Step 6 confirms) is unreadable.

### 3.3 Service-role key

Supabase Dashboard → old project → Settings → API → Reset service role key.
The old key becomes invalid — confirm no Vercel env (preview or production
on the prod Vercel project) still references the old project's service-role
key.

### 3.4 Anon key

Same screen — reset the anon key. Less critical (anon is meant to be public)
but the rotation prevents any stale browser session from being accepted by
the now-dev project.

### 3.5 Auth hook secret

If the old project's Auth → Hooks → Send Email was enabled, generate a fresh
`SUPABASE_AUTH_HOOK_SECRET` for dev.

## 4. Storage buckets — confirm empty

The buckets exist (created by migrations). After Step 2's data wipe their
rows are gone from `storage.objects`, but the underlying files in Supabase
Storage are NOT auto-deleted by `TRUNCATE` on `storage.objects`. They have
to be cleared via the Storage API or Dashboard:

- [ ] Supabase Dashboard → Storage → `policy-uploads` → select all → delete.
- [ ] Same for `evidence-uploads`.
- [ ] Same for `evidence-packs`.

Confirm each bucket reports 0 files.

## 5. Reconnect as dev

Now wire the (sanitized) old project into local dev. Update `.env.local` at
the repo root:

```
APP_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Old project, now repurposed as dev
SUPABASE_URL=https://sddzuglxdnkhcnjmcpbj.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://sddzuglxdnkhcnjmcpbj.supabase.co
SUPABASE_ANON_KEY=<NEW dev anon — from Step 3.4>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<NEW dev anon>
SUPABASE_SERVICE_ROLE_KEY=<NEW dev service_role — from Step 3.3>
SUPABASE_URL_POSTGRES=postgresql://postgres:<NEW dev password>@db.sddzuglxdnkhcnjmcpbj.supabase.co:5432/postgres

TOKEN_ENCRYPTION_KEY_V1=<NEW value from Step 3.2>
CRON_SECRET=<fresh — openssl rand -hex 32>

CRON_ENABLED=false
EMAIL_SEND_ENABLED=false
```

Then run the env-identity check:

```
node scripts/verify-env-identity.mjs
```

After the Pro cutover, `KNOWN_PROD_SUPABASE_PROJECT_REF` in
`lib/env/build-identity.ts` points at the new Pro project's ref — so
the old ref `sddzuglxdnkhcnjmcpbj` is no longer "the prod ref" and the dev
rule (`APP_ENV=development AND ref === KNOWN_PROD_REF → fail`) lets it pass.

If the verifier still rejects the old ref, the Pro migration's code constant
update didn't land — fix that PR before continuing.

## 6. Encryption-key isolation drill

Per plan §7: confirm any token encrypted with the prod key fails to decrypt
with the dev key.

Use any prod `shop_sessions.encrypted_token` captured from a backup. Attempt
to decrypt it locally using the dev `TOKEN_ENCRYPTION_KEY_V1`:

```
node -e "
const { decryptToken } = require('./lib/security/encryption');
require('dotenv').config({ path: '.env.local' });
try {
  const result = decryptToken('<paste-prod-encrypted-token-here>');
  console.log('UNEXPECTED: decrypt succeeded:', result.slice(0, 12));
  process.exit(1);
} catch (e) {
  console.log('OK: decrypt failed as expected —', e.message);
}
"
```

Expected: throws an AES-GCM authentication tag mismatch. Record the result
in the drill log below.

| Operator | Date (UTC) | Result | Notes |
|---|---|---|---|
| _name_ | _e.g. 2026-05-26T17:00:00Z_ | _pass / fail_ | _e.g. AES-GCM tag mismatch, as expected_ |

## 7. Create dev admin user

The wipe in Step 2 removed `internal_admin_grants` but NOT auth users (those
live in `auth.users`, outside the public schema). However, the auth users
your team had on the old project are still tied to the old project's JWT
secret which Step 3 rotated — so they need to re-sign-in regardless.

- [ ] Visit `http://localhost:3000/auth/sign-up` (or `/auth/sign-in` if you use magic link) on the dev project.
- [ ] Get the `auth.users.id` from Supabase Dashboard → Authentication → Users.
- [ ] Grant admin:
  ```
  npx supabase db query --linked "INSERT INTO internal_admin_grants (user_id, is_active, granted_by, granted_at) VALUES ('<your-auth-uid>', true, '<your-auth-uid>', now());"
  ```
- [ ] Confirm `http://localhost:3000/admin` loads.

## 8. End-to-end verify

- [ ] `npm run dev` boots cleanly.
- [ ] `http://localhost:3000/api/health` returns `appEnv=development`, `supabaseProjectRefFp` = first 8 chars of `sddzuglxdnkhcnjmcpbj` = `sddzuglx`, `supabaseIsKnownProd=false`.
- [ ] `npm test` passes.
- [ ] `npm run seed:synthetic-disputes` populates dev with synthetic data without complaining.

## 9. Append release-log entry

In `docs/runbooks/prod-release-log.md`, record the conversion: timestamp,
secret rotations performed (which ones), drill result, sentinel-table row
counts before/after the wipe. This closes the loop on the old project's
prod-era history.
