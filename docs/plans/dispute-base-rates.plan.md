# Phase 2 — win/loss base rates from the historical corpus

**Status:** PLAN ONLY (v1, 2026-08-29). Not started. Phase 1 shipped as #602 (develop) / #606 (prod, open).
**Deliverable:** per-shop, per-reason win rates computed over the FULL decided corpus — historical imports included — so a merchant can see which dispute types are worth fighting on *their* store. Aggregate only; never a per-case claim.
**Evidence:** prod `aokhplydttxtebvbeuzc`, run 2026-08-29. `scripts/sql/winrate-by-shop-reason.sql`, `winrate-pooled-vs-shop.sql`, `winrate-stability.sql`, `shop-census.sql`.

---

## 1. Why this is now possible

Phase 1 established that historical disputes carry no defence package, so they cannot be *explained* per case. They can still be *counted*. All 466 historical disputes join cleanly to `shopify_orders` (on `order_gid` — both sides are full GIDs), and every decided dispute carries a `reason` and a `normalized_status`.

The corpus is also bigger than Phase 1 measured. A new merchant (`6a8848-dd`) installed **2026-08-29** and imported **521 disputes, 428 already decided** — more than blume-box. Current decided totals (`shop-census.sql`):

| Shop | Installed | Disputes | Decided |
|---|---|---|---|
| `6a8848-dd` | 2026-08-29 | 521 | **428** |
| `blume-box` | 2026-07-20 | 474 | 418 |
| `cay-collective` | 2026-07-02 | 75 | 69 |
| `surasvenne` | 2026-03-04 | 48 | 19 |

Nine other shops have zero disputes. **The feature must render nothing for them** rather than an empty state implying failure.

---

## 2. The finding that decides the design: rates are per-SHOP, not per-reason

`winrate-pooled-vs-shop.sql` compares each shop's rate against the pooled all-shops rate:

| Reason | Pooled | Shop | Shop rate | Delta |
|---|---|---|---|---|
| `PRODUCT_NOT_RECEIVED` | 42.9% (n=331) | cay-collective | **85.2%** | **+42.3** |
| `PRODUCT_NOT_RECEIVED` | 42.9% | blume-box | **16.9%** | **−26.0** |
| `PRODUCT_NOT_RECEIVED` | 42.9% | 6a8848-dd | 46.0% | +3.1 |
| `PRODUCT_UNACCEPTABLE` | 52.7% (n=203) | blume-box | 33.3% | −19.4 |
| `CREDIT_NOT_PROCESSED` | 84.4% (n=45) | cay-collective | 94.6% | +10.2 |
| `FRAUDULENT` | 15.1% (n=317) | blume-box | 12.0% | −3.1 |

**`PRODUCT_NOT_RECEIVED` spans 17%–85% across three shops — a 68-point spread around a 43% pooled mean.** A pooled figure would be wrong for essentially every shop that has it.

**Therefore: never show a cross-shop rate to a merchant.** Compute per shop, and suppress the cell rather than falling back to pooled when a shop's own sample is too thin. A pooled fallback is worse than no number, because it looks like the merchant's own data.

---

## 3. Second finding: rates drift, so a bare number can mislead

`winrate-stability.sql` splits each shop+reason cell at its own median date:

| Shop | Reason | Older half | Newer half |
|---|---|---|---|
| `6a8848-dd` | `PRODUCT_NOT_RECEIVED` | 58.5% (n=118) | **33.3%** (n=117) |
| `blume-box` | `PRODUCT_NOT_RECEIVED` | 21.2% | 12.5% |
| `blume-box` | `FRAUDULENT` | 13.3% | 10.7% |
| `6a8848-dd` | `PRODUCT_UNACCEPTABLE` | 53.4% | 54.5% |
| `cay-collective` | `CREDIT_NOT_PROCESSED` | 94.7% | 94.4% |

Most cells are stable within a few points. **One is not:** `6a8848-dd`'s not-received rate roughly halved across its own history. A single lifetime number would hide that.

**Therefore: bound the window and say so.** Default to a rolling window (proposal: trailing 12 months) with the window named in the UI, and compute the prior period alongside it so a material move can be shown rather than averaged away.

---

## 4. What the merchant sees

A small table on the dashboard — reason, decided count, win rate, direction. Aggregate framing only:

> **How your disputes have resolved** — last 12 months
> | Dispute type | Decided | You won |
> |---|---|---|
> | Refund not processed | 37 | 95% |
> | Product not received | 27 | 85% |
> | Fraud / unauthorized | 300 | 12% ↓ |

Copy rules, carried from Phase 1 and non-negotiable:

