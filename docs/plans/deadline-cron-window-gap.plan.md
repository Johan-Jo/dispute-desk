# Deadline crons cannot reach deadlines before 08:00 UTC

Status: FIXED — PR #736 open to develop (2026-09-16)
Severity: live scheduling defect, silent, currently forfeiting responses
Found while investigating `docs/plans/tracking-app-delivery-signals.plan.md` — but
**independent of it**. Fix this regardless of what happens to the ParcelPanel work.

## 1. The defect

Both deadline crons select disputes by **calendar day in UTC**, then run at a fixed
hour. Any deadline earlier than that hour is therefore either invisible (the day
before) or already expired (on the day).

`app/api/cron/defence-package-deadline-submit/route.ts:122-126`:

```ts
const now = new Date();
const startOfToday = new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
// ... .gte("due_at", startOfToday) .lt("due_at", endOfToday)
```

The comment directly above it (lines 119-121) states the *intended* behaviour:

> *"We scan for `due_at` within the next 24h (i.e. due today or before tomorrow's
> 08:00 UTC) so the morning cron catches deadlines that fall later the same day."*

That intent is a **rolling 24 h from the run**. The code implements a **calendar
day**. For deadlines at or after 08:00 the two coincide, which is why this has never
been noticed.

`app/api/cron/defence-package-deadline-rebuild/route.ts:87-104` has the **identical**
window, so an early-morning deadline gets neither a pre-deadline rebuild (06:00) nor
a submit (08:00).

### 1.1 Worked example — `4b81afe1`, due 2026-09-17 03:00 UTC

| run (UTC) | window | due in window? | already expired at run? |
|---|---|---|---|
| 2026-09-16 08:00 | [09-16 00:00 .. 09-17 00:00) | **no** | no |
| 2026-09-17 08:00 | [09-17 00:00 .. 09-18 00:00) | yes | **yes, by 5 h** |

The Sep 16 run cannot see it. The Sep 17 run selects it and attempts to file five
hours after Shopify closed the window. Verified by replaying the arithmetic.

## 2. Exposure — measured, and stated carefully

Every dispute with a `due_at` in `[00:00, 08:00)` UTC is affected. In prod:

| due hour UTC | disputes | never filed |
|---|---|---|
| 00–02 | 5 | 0 |
| **03** | **321** | **319** |
| 04–07 | 37 | 35 |

**The "319 never filed" figure is NOT 319 losses, and must not be reported as such.**
Of the 321 disputes with an 03:00 deadline: **201 `won`, 71 `lost`, 6 still open.**
Most are inquiries Shopify resolves without merchant evidence, so the counterfactual
"we would have won these if we had filed" is unsupported. The figure measures
*exposure* — cases where the system silently declined to act — not realised damage.

What the 71 `lost` cases cost, and how many of those were winnable, is **not
established**. Determining that is worthwhile but is not a blocker for the fix.

### 2.1 Open right now — 6 disputes, EUR 281.47

Live, `needs_response`, unfiled, deadline before 08:00 UTC, not conceded:

| dispute | order | amount | due (UTC) |
|---|---|---|---|
| `4b81afe1` | #98141 | 37.90 | **2026-09-17 03:00** |
| `83bc28ad` | #98289 | 19.95 | **2026-09-17 03:00** |
| `936beb53` | #97282 | 83.86 | 2026-09-23 03:00 |
| `09280c2c` | #89727 | 56.86 | 2026-09-24 03:00 |
| `a0d6294b` | #99967 | 40.00 | 2026-09-25 03:00 |
| `c23ba74d` | #97443 | 42.90 | 2026-09-26 03:00 |

