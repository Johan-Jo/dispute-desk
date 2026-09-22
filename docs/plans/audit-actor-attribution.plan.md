# Audit actor attribution — who actually did it

**Status:** SHIPPED to `develop` 2026-09-15 (branch `fix/audit-actor-attribution`).
Migrations applied to **dev**; prod apply pending the production deploy.
**Opened:** 2026-09-15
**Origin:** "What did Main Maison do this morning?" `audit_events` could not answer it.

## The question that exposed this

Main Maison (`6a8848-dd.myshopify.com`, shop `ea035a1b-8aec-4305-ba2b-27713a6aeff3`)
logged in at 06:53:48 UTC on 2026-09-15. Asked what they did, the audit trail could
not say — and worse, the rows it *did* show were misattributed. Of 14 non-system
rows for that shop, 8 were `scripts/build-one-pack.mjs` runs recorded as
`actor_type='merchant'`.

## Three defects

### D1 — `actor_id` is NULL by construction
Every merchant-facing write site hardcodes the actor type and passes no `actorId`.
Verified: `grep -c actorId` returns 0 for all 15 typed-helper route files.
`AuditLogInput.actorId` exists and is honoured by the writer; nothing supplies it.

### D2 — no actor type can express "a script did this"
`lib/audit/logEvent.ts:187` types `actorType: "merchant" | "system"`, and
`audit_events_actor_type_check` enforces the same two values **in the database**.
`scripts/build-one-pack.mjs:180,245` therefore picks `"merchant"` — the closer of two
lies, since `"system"` would imply the pipeline acted autonomously. The type system
offers no correct answer, so the honest label is unavailable, not merely unused.

### D3 — impersonation is invisible at 37 of 38 sites
`app/api/automation/settings/route.ts:100-105` is the ONLY site that resolves it:

```ts
const imp = await verifyImpersonation(req);
actorType: imp ? "system" : "merchant",
actorId: imp?.adminUserId ?? null,
```

That fix was applied for the `automation_settings_changed` incident (a merchant's
`auto_build_enabled` found false, no way to tell who turned it off) and **never
generalized**. Every other route still has exactly the bug that incident was about:
an operator's "View as merchant" writes land attributed to the merchant.

`verifyImpersonation(req)` takes any `NextRequest` — all these routes already have one.

## Scope — corrected during investigation

An earlier count of "15 sites" covered only the `logAuditEvent` helper path.
The real inventory:

| Path | Sites | Note |
|---|---|---|
| `logAuditEvent(...)` typed helper | 15 | none pass `actorId` |
| Direct `.from("audit_events").insert(...)` | 56 total, 11 files with merchant actor | bypasses the helper entirely |
| Scripts | 1 file (`build-one-pack.mjs`, 2 calls) | hardcodes `"merchant"` |
| **Total merchant-actor write sites** | **38** | |

**The helper's docblock is false.** It claims "This is the ONLY function that writes
to audit_events"; there are 56 direct-insert call sites. Those also skip the
`EventType` union, which is why `gorgias_message_approved` (17 rows in prod) and
`billing_subscription_created` (11 rows) are not declared in it.

## Decisions taken

- **Backfill: YES.** Correct the 8 mislabelled historical rows.
- **`admin` is its own actor type** — not folded into `system`. `system` currently
  means both "cron did it" and "a human did it while impersonating"; splitting those
  is the point.

## Target vocabulary

| actor_type | meaning | actor_id |
|---|---|---|
| `merchant` | a human in the merchant's Shopify session | Shopify user id when available |
| `admin` | a human on our side, via View-as-merchant impersonation | `adminUserId` |
| `script` | an operator-run script | script filename |
| `system` | autonomous — cron, jobs, webhooks | job/cron id or NULL |

## Work

### W1 — Migration: widen the CHECK constraint
`audit_events_actor_type_check` currently allows only `merchant|system`. Drop and
recreate allowing `merchant|admin|script|system`. **Must land and be applied before
any code writes a new value**, or every such insert fails at the DB.
Per CLAUDE.md #1: apply via `npm run db:migrate:dev` / `:prod` in the same session.

### W2 — Widen the TypeScript union
`AuditLogInput["actorType"]` → `"merchant" | "admin" | "script" | "system"`.

### W3 — `resolveAuditActor(req)` helper
New export in `lib/audit/`. Wraps `verifyImpersonation`, returns
`{ actorType, actorId }` — `admin` + `adminUserId` when impersonating, else
`merchant`. One helper, so route #39 cannot reinvent it wrongly.

