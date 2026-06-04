# Branching & Deploys

The pipeline that keeps **dev** and **prod** clean and makes "what am I deploying, and where?" unambiguous. Adopted 2026-05-31 after three commits landed directly on `master` (= prod) without a staging gate.

## The two long-lived branches

| Branch | Vercel project | Domain | Supabase project | Purpose |
|---|---|---|---|---|
| `develop` | `disputedesk-dev` | `dev.disputedesk.app` | `vrpkgudqmpyunekrkpnc` (Free, **dev**) | Staging — integrate + test here |
| `master` | `dispute-desk` | `disputedesk.app` | `aokhplydttxtebvbeuzc` (Pro, **prod**) | Production — real merchants |

Both mappings are configured at the Vercel level (each project's Git settings point at its branch). A push to `develop` auto-deploys staging; a push to `master` auto-deploys prod.

## The flow

```
feature/x ──PR──▶ develop ──▶ dev.disputedesk.app  (test here)
                     │
                     └──PR──▶ master ──▶ disputedesk.app  (prod)
```

1. **Branch** off `develop`: `feat/...`, `fix/...`, `chore/...`. Never commit directly to `develop` or `master`.
2. **PR into `develop`.** CI runs (the `check` job: tsc, lint, vitest, build, audit, forbidden-copy, migration-parity). Vercel posts a **Preview** URL on the PR. Merge when green.
3. **Verify on staging** at `dev.disputedesk.app` after the merge to `develop`.
4. **Promote:** open a PR `develop → master`. CI runs again. Merge → prod deploy.
5. **Confirm prod** via `https://disputedesk.app/api/health` (check `gitSha`, `appEnv=production`, `supabaseIsKnownProd=true`).

## Branch protection (enforced on GitHub)

Both `master` and `develop` are protected:
- No direct pushes — changes land only via PR.
- Required status check: **`check`** (the CI job) must pass before merge.
- No force-pushes, no branch deletion.

This makes an accidental prod push **impossible**, including for AI agents.

## Rules for AI agents (Claude)

- **Never** push to `master` or `develop` directly. Always: branch → PR.
- **Always state the branch name and the deploy target** (staging vs prod) *before* pushing.
- **Never merge a PR or trigger a prod deploy** without the maintainer's explicit go-ahead.
- Migrations still follow the CLAUDE.md non-negotiable: run `npm run db:migrate` in-session against the relevant project after any migration change.

## Migrations across two projects

`develop` work that adds a migration applies to the **dev** project; promoting to `master` applies it to **prod** on the next `db push`. `npm run db:migrate` targets whichever project the Supabase CLI is **linked** to (`supabase/.temp/linked-project.json`) — check the link before pushing migrations. `release:verify`'s migration-parity step compares the repo against the linked project, so keep the link pointed at the project you're verifying.

## One-offs & ops

Ad-hoc SQL: `npx supabase db query --linked` (see CLAUDE.md non-negotiable #2). Backfills / scripts that target prod from a local checkout read prod creds from `.env.production.local` (the `NEW_*` keys), since local `.env.local` points at the dev project.
