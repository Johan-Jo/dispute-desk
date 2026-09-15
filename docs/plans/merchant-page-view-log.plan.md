# Page-view logging — what merchants (and we) actually looked at

**Status:** IMPLEMENTED 2026-09-15 on `feat/page-view-log`. Migration applied to
**dev**; prod apply pending deploy. W1–W7 all landed.
**Opened:** 2026-09-15
**Follows:** `audit-actor-attribution.plan.md` (merged, PR #724). That fix made
*writes* attributable. This makes *reads* visible. They are different features.

## Why

Asked "what did Main Maison do after logging in at 06:53?", `audit_events`
answered with automation rows and eight of our own script runs. The attribution
fix corrected who-wrote-what. It did not, and cannot, answer the actual
question — because **the merchant did not write anything**. They logged in,
looked at things, and left.

Viewing is the dominant merchant behaviour and none of it is recorded.

### A correction this plan exists to undo

Earlier work stated twice — and wrote into the attribution plan — that page-view
telemetry "does not exist" and is "unanswerable", listing it as permanently out
of scope. **That was wrong.** The data exists in Vercel runtime logs; it was used
in this very session to reconstruct an impersonation session (36 hits on
`/app/disputes/[id]`, 25 on the workspace API) while simultaneously claiming the
capability was unavailable.

What is *true* is narrower, and is the actual case for building this:

- **Retention is short** (~1 day), so yesterday's question is already unanswerable.
- **Not queryable per merchant.** Logs are keyed by route and time, not shop.
- **Not joinable** to disputes, packs, or shops.

A diagnostic tool, not a feature. Hence a table.

## Scope — decided

- **Both actors, every row labelled.** Initially scoped merchant-only; corrected
  on review. A page-view log with silent holes is *worse than none*: a gap reads
  as "the merchant did not visit this" when it may mean "we visited it and did
  not record it". Indistinguishable absence is the exact defect the attribution
  fix was opened for — reproducing it one level down would be self-defeating.
  Admin (View-as-merchant) sessions are logged and labelled `admin`.
- **Every page view, own table.** No throttling, no session collapsing.
- **90-day retention**, enforced by a cleanup job.

## What makes this viable

Verified against live dev traffic and current `middleware.ts`:

1. **Page loads are real server requests.** `/app/disputes/[id]` logged 36
   server-rendered route hits in one hour. Server-side logging catches actual
   navigation — this is not an SPA where client transitions would be invisible.
2. **One hook covers every embedded page.** `app/(embedded)/app/layout.tsx` runs
   on every `/app/*` render. It already verifies the session token, already
   branches on impersonation, and already writes fire-and-forget
   (`recordLastLogin`) so it adds no latency to a merchant page load.
3. **Both actors are already identified on the request**, by mechanisms that
   exist today:

| Actor | Identified by | Present per load? |
|---|---|---|
| `admin` | `dd_impersonation` cookie → `x-shop-id`, mode header, `adminUserId` | Yes — re-verified every load (`middleware.ts:706-711`), sliding TTL |
| `merchant` | `x-dd-shop-id` (from the `shopify_shop_id` cookie) | Yes — 30-day cookie, rides every navigation. NOT `id_token`: that arrives only on app entry |

**CORRECTED 2026-09-15, after the feature shipped and failed this exact case.**

An early draft claimed the merchant path only gets `id_token` on initial load.
A later draft "corrected" that to: the token arrives on essentially every
embedded load, citing the `middleware.ts:674-683` comment and the fact that
`shops.last_login_at` advances through the day across all four prod shops.

**The first draft was right and the correction was wrong.** `last_login_at`
advances because merchants RE-ENTER the app, not because the token rides every
page. Proven on dev: 34 server-side hits on `/app/disputes/[id]` produced zero
merchant page-view rows, and `last_login_at` — gated on the same token — froze
at the landing time of 16:59:03 while browsing continued past 16:59:22.

The lesson worth keeping: this was inferred from a code comment plus a
correlation, and not tested until a live merchant session contradicted it.

**So the merchant path needs a shop identity that does NOT depend on the query
param.** `shopify_shop_id` is a cookie set by the same `/app/*` branch with a
30-day life, so it rides every navigation and costs a cookie read rather than a
DB lookup in edge middleware. Middleware forwards it as `x-dd-shop-id`.

The admin path never had this problem: the impersonation cookie is verified per
request. Before the fix, the feature worked better for us than for merchants —
the lopsided coverage its own design set out to prevent.

## Work

### W1 — Forward the request path

The layout is a server component and cannot read its own pathname. Middleware
has `pathname` and already builds `requestHeaders` on both `/app/*` branches
(merchant ~line 668, impersonation ~line 706). Add `x-dd-path` in both.

### W2 — Table

```
shop_page_views(
  id           uuid pk,
  shop_id      uuid not null references shops(id) on delete cascade,
  actor_type   text not null check (actor_type in ('merchant','admin')),
  actor_id     text,          -- adminUserId, or Shopify staff id
  path         text not null, -- raw path as requested
  route        text not null, -- normalised: /app/disputes/[id]
  dispute_id   uuid,          -- extracted when the path carries one
  viewed_at    timestamptz not null default now()
)
```

Indexed on `(shop_id, viewed_at desc)`. RLS service-role-only, mirroring
`audit_events`. **NOT in `audit_events`** — that table is the append-only
compliance record of *actions*, with DB triggers rejecting UPDATE/DELETE. Page
views are navigation records with a retention policy; mixing them would bury real
actions and make the 90-day cleanup fight the immutability triggers.

Both `path` and `route` are stored: `path` identifies *which* dispute, `route`
is what any aggregate query groups by.

### W3 — Recorder

`lib/shopify/recordPageView.ts`, modelled on `recordLastLogin`: fire-and-forget,
never awaited, never throws into the render. **No throttle** (that is the
decision), so it must be genuinely cheap — a single insert, no read-before-write.

### W4 — Wire into the layout

Both branches of `app/(embedded)/app/layout.tsx`:

- impersonating → `actor_type: "admin"`, `actor_id: adminUserId`
- otherwise → `actor_type: "merchant"`, `actor_id: verified.userId`

The existing `if (!impersonating)` guard around `recordLastLogin` stays as it is
— last-login means merchant activity. Page views deliberately do not inherit it.

### W5 — Retention job

Daily cron deleting `viewed_at < now() - interval '90 days'`. Must call
`cronEnvGate(req)` first (CLAUDE.md #6). Batched deletes, so the job stays safe
if the table ever does grow with the customer base.

### W6 — Surface it

Extend the `/admin/shops/[id]` Activity panel (shipped in #724) so views appear
alongside actions on one timeline, actor-labelled. A view and an action on the
same dispute, interleaved, is what actually answers "what did they do".

### W7 — Docs

`docs/technical.md`: the table, the 90-day policy, and the fact that admin page
views are recorded.

## Risks

**Volume — measured, and NOT a concern.** An earlier draft of this plan claimed
this would become "the largest table in the database" and projected ~42,000 rows
over 90 days. **That projection was wrong and is retracted.** It counted Vercel
route hits that were mostly demo-mode fixture IDs (`/app/disputes/dp-2403`),
`/admin/*` browsing, and the author's own investigation traffic from this
session — then labelled the total "merchant page views".

The real figure: four prod shops, each logging in a handful of times a day
(`shops.last_login_at` on 2026-09-15: 13:52, 08:32, 06:53, and the previous
day). A merchant logs in, opens a few disputes, leaves. **Tens of rows a day
platform-wide; low thousands over 90 days.** Trivial.

The 90-day retention job still ships, as hygiene and because the table grows
with the customer base — not as protection against a problem that exists today.

**Admin page views are a staff-behaviour record.** Logging which merchant pages
our staff opened is useful and is the point — but it is a record of what named
people looked at, retained 90 days. Deliberate, and worth stating in writing
rather than discovering later.

**Latency.** Fire-and-forget is mandatory. A page view that blocks a merchant
render is strictly worse than no telemetry.

## Verification

- `npm test`, `npx tsc --noEmit`, `npm run build`.
- Load `/app/disputes/<id>` as a merchant on dev → one `merchant` row.
- Same page under View-as-merchant → one `admin` row carrying `adminUserId`.
  **This is the test that was attempted three times against the attribution fix
  and never exercised it** — because viewing writes no audit row. Here, viewing
  IS the signal, so a read-mode impersonation session is a valid test.
- Confirm row count tracks navigation (N pages → N rows, no throttle).
- Retention job deletes only `> 90d` and nothing newer.

## Out of scope

- Portal (`/portal/*`) and marketing page views. Embedded app only.
- Client-side SPA transitions that never reach the server.
- Backfill. Impossible — starts at deploy.