### W4 — Apply across all 38 sites
Replace every hardcoded `actorType: "merchant"` with `resolveAuditActor(req)`.
Includes the 11 direct-insert billing/feedback/sync files. Where a route genuinely
has no request in scope, that is a finding to record, not to paper over.

### W5 — Scripts write `script`
`build-one-pack.mjs` (both calls) → `actor_type: "script"`,
`actor_id: "build-one-pack.mjs"`.

### W6 — Backfill the 8 rows
Identified by: `actor_type='merchant' AND event_type='job_queued'
AND event_payload->>'note' ILIKE '%build-one-pack.mjs%'` — all 8 on Main Maison,
2026-09-01 → 2026-09-08. The other 2 `job_queued` merchant rows
(shop `e5da0042…`, April, payloads `manual_generate` / `render_pdf`) are GENUINE
merchant actions and must NOT be touched.

**Obstacle:** `trg_audit_no_update` / `trg_audit_no_delete` reject UPDATE and DELETE
(`reject_audit_mutation()`). Options:

- **(a) One-shot migration that disables the trigger, UPDATEs the 8 rows, re-enables.**
  Truthful end state; momentarily suspends the append-only guarantee.
- **(b) Append 8 correction events** and leave the originals. Preserves append-only
  absolutely; every future reader must know to apply the correction.

**Recommend (a)**, narrowly scoped by the exact predicate above with a row-count
assertion (`ASSERT count = 8`) so it cannot silently over-match. The append-only
trigger exists to stop *casual* mutation, and a reviewed migration is not that —
but this is a judgement call and (b) is defensible. **Confirm before implementing.**

### W7 — CI invariant
Source-scanning vitest enumerating every `audit_events` write site, modelled on
`tests/unit/caseGateAssessmentCallSites.test.ts` (which pins call sites from source
rather than trusting a comment). Fails when a site hardcodes an actor type without
resolution. A new route fails until listed — the moment to ask who the actor is.

### W8 — Docs
`docs/technical.md`: the actor vocabulary and its meaning. Correct the false
"ONLY function that writes" docblock in `logEvent.ts` (or make it true — see below).

## Out of scope, deliberately

- **Routing the 56 direct inserts through the helper.** Correct, and much larger
  than this fix. W4 fixes their *attribution* in place; consolidation is separate.
- **Declaring the missing event types** (`gorgias_message_approved`,
  `billing_subscription_created`, …) in `EventType`. Same reason.
- **Page-view telemetry.** The original question — what did they *look at* — remains
  unanswerable; no such data is recorded. Vercel runtime logs are the only source.
  This plan makes writes attributable, not reads visible.

## Verification

- `npm test`, `npx tsc --noEmit`, `npm run build`.
- Post-backfill: re-run the D-query and confirm 8 rows are `script`, 2 remain
  `merchant`, and no other shop's counts moved.
- Exercise one impersonated write end-to-end and confirm it lands as `admin`.

## What shipped, and what changed during implementation

W1–W8 all landed, plus the admin surface. Three decisions changed on contact
with the code:

1. **W6 uses the GUC, not `disable trigger`.** Option (a) was approved as
   "suspend the trigger", but `reject_audit_mutation()` already honours a
   transaction-local `app.allow_audit_mutation` GUC (migration 20260509130000),
   which is strictly safer: `disable trigger` lifts immutability table-wide for
   the duration, so a concurrent writer would also slip past it. Same approved
   intent, narrower blast radius. Verified against dev.

2. **The count assertion accepts 0 as well as 8.** Dev carries none of these
   rows, and a hard `<> 8` abort would have failed the whole deploy there.
   Any OTHER count still aborts — that is the case worth refusing.

3. **`resolveAuditActor` degrades instead of throwing.** Found via 9 failing
   `respondRoute` tests: callers without a cookie jar crashed the route. An
   audit write must never be why a merchant's action 500s, so a missing or
   unverifiable cookie yields `merchant` rather than an exception.

**Admin surface (added per follow-up request):** `/admin/shops/[id]` now carries
an Activity panel — human actors only by default, automation behind a toggle.
Pre-2026-09-15 `merchant` rows are marked *(actor unverified)*.

**Verification:** 6131 vitest passing; the 11 `DefencePackageDocument` failures
are pre-existing on `develop` (confirmed against a clean baseline worktree) and
unrelated. `tsc --noEmit` clean. The invariant test was confirmed to FAIL when
the defect is reintroduced, not merely to pass.

## Still open

Routing the ~56 direct-insert sites through `logAuditEvent` and declaring their
event types in the `EventType` union. Their *attribution* is now correct; their
*bypassing of the typed helper* is not. Deliberately out of scope here.
