# Visa Compelling Evidence 3.0 (CE3.0) for fraud disputes — feasibility + plan

**Status:** feasibility measured on PROD data 2026-07-23. Needs a decision before building.
**Origin:** the Visa-guidelines defense audit ([[defense-audit-vs-visa-guidelines]]) S1#4 — we have no CE3.0 pathway, and `customer_account_info` scores **strong on a single prior order**, a far weaker bar than CE3.0 actually requires.

## What CE3.0 requires (Visa 10.4 remedy)
- **2+ prior undisputed transactions** from the same cardholder,
- dated **>120 and <365 days** before the dispute,
- sharing **≥2 matching data elements** with the disputed order, **at least one of which must be IP address or device ID** (others: account ID, delivery address).

## Data we actually have (measured on prod, not assumed)

| Source | Rows | Notes |
|---|---|---|
| `shopify_orders` | 374,150 (373,909 w/ `customer_shopify_id`) | has `processed_at`, `has_chargeback` → window + undisputed test |
| `shopify_order_risk_signals.client_ip` | 268,507 of 367,852 (~73%) | **the IP source; backfilled historically** |
| `checkout_sessions` (`ip_hash`, `user_agent`) | 1,485 | Web Pixel, **forward-only** — no historical device data, not backfillable |

Join keys confirmed: `disputes.order_gid` = `shopify_orders.shopify_order_id` (**full GID**, do NOT strip the prefix) and `shopify_order_risk_signals.shopify_order_id` = same GID.

**Fraud-dispute coverage: 360 of 377 fraud disputes join to a stored order; 346 (92%) have `client_ip`.** So the data plumbing for CE3.0 exists.

## The finding that changes the plan

Running the full CE3.0 test over those 360 fraud disputes:

| Test | Count |
|---|---|
| Fraud disputes evaluated | 360 |
| Have **2+ prior undisputed orders in the 120–365d window** | **12** |
| Same, **AND** ≥2 of those priors share the disputed order's IP | **0** |

**Zero currently qualify for a full CE3.0 remedy.** Only 12 (3.3%) even clear the transaction-count + time-window gate, and none of those have IP continuity across the priors.

Interpretation — this is a *repeat-customer-base* property, not a data bug: our merchants' fraud disputes are overwhelmingly on customers with no qualifying purchase history 4–12 months back, and returning customers rarely keep a stable IP across that span (mobile/CGNAT/dynamic IPs make IP a poor longitudinal identifier). Device ID would be the better matcher, and we only accrue that going forward via the pixel.

## CORRECTION (2026-07-23, after challenge) — device/IP IS backfillable

An earlier draft of this doc claimed device ID "cannot be backfilled" because `checkout_sessions` (our Web Pixel table) is forward-only. **That was wrong** — it reasoned from our own table instead of checking what Shopify persists on the order. Verified against Shopify docs:

- **REST `Order.client_details`** carries `browser_ip`, `session_hash`, `user_agent`, `accept_language`, `browser_height`, `browser_width` — **stored read-only ON THE ORDER**, therefore fetchable retroactively for historical orders.
- **GraphQL `Order.clientIp`** exists too ("The IP address of the customer who placed the order. Useful for fraud detection"), though the richer `client_details` bundle is REST-only.
- Historical access needs the **`read_all_orders`** scope — **which we already hold** (approved as a Protected Customer Data scope 2026-05-10 for prod; the backfill already anchors to 2010-01-01, not the 60-day default).

So a real CE3.0 backfill IS buildable: re-fetch historical orders including `client_details` and persist `browser_ip` + `session_hash`/`user_agent` per order, giving both a durable device-ish identifier AND per-order IP for the matching test.

**Caveat to measure, not assume:** Shopify community reports say `client_details` is empty for some orders (notably orders created via API/POS/draft rather than online checkout). Coverage must be sampled before committing — that determines whether CE3.0 becomes viable or just moves the bottleneck.