1. **Descriptive, never predictive.** "How your disputes have resolved" — not "you will lose this one", and never a per-case probability. The historical corpus has none of the per-case evidence that would justify one (`signed_by_name` is 0/466; AVS/CVV absent).
2. **Never advise conceding.** A low rate is context, not an instruction to stop fighting. Deciding what to file is the merchant's call and is already governed by the fatal-loss and coverage gates.
3. **Includes disputes we did not defend.** These are outcomes of the *store*, not of DisputeDesk. The heading must not imply the rates measure our performance — that comparison is item 3 in §6 and needs both corpora.
4. **Suppress thin cells.** Below the §5 threshold, render nothing for that reason. No "0%" on n=1.

---

## 5. Thresholds and mechanics

- **Minimum cell size: n ≥ 20** for a displayed percentage. At n=20 the 95% CI is roughly ±20 points, which is already wide; below that the number is noise. Cells of 5–19 may show the raw count with no percentage.
- **Window: trailing 12 months**, by `initiated_at`, with the label stating it. Compute the preceding 12 months for the direction arrow; show an arrow only when the move exceeds the noise floor (proposal: 10 points AND both periods ≥ 20).
- **Per shop always.** No pooled fallback (§2).
- **Reason granularity is the coarse Shopify enum.** Sub-reason slicing (4837 vs 4853) needs `reasonDetails { networkReasonCode }`, which exists and is populated but is never selected — only 40 of 382 losses have one stored. Out of scope here; see §6.
- **Do NOT build on `delivery_status`.** Its correlation runs backwards: `Delivered` shows a *lower* win rate (22%) than no delivery data (34%), almost certainly because delivered-and-still-disputed skews fraud. A naive factor would tell merchants delivery proof hurts them.
- **Reuse `lib/disputes/metrics.ts`** where it already aggregates decided disputes rather than adding a parallel aggregation path.
- **Denominator: `won / (won + lost + accepted)`** — `accepted` counts as a loss, the convention already fixed at `metrics.ts:326-336` (plan §13.1, decision 2026-07-24); `refunded`, `partially_won`, `expired`, `canceled` stay excluded. **The current corpus contains zero `accepted` rows** (`accepted-impact.sql`), so both conventions give identical numbers today — which is exactly why it must be written the established way now. If a later shop starts accepting liability, a locally-invented denominator would silently disagree with the dashboard's Win Rate tile on the same screen.
- **The label must disclose the definition**, as `metrics.ts` already requires of the Win Rate tile.

---

## 6. Sequencing

1. **Base-rate query + view model**, per shop per reason, windowed, thresholded. Pure function over rows, unit-tested against the fixtures in this plan.
2. **Dashboard surface** — the §4 table, 6 locales, suppressed entirely for the nine zero-dispute shops.
3. **DisputeDesk-vs-baseline comparison** — *"we win fraud disputes at X% against your historical Y%"*. **Blocked**: only 42 disputes have a defence package, versus 1,000+ decided historically. Deferred until the defended corpus is large enough per shop to compare honestly; a comparison drawn on 42 cases would be marketing, not measurement.
4. **`reasonDetails { networkReasonCode }`** — one-line query change unlocking sub-reason rates. Independent of this plan and worth doing regardless.

---

## 7. Placement — resolved: the Analytics page

`app/(embedded)/app/analytics/page.tsx` already renders **both halves of this and never crosses them**:

- **"Disputes by reason"** (`byReason`, `:204`) — a per-reason volume share, as progress bars. How *many* of each type.
- **Win rate** (`:130`) and **win-rate trend** (`:176`) — a single all-reasons number. How often you win, overall.

So the page tells a merchant that 46% of their disputes are not-received, and separately that they win 43% of everything — but never that they win **17%** of not-received and **95%** of refund-not-processed. That cross-tab is precisely this feature, and it belongs next to the two cards it completes.

**Not the Reports section.** #603–#605 are `scripts/`-only ops tooling — zero files under `app/` or `lib/` — so there is no merchant-facing reports surface to put this in.

**Not the dashboard.** The dashboard's KPI strip is a fixed-height summary; a variable-length per-reason table belongs on the page built for breakdowns.

**Reuse, do not duplicate:** the reason labels already resolved for `disputeCategories`, and the `winRate` denominator from `metrics.ts` (§5).

---

## 8. Open questions

1. **Lifetime or 12-month default?** A shop that installed today (`6a8848-dd`) has no post-install history, so a 12-month window is entirely historical either way. Naming the window handles it honestly; the default is a product call.
2. **Do we show reasons with zero or near-zero wins?** `SUBSCRIPTION_CANCELLED` at blume-box is 1/17. Truthful, and possibly demoralising with no action attached — though arguably the single most decision-useful cell on the page.
3. **Does the existing `byReason` card get replaced or joined?** A merged card (volume % + win rate per reason) is one table instead of two, but it changes a shipped surface — a design call under CLAUDE.md #8, not mine to make unilaterally.