All on `6a8848-dd`. **Two expire tonight.** Note `83bc28ad` (#98289) has nothing to
do with YunExpress or returned parcels — it is `review_state = NULL`, an ordinary
dispute that will simply never be filed. That is the clearest demonstration that this
defect is independent of the carrier work.

The four later ones are recoverable by fixing the cron before their deadlines.

## 3. Fix — IMPLEMENTED in PR #736

Shipped as `lib/cron/deadlineWindow.ts`, applied to all three call sites: the
canonical submit route, `legacyRoute.ts` (the path that actually runs while
`CANONICAL_PIPELINE` is off — fixing only the canonical route would have changed
nothing in prod), and the rebuild route. Margins: submit 2h, rebuild 4h.

Tests: `tests/unit/deadlineWindow.test.ts` (12 passing), confirmed to FAIL against
the old calendar-day window — both core assertions flip, so they discriminate rather
than passing for the wrong reason. Prod dry run: all 11 open early-deadline disputes
move from `reachable_old=false` to `reachable_new=true`. Most are `needs_review`, so
the gain lands mainly via the rebuild cron, which includes that status.

Original proposal follows.

### 3.0 Proposed shape

Replace the calendar-day window with the rolling window the comment already
describes, in **both** routes:

```ts
// Deadlines from now until the next run of this cron (+ margin), so a
// deadline earlier in the day than the cron hour is caught the run BEFORE
// it expires, not the run after.
const now = new Date();
const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000 + MARGIN_MS);
// .gte("due_at", now.toISOString()) .lt("due_at", horizon.toISOString())
```

Three properties this must have:

1. **Never select an already-expired deadline.** `due_at >= now()` replaces
   `>= startOfToday`. Filing after expiry is wasted work and pollutes the audit trail
   with attempts that cannot succeed. (Today the Sep 17 run *would* attempt exactly
   that.)
2. **Horizon strictly greater than the cron interval**, so every deadline is seen by
   at least one run before it expires. With a daily cron the horizon must exceed 24 h;
   `MARGIN_MS` of 2–4 h gives slack for a late or skipped run without double-filing
   (the `evidence_saved_to_shopify_at IS NULL` filter already makes re-selection
   harmless).
3. **The rebuild cron's horizon must lead the submit cron's**, preserving the existing
   06:00→08:00 ordering intent: a pack should be rebuilt before it is filed, not after.

### 3.1 Alternative considered and rejected

Adding a second daily run (e.g. 02:00 UTC) would catch 03:00 deadlines but leaves
00:00–02:00 broken and doubles cron load. It treats the symptom. The window is the
bug; fix the window.

### 3.2 Not in scope

Changing *which* disputes are eligible (the `review_state` / `normalized_status`
filters) is out of scope. This fix changes **when** the existing selection runs, and
nothing else. Any eligibility change is a separate product decision.

## 4. Risk

The fix makes the cron file disputes it previously ignored. That is the point, but it
means:

- **First run after deploy will pick up a backlog** of early-deadline disputes inside
  the new horizon. With 6 open that is small and inspectable, but it must be dry-run
  first (`summary` without enqueueing) and the selected set read before enabling.
- Packs for these disputes may be stale, having never been through the 06:00 rebuild.
  The rebuild-cron fix must land **with or before** the submit-cron fix, or the first
  corrected run files day-old packs. Ship them together.
- This interacts with the freshness work in the ParcelPanel plan (§8.1 there): once
  both land, an early-deadline dispute gets a rebuild, a freshness check, and then a
  filing. Neither plan is sufficient alone, and neither blocks the other.

## 5. Verification

- **Unit**: replay the window for deadlines at 00:00, 03:00, 07:59, 08:00, 23:59 and
  assert each is selected by exactly one run that precedes it. Pin the `4b81afe1`
  case (03:00 on 09-17) — currently selected only by a run 5 h late; after the fix,
  selected by the 09-16 08:00 run, 19 h early.
- **Unit**: assert no already-expired `due_at` is ever selected.
- **Unit**: rebuild-cron horizon leads submit-cron horizon.
- **Dry run in prod** against the live table, printing the selected set, before the
  first live run.
- `npm test`, `npx tsc --noEmit`.

## 6. Verified vs assumed

**Verified (prod / code, 2026-09-16):**
- Both cron routes use the identical calendar-day window (`route.ts:122-126`,
  `deadline-rebuild/route.ts:87-104`).
- The comment at `route.ts:119-121` describes a rolling window the code does not
  implement.
- Window arithmetic replayed for both candidate runs against `4b81afe1`.
- Hour distribution of `due_at` across all prod disputes.
- Outcome split for the 321 03:00-deadline disputes (201 won / 71 lost / 6 open).
- The 6 currently-open at-risk disputes, with amounts and deadlines.
- `4b81afe1`'s window is open per Shopify Admin REST (`needs_response`,
  `evidence_sent_on` NULL) as of 17:23 UTC 2026-09-16.

**Assumed:**
- That no other scheduled path files these disputes. Only the deadline cron and
  merchant action were found, but a full audit of enqueue paths was not done.
- That the 71 `lost` 03:00-deadline cases were affected by this defect rather than
  lost on merits. **Not established** — they may have been unwinnable anyway.
- That `due_at` reliably mirrors Shopify's `evidence_due_by`. True for `4b81afe1`
  (exact match), unverified across the book.

## 7. Open questions

1. Ship the window fix on its own (recommended), or bundle with the ParcelPanel
   freshness work? They are independent; bundling delays this one.
2. `MARGIN_MS` — 2 h, 4 h, or make the horizon explicit (`now + 26 h`)?
3. Should the 71 historical `lost` 03:00-deadline cases be reviewed to quantify real
   damage, or is exposure enough to justify the fix?
4. The two disputes due tonight (2026-09-17 03:00) cannot be saved by a code fix in
   time. Decide them individually — see the ParcelPanel plan §2.3 for `4b81afe1`;
   `83bc28ad` (#98289) has not been investigated at all and may be perfectly
   filable.