**Also note:** the 0-of-360 qualification result above was computed using `shopify_order_risk_signals.client_ip` only. It shows *IP alone* doesn't carry across a 4–12 month gap — it does NOT rule out CE3.0 via `session_hash`/`user_agent`, which were never tested because we don't store them yet. The "defer CE3.0" recommendation below is therefore **superseded**: the right next step is to backfill `client_details` and re-measure.

## SPIKE RESULT (2026-07-23) — measured, not assumed

Ran `scripts/ce3-client-details-spike.mjs` (read-only) against **blume-box.myshopify.com** with the live offline token. `read_all_orders` confirmed granted.

**1,000 most-recent orders** (the window CE3.0 cares about — priors must be <365 days old):

| Field | Coverage |
|---|---|
| `client_details` present | **76.3%** |
| `browser_ip` | **76.0%** |
| `user_agent` | **75.3%** |
| `session_hash` | **0.0%** |

**750 oldest orders (all 2018):** only **8.9%** have `client_details` at all.

### Reading the numbers
- **`client_details` IS backfillable and well-populated on recent orders (~76%).** The earlier "can't backfill device data" claim is definitively wrong.
- **`session_hash` is dead** — 0% across 1,750 sampled orders. Shopify still documents the field but no longer populates it. Do NOT design around it.
- **`user_agent` is the usable device identifier** at ~75% coverage. It is weaker than a true device ID (not unique per device — many users share a common UA string), so it should be used as a *corroborating* element combined with IP, not as a standalone device fingerprint.
- **Coverage collapses on old orders** (8.9% in 2018). Irrelevant for CE3.0 (priors must be <365 days) but it rules out deep-history analytics built on this field.
- The ~24% gap on recent orders is consistent with Shopify's documented behaviour: orders not placed through online checkout (POS, API-created, draft) carry no client details.

### Revised CE3.0 verdict
The blocker is NOT data availability — we can backfill IP + user-agent for ~3 of 4 recent orders. The blocker measured earlier stands on its own: of 360 prod fraud disputes, only **12 (3.3%)** have 2+ prior undisputed orders in the 120–365 day window at all, before any element matching. **The transaction-history precondition, not the data, is what gates CE3.0 for this merchant base.**

So: build the backfill (it's cheap and unlocks matching), but expect CE3.0 to qualify on a small minority of disputes. Re-run `scripts/sql/_ce3_feasibility.sql` after backfilling `browser_ip`/`user_agent` per order to get the true qualification rate with real element matching.

## What this means

1. **Building a full CE3.0 signal today would fire on ~0% of our fraud disputes.** It is NOT the highest-value fraud work despite being the "correct" Visa remedy. The audit ranked it S1 on correctness grounds; the data says the *impact* is currently nil.
2. **The genuine, immediate defect is the other half of the finding:** `customer_account_info` scoring **strong on one prior order** overstates account history as decisive fraud evidence. That is real today (4 of 11 strong fraud packs in prod have ≥1 prior order). Fixing that is small, safe, and honest.
3. **CE3.0 becomes worth building once device-ID data accumulates** from `checkout_sessions` (pixel), because device ID is the durable matcher IP isn't. Revisit when pixel coverage is material.

## Recommendation (needs sign-off)

**Do now (small):** demote `customer_account_info` from `strong` to `moderate` for the **fraud** family — a returning customer is corroboration, not decisive proof of cardholder identity. Keep strong for non-fraud families where prior history is genuinely supportive. This removes the false CE3.0 proxy without pretending we have the real thing.

**Defer (measure first):** the full CE3.0 signal (`prior_transaction_footprint`: 2+ priors, 120–365d, ≥2 matching elements incl. IP/device). Revisit when `checkout_sessions` has enough device history to make matching viable — re-run the query in this doc to decide.

**Do NOT:** backfill more IP hoping to unlock CE3.0 — the measurement above shows IP continuity across a 4–12 month gap is the binding constraint, not IP coverage (we already have 92% on fraud disputes).

## Re-run the feasibility measurement
`scripts/sql/_ce3_feasibility.sql` (kept in-repo). Re-run periodically; if `qualify_full_ce3` starts climbing, build the signal.
