# New-install side effects are silently skipped — token-exchange bypasses the `isNewShop` block

**Status:** PLAN ONLY. Not started.
**Severity:** Merchant-affecting (missing Free-tier credits) + total loss of new-install visibility.
**Discovered:** 2026-08-28, investigating "why did I get no install email for isj-153 (Made2Pet)".

---

## 1. Symptom

Three consecutive new merchants produced **no admin install email** and **no
Free-tier lifetime credit grant**:

| Shop | Installed | `free_lifetime` grant | Install email |
|---|---|---|---|
| `isj-153` (Made2Pet) | 2026-08-26 | **0** | **none** |
| `daniel-store-wh0b7w15` | 2026-07-22 | **0** | none (per code comment) |
| `blume-box` | 2026-07-20 | **0** | none (per code comment) |
| `cay-collective` | 2026-07-02 | 1 ✓ | — |

Both side effects live in the same `if (isNewShop)` block in
`app/api/auth/shopify/callback/route.ts:167-203`. They fail **together**,
despite different call styles (the grant is fire-and-forget `.catch()`, the
email is `await`ed). That rules out the await/race explanation recorded in the
comment at `route.ts:163` — an awaited call and a non-awaited call cannot lose
the same race.

**Conclusion: the block is not executing.**

---

## 2. Root cause (hypothesis — mechanism identified, not yet log-confirmed)

There are **two** routes that create a `shops` row:

| Route | Creates row | Grants credits | Sends install email |
|---|---|---|---|
| `app/api/auth/shopify/callback/route.ts:124` | `insert({shop_domain, locale})` | **yes** | **yes** |
| `app/api/auth/shopify/token-exchange/route.ts:71` | `insert({shop_domain})` | **no** | **no** |

`isNewShop` in the OAuth callback is true **only** when no `shops` row exists at
that moment (`route.ts:106-135`). If `token-exchange` creates the row first, the
callback takes the `existingShop` branch and **silently skips every new-install
side effect**. No error, no log, no retry.

### Why it started

`git log` on the auth paths:

- **2026-07-02** — `cay-collective` installs. Grant fires. Live path works.
- **2026-07-14** — four commits land the expiring-offline-token migration:
  - `c247f079` feat(shopify): migrate to expiring offline tokens (all 3 stages) (#278)
  - `6cfa7887` fix(shopify): **route already-cookied embedded loads through token-exchange** (#279)
  - `dc64ab1a` fix(shopify): re-exchange a stale expiring offline token on app load (#291)
  - `212c282e` fix(shopify): align dd_token_expiring cookie TTL (#292)
- **2026-07-20 onward** — every install fails.

`#279` explicitly widens how often `token-exchange` runs. The failure window
opens immediately after it.

### What is NOT yet proven

Vercel runtime logs are past retention for all three installs, so the row-creation
race is **inferred from code structure + commit timing**, not observed. Timing data
was inconclusive: Made2Pet's shop→session gap (0.79s) is indistinguishable from a
working install (xxda51-v1, 0.77s). §5 adds the instrumentation that would make
the next occurrence self-diagnosing. Do not describe this as confirmed until
either a log or the §5 probe shows it.

### Ruled out

- **Await/fire-and-forget race** — both styles fail together.
- **Missing `RESEND_API_KEY`** — present in prod (`dispute-desk`, all 3 envs, 154d).
- **`isNewShop` never true for App Store installs** — `cay-collective` is an App
  Store install that worked.
- **Storefront WAF (CloudFilt)** — fronts `made2pet.com`; every DisputeDesk call
  goes to `isj-153.myshopify.com/admin/api` from Vercel. Unrelated.

### Pre-existing gap, distinct cause

`caycollectiveteststore` (installed 2026-07-01 10:29) has no grant because it
installed **2 minutes before** the feature commit `2683711d` (10:31) and was not
picked up by that commit's backfill migration
(`20260701120000_backfill_free_lifetime_credits.sql`). Not the same bug; still
needs the §4 backfill.

**Note:** every ✓ grant before 07-02 came from that backfill migration, not from
the live install path. The live path has run 4 times and worked once.

---

## 3. Impact

| Effect | Detail |
|---|---|
| **Merchants short their Free-tier pack floor** | `FREE_LIFETIME_PACKS` never granted → first pack build can hit the quota banner |
| **Zero new-install visibility** | 3 merchants installed with no notification; found only because the user asked three times |
| **Silent** | No error is raised on either miss; `grantFreeLifetimeCredits` self-guards and returns, the email is skipped by the gate |

Anything else added to that block in future inherits the same silent bypass.

---

## 4. Remediation — backfill (do first; merchant-affecting)

Grant the missing `free_lifetime` credits to the four affected shops:

- `isj-153.myshopify.com` (Made2Pet)
- `daniel-store-wh0b7w15.myshopify.com`
- `blume-box.myshopify.com`
- `caycollectiveteststore.myshopify.com`

`grantFreeLifetimeCredits` is idempotent (guards on an existing `free_lifetime`
row), so re-running it per shop is safe and cannot double-grant. Reuse the shape
of `supabase/migrations/20260701120000_backfill_free_lifetime_credits.sql`.

**Do NOT** retro-send install emails — they are stale and the merchants are
already onboarded.

---

## 5. Fix — make the side effects independent of which route wins

The bug class is: *a once-per-shop side effect gated on a flag owned by only one
of two routes that can create the shop.* Fixing only the email or only the grant
leaves the class open (see `[[feedback_fix_the_class_not_the_instance]]`).

**5.1 — Move the trigger off `isNewShop` and onto a persisted marker.**
Add a nullable `shops.install_notified_at` (and rely on the ledger row as the
grant's own marker, which it already is). Both routes call one shared
`runNewInstallSideEffects(shopInternalId, {source})` helper that:
  - grants free-lifetime credits (already self-guarding), and
  - sends the admin install email **iff** `install_notified_at IS NULL`, then
    stamps it.

Idempotent by construction, so it is safe to call from **both** the OAuth
callback and `token-exchange`, and a duplicate callback cannot double-fire.

**5.2 — Call it from both routes.** `token-exchange` currently creates shops
rows and runs no install side effects at all. That is the actual defect.

**5.3 — Make a skip observable.** The current failure is silent. Log
(`console.warn`) whenever a shops row is created by `token-exchange`, including
`source`, so the next occurrence is greppable in Vercel rather than needing a
four-hour DB archaeology session.

**5.4 — Alert on the invariant.** A shop that is >24h old with no
`install_notified_at` is a missed notification. Surface it in an existing ops
sweep so it self-reports.

---

## 6. Tests

- A shops row pre-created by `token-exchange`, followed by the OAuth callback →
  credits granted **once**, install email sent **once**.
- OAuth callback alone (no prior row) → unchanged behaviour, one grant, one email.
- Callback invoked **twice** for the same shop → exactly one grant, one email.
- `token-exchange` alone (embedded-only install, no callback) → credits granted,
  email sent.
- `install_notified_at` already set → email NOT re-sent, no throw.
- Existing `grantFreeLifetime.test.ts` idempotency case must stay green.

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run build` (migration + route change).

---

## 7. Sequencing

1. **Backfill** the 4 shops' credits (§4) — merchant-affecting, no code change.
2. **One PR**: migration (`install_notified_at`), shared helper, both call sites,
   observability (§5.3), tests (§6), `docs/technical.md`.
3. **Follow-up**: the >24h invariant alert (§5.4).

## 8. Open questions

1. **Confirm the race in a live install.** §5.3's log makes the next install
   self-diagnosing. Until then the mechanism is inferred, not observed.
2. **Is `team.status: "todo"` on isj-153 related?** Separate finding, verified
   **harmless** — senders read `steps.team.payload.teamEmail` directly
   (`sendNewDisputeAlert.ts:731`), never the step status. Merchant alerts work.
   Possibly the known setup-wizard completion-loop issue (PR#332/#334).
