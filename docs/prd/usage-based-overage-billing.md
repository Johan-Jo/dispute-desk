# PRD — Usage-Based Overage Billing

**Status:** Draft (proposal)
**Owner:** TBD
**Created:** 2026-05-21
**Related PRDs:** [`billing-lifecycle-and-merchant-comms.md`](./billing-lifecycle-and-merchant-comms.md) — this PRD builds on the renewal/cycle infrastructure shipped there.

---

## 1. Problem

DisputeDesk currently sells fixed monthly quotas: Starter 20 packs, Growth 100 packs, Scale 400 packs. When a merchant exhausts their quota mid-cycle, three things happen:

1. `lib/billing/checkQuota.ts` returns `{ allowed: false, reason: "Pack limit reached." }`.
2. `lib/automation/pipeline.ts:190–206` calls `recordBlockedAutoBuild()` — every subsequent dispute is **silently parked** awaiting manual top-up or upgrade.
3. The merchant must (a) click into the embedded billing page, (b) choose between `+25 packs ($19)` or `+100 packs ($59)` one-time charges, (c) approve in Shopify, and (d) come back to the queue to manually rebuild parked disputes.

This is the wrong shape for our customer. Chargebacks arrive on a Poisson distribution — a merchant can sit at 60% of quota for three weeks, then catch a Friday-evening fraud spike that puts them 40 disputes over the line on a Saturday morning when no one is watching the embedded UI. By the time someone notices the top-up prompt on Monday, the merchant has missed the bank submission window on several disputes.

**The right shape:** when a merchant on a paid plan reaches their quota, the next automation should proceed automatically and the merchant should be charged for the overage at month-end — within a cap they pre-approved. This is the canonical pattern Shopify Billing supports via *usage charges*.

This PRD specifies that mechanism.

---

## 2. Goals

| Goal | Metric |
|------|--------|
| Merchants who opt into overage are never blocked by quota until they hit their pre-approved cap | Zero `recordBlockedAutoBuild(QUOTA_EXCEEDED)` events for shops with `overage_enabled = true` and `overage_used_cents < overage_cap_cents` |
| Every overage event is itemized and reconciled with Shopify's truth | Daily cron reports 0 drift between our `billing_usage_records` audit table and Shopify's `appUsageRecord` connection |
| Merchants understand exactly what they're being charged before they approve | The Shopify approval screen shows our `terms` string verbatim; the embedded billing page shows current rate, cap, and cycle-to-date overage spend |
| Cap-reached merchants get one clear path forward | `recordBlockedAutoBuild(OVERAGE_CAP_REACHED)` surfaces a single-CTA banner: "Raise overage cap" → re-approval flow |
| Existing paying merchants migrate without dropped revenue | ≥ 90% of opted-in active subscribers complete the re-approval flow within 14 days of prompt |

### Non-goals

- **Eliminating the manual top-up product.** Top-ups remain for merchants who prefer prepay (predictable spend, no cap consent). Overage is *additional*, not a replacement.
- **Calendar-month alignment.** Shopify cycles are 30-day rolling from approval. We accept that and surface "cycle resets in N days" in UX rather than fighting it.
- **Tiered overage pricing within a single plan** (e.g. "first 10 overage packs at $X, next 50 at $Y"). Each plan has one flat overage rate. Revisit if data shows demand.
- **Auto-upgrade-instead-of-overage.** Some apps auto-promote merchants to the next plan when they hit quota. We will not — plan changes carry a different price point and downstream entitlement implications, and the merchant should make that choice deliberately.
- **Currency localization.** Shopify Billing returns USD across the app today. When we localize, the cap value must be re-stated in the shop's billing currency — out of scope for v1.

---

## 3. Current state inventory

| Surface | Exists? | Notes |
|---------|---------|-------|
| `appSubscriptionCreate` mutation (single recurring line item) | ✅ | `lib/shopify/mutations/appSubscriptionCreate.ts`, called from `app/api/billing/subscribe/route.ts:102–109` |
| `app_subscriptions/update` webhook | ✅ | Shipped in [`billing-lifecycle-and-merchant-comms.md`](./billing-lifecycle-and-merchant-comms.md) Phase 2 |
| Monthly credit renewal cron | ✅ | Same PRD, Phase 3 — reuses cycle anchor |
| Manual top-up purchase (`+25` / `+100`) | ✅ | `appPurchaseOneTimeCreate`; `lib/billing/plans.ts` `TOP_UPS` |
| `pack_credits_ledger` (source-tagged credits) | ✅ | `supabase/migrations/015_pack_credits.sql` |
| `pack_usage_events` (consumption log) | ✅ | Same migration |
| `pack_balance` view | ✅ | Same migration |
| **`appUsageRecordPricingDetails` line item on subscriptions** | ❌ | Only `appRecurringPricingDetails` is sent today |
| **`appUsageRecordCreate` mutation wrapper** | ❌ | Not present in `lib/shopify/mutations/` |
| **Overage configuration per plan** | ❌ | `PLANS` config has no rate/cap fields |
| **`overage_*` columns on `plan_entitlements`** | ❌ | |
| **`billing_usage_records` audit table** | ❌ | |
| **Cap-reached merchant flow** | ❌ | |
| **Re-approval migration for existing subscribers** | ❌ | |
| **Embedded UI: overage opt-in toggle + cap disclosure** | ❌ | |
| **Reconciliation cron for usage records** | ❌ | |

---

## 4. Architecture

### 4.1 Shopify's usage-charge model

Shopify supports variable charges via a second `lineItem` on the subscription, typed `appUsageRecordPricingDetails`. Two parameters lock the merchant's exposure:

- **`cappedAmount`** — the maximum we are ever permitted to charge them in a 30-day cycle. Set per-plan, defaults below.
- **`terms`** — human-readable description shown on the approval screen. The merchant *cannot approve the subscription without seeing this string.* This is our consent surface.

After approval we call `appUsageRecordCreate` with a price, description, and the `subscriptionLineItemId` of the usage line. Shopify accumulates these records, refuses any record that would push the cycle total above `cappedAmount`, and charges the merchant at cycle close along with the recurring fee.

**The cap is non-negotiable from the merchant's side.** Raising it requires `appSubscriptionLineItemUpdate`, which triggers a new approval URL — the merchant must explicitly consent to the higher number.

### 4.2 Source of truth

Shopify remains canonical for both the recurring and usage portions of the subscription. Our DB is a denormalized cache:

1. **Synchronous** — `subscribe` → `callback` stores both `subscription_gid` AND `overage_line_item_gid`.
2. **Push** — each successful `appUsageRecordCreate` inserts a `billing_usage_records` row in the same transaction as the pack-consumption event.
3. **Pull** — daily reconciliation cron pulls `appSubscription.lineItems[].usageRecords` for every active overage subscription, compares to our log, and emits a drift alert.

### 4.3 State machine — when do we post a usage record?

```
pack about to be consumed (pipeline or manual finalize)
        │
        ▼
checkQuota(shopId)
        │
   ┌────┴────┐
   ▼         ▼
allowed   !allowed
   │         │
   │         ▼
   │   overage_enabled?
   │         │
   │     ┌───┴───┐
   │     ▼       ▼
   │    no      yes
   │     │       │
   │     │       ▼
   │     │   overage_used_cents + rate ≤ cap?
   │     │       │
   │     │   ┌───┴───┐
   │     │   ▼       ▼
   │     │  yes      no
   │     │   │       │
   │     │   ▼       ▼
   │     │  appUsageRecordCreate
   │     │   │       │
   │     │   ▼       ▼
   ▼     ▼   ▼  recordBlockedAutoBuild(OVERAGE_CAP_REACHED)
proceed  recordBlockedAutoBuild(QUOTA_EXCEEDED)
         (today's behavior)
```

Three things must be true before we post a usage record:
1. Quota is exceeded (we never post for in-quota packs — that would double-charge).
2. `overage_enabled = true` (merchant opted in during approval flow).
3. `overage_used_cents_this_cycle + plan.overage_rate_cents ≤ plan_entitlements.overage_cap_cents`.

If `appUsageRecordCreate` returns `userErrors` (Shopify rejected — usually because the cap was exceeded due to a race), we treat it as cap-reached: insert a `billing_usage_records` row with `status='rejected'`, run `recordBlockedAutoBuild(OVERAGE_CAP_REACHED)`, and surface the raise-cap CTA.

### 4.4 Migration path for existing subscribers

You cannot mutate an active subscription's pricing structure. The migration sequence:

1. Merchant visits embedded billing page → sees new "Enable overage" toggle (off by default).
2. Toggling on triggers `POST /api/billing/subscribe?include_overage=true&plan=<current>`.
3. We create a *new* subscription with both line items, return Shopify's approval URL, redirect.
4. On approval, Shopify auto-cancels the prior subscription. `app_subscriptions/update` webhook handles the swap (existing logic from the lifecycle PRD).
5. Mid-cycle credits transfer over unchanged because they live in our `pack_credits_ledger`, not in Shopify.

**Important:** the recurring price billed in the new subscription resets the 30-day cycle clock. We must show this to the merchant in the toggle disclosure: *"Approving will start a new 30-day billing cycle today. Your prior cycle's unused packs remain available."*

### 4.5 Cap-reached behavior

When a merchant hits their cap, we:

1. Block further auto-builds with `recordBlockedAutoBuild(OVERAGE_CAP_REACHED, { used_cents, cap_cents })`.
2. Render an in-embedded banner: *"You've reached your overage cap of $X this cycle. Raise the cap to keep automating, or wait Y days for cycle reset."*
3. Send one email per cycle (idempotent via `last_overage_cap_email_sent_cycle_end`).
4. Provide a "Raise cap" CTA that calls `appSubscriptionLineItemUpdate` with a new `cappedAmount` and surfaces Shopify's re-approval URL.

We do *not* aggressively warn at 50% / 75% — the cap was chosen by the merchant up-front and they expect to use it. We warn at 80% of cap consumed (email + banner) and at cap reached (email + banner + hard block).

### 4.6 Refunds and reversals

`appUsageRecordCreate` is irreversible from our side. If we charge a merchant for a pack that turned out to be erroneous (duplicate sync, fatal-loss case missed by the gate), the only recovery is a manual refund through Shopify Partners. To minimize this:

- The usage record is created **inside the same DB transaction** as the `pack_usage_events` insert, after all coverage / fatal-loss gates have been checked. If we reach this point, the pack is real.
- We never post a usage record for packs built in *review mode* until the merchant finalizes (the user action is the trigger).
- We never post for parked / blocked builds.

Document the refund process in `docs/technical.md` and link from support page.

---

## 5. Implementation

### 5.1 Plan configuration

Extend `PlanDefinition` in `lib/billing/plans.ts`:

```typescript
export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number;                    // existing
  packsPerMonth: number;            // existing
  // ...
  overage: OverageConfig | null;    // NEW — null = no overage offered (Free plan)
}

export interface OverageConfig {
  rateCents: number;                // price per overage pack, in cents
  defaultCapCents: number;          // pre-filled cap on approval screen
  minCapCents: number;              // floor — merchant cannot set lower
  maxCapCents: number;              // ceiling — preventing pathological consent
  termsTemplate: string;            // i18n key passed to Shopify approval screen
}
```

Recommended values:

| Plan | Base | Quota | Overage rate | Default cap | Min cap | Max cap |
|---|---|---|---|---|---|---|
| Free | $0 | 3 lifetime | — (no overage) | — | — | — |
| Starter | $29 | 20/mo | $2.00/pack | $100 (50 extra) | $20 (10 extra) | $500 (250 extra) |
| Growth | $129 | 100/mo | $1.50/pack | $225 (150 extra) | $30 (20 extra) | $1,500 (1,000 extra) |
| Scale | $299 | 400/mo | $1.00/pack | $400 (400 extra) | $50 (50 extra) | $3,000 (3,000 extra) |

Rates are set above per-pack cost at the same tier so heavy overage users have an incentive to upgrade rather than ride the cap perpetually. Defaults accommodate a single bad week (~2-3× base quota).

### 5.2 Shopify subscribe endpoint

Modify `app/api/billing/subscribe/route.ts` to conditionally include a usage line item:

```typescript
const lineItems: LineItem[] = [
  { plan: { appRecurringPricingDetails: { price: { amount: plan.price, currencyCode: "USD" } } } },
];

if (plan.overage && body.include_overage === true) {
  const capCents = body.overage_cap_cents ?? plan.overage.defaultCapCents;
  assertCapWithinBounds(capCents, plan.overage);
  lineItems.push({
    plan: {
      appUsageRecordPricingDetails: {
        cappedAmount: { amount: (capCents / 100).toFixed(2), currencyCode: "USD" },
        terms: t(plan.overage.termsTemplate, { rate: plan.overage.rateCents / 100, cap: capCents / 100 }),
      },
    },
  });
}
```

The `terms` string is the consent surface. Example: *"Up to $1.50 per evidence pack built above your monthly quota of 100. You will never be charged more than $225.00 per 30-day cycle."*

After approval, the `callback` route reads `node.lineItems` from `appSubscription` query, finds the usage line by pricing-type match, and persists:
- `overage_enabled = true`
- `overage_line_item_gid = <gid>`
- `overage_cap_cents = <agreed cap>`
- `overage_used_cents_this_cycle = 0`

### 5.3 Usage record posting

New file `lib/shopify/mutations/appUsageRecordCreate.ts` wrapping the GraphQL mutation. Returns `{ id, status }` or `{ status: 'rejected', userErrors }`.

New helper `lib/billing/postOveragePack.ts`:

```typescript
export async function postOveragePack(opts: {
  shopId: string;
  disputeId: string;
  packId: string;
  reason: string;       // human-readable, surfaces on Shopify invoice line
}): Promise<{ status: 'charged' | 'cap_reached' | 'disabled' }>
```

Called from `lib/automation/pipeline.ts` immediately before the existing `recordBlockedAutoBuild(QUOTA_EXCEEDED)` branch. Returns `'disabled'` when the merchant has not opted in (fall through to existing block). Returns `'cap_reached'` when Shopify rejects or our pre-check says the next charge would exceed cap (fall through to OVERAGE_CAP_REACHED block).

### 5.4 Reconciliation cron

New cron at `/api/cron/reconcile-overage-records`, hourly (matches the existing billing reconcile cadence). For every shop with `overage_enabled = true`:

1. Query `appSubscription` from Shopify for the current cycle's `usageRecords`.
2. Compare against `billing_usage_records` rows for the same cycle.
3. If drift > 0, log a `billing_usage_drift_detected` audit event and emit ops alert.
4. Update `plan_entitlements.overage_used_cents_this_cycle` to Shopify's authoritative sum.

This catches the edge case where we wrote a `billing_usage_records` row but the Shopify API call failed silently (network drop after request, before response).

### 5.5 Embedded UI

Modify `app/(embedded)/app/billing/page.tsx`:

**New section — "Overage" (visible on paid plans only):**
- Headline: "Allow charges for packs above your monthly quota"
- Toggle: "Enable overage" — off by default
- Disclosure when on: rate, cap, days until cycle reset
- Cycle-to-date overage: "$X.XX charged this cycle (Y packs)"
- Link: "Raise overage cap" → re-approval flow

**Banner additions:**
- 80% of cap consumed: warning banner with "Raise cap" CTA
- Cap reached: error banner with "Raise cap" or "Wait N days" copy
- Drift detected (admin-only): warning banner in admin pipeline view

### 5.6 Portal mirror

Mirror the overage section in `app/(portal)/portal/billing/page.tsx` — read-only display of current cap, rate, and cycle-to-date charge. Toggle and cap-raise actions deep-link into Shopify Admin for approval (cannot complete approval in the portal).

### 5.7 Internationalization

Add to `messages/en.json` under `billing.overage.*`:

```
billing.overage.title
billing.overage.description
billing.overage.enableToggle
billing.overage.disabledNote
billing.overage.rate              // "{amount} per pack above quota"
billing.overage.cap               // "Capped at {amount} per cycle"
billing.overage.cycleEnds         // "Cycle resets in {days} days"
billing.overage.cycleSpend        // "{amount} charged this cycle ({packs} packs)"
billing.overage.raiseCap
billing.overage.banners.warningEighty
billing.overage.banners.capReached
billing.overage.terms.starter     // Shopify approval screen text
billing.overage.terms.growth
billing.overage.terms.scale
billing.overage.refundsLink
```

Translate across all 6 locales (en, de, es, fr, pt, sv) in the same PR. Do not ship English-only — see [`feedback_translate_on_add`](../../memory/feedback_translate_on_add.md).

---

## 6. Data model changes

### 6.1 `plan_entitlements` — new columns

```sql
ALTER TABLE plan_entitlements
  ADD COLUMN overage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN overage_line_item_gid text,
  ADD COLUMN overage_rate_cents integer,
  ADD COLUMN overage_cap_cents integer,
  ADD COLUMN overage_used_cents_this_cycle integer NOT NULL DEFAULT 0,
  ADD COLUMN last_overage_warning_email_sent_cycle_end timestamptz,
  ADD COLUMN last_overage_cap_email_sent_cycle_end timestamptz;

CREATE INDEX plan_entitlements_overage_active_idx
  ON plan_entitlements (overage_enabled)
  WHERE overage_enabled = true;
```

- `overage_rate_cents` denormalized from plan config for audit (rate at time of approval, even if we change defaults later).
- `overage_cap_cents` is the merchant-approved cap, NOT the default.
- `overage_used_cents_this_cycle` resets to 0 on cycle rollover (handled by the existing renewal cron — add the reset to that handler).

### 6.2 New table — `billing_usage_records`

```sql
CREATE TABLE billing_usage_records (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  dispute_id                  uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  pack_id                     uuid REFERENCES dispute_packs(id) ON DELETE SET NULL,
  cycle_started_at            timestamptz NOT NULL,
  cycle_ends_at               timestamptz NOT NULL,
  amount_cents                integer NOT NULL CHECK (amount_cents > 0),
  shopify_usage_record_gid    text,                       -- null until Shopify confirms
  shopify_subscription_line_item_gid text NOT NULL,
  status                      text NOT NULL CHECK (status IN ('pending','charged','rejected','reconciled')),
  reject_reason               text,                       -- populated when status='rejected'
  description                 text NOT NULL,              -- shows on Shopify merchant invoice
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX billing_usage_records_dedupe_idx
  ON billing_usage_records (shop_id, dispute_id, pack_id);

CREATE INDEX billing_usage_records_cycle_idx
  ON billing_usage_records (shop_id, cycle_ends_at);

CREATE INDEX billing_usage_records_status_idx
  ON billing_usage_records (status)
  WHERE status IN ('pending', 'rejected');
```

- Dedupe index prevents double-billing the same (shop, dispute, pack) tuple if the pipeline retries.
- `status` lifecycle: `pending` (we called Shopify) → `charged` (Shopify returned id) → `reconciled` (drift cron confirmed).

### 6.3 New audit event types

Add to the `audit_events` enum (or app-level constant — match whatever the existing migration pattern is):

- `overage_enabled` — merchant approved overage on a new subscription
- `overage_disabled` — merchant cancelled subscription with overage on it
- `overage_cap_raised` — merchant approved a cap increase
- `overage_charge_posted` — successful `appUsageRecordCreate`
- `overage_charge_rejected` — Shopify rejected the usage record
- `overage_cap_reached` — first OVERAGE_CAP_REACHED block of a cycle
- `overage_drift_detected` — reconcile cron found mismatch

### 6.4 RLS

- `billing_usage_records`: `shop_id` scoped, same pattern as `pack_credits_ledger`.
- Service role required to insert; merchants can read their own rows via embedded API.

---

## 7. Implementation phases

Phases are sized so each phase ships independently and the system stays correct between them. Do not bundle.

### Phase 1 — schema + plan config (one PR)
- Migration: `plan_entitlements` columns + `billing_usage_records` table + audit event types.
- `PLANS` config: add `overage` field with values from §5.1.
- `lib/billing/plans.ts` type updates.
- No behavior change — overage is off everywhere.
- Tests: migration applies cleanly, plan config typecheck.

### Phase 2 — subscribe + callback with optional overage (one PR)
- Modify `app/api/billing/subscribe/route.ts` to accept `include_overage` + `overage_cap_cents`.
- Modify callback to detect and persist the usage line.
- New mutation wrapper `appUsageRecordCreate.ts` (not called yet, but unit-tested against fixture).
- Tests: subscribe with overage on/off, callback persists overage fields, cap-out-of-bounds rejection.

### Phase 3 — pipeline branch + usage posting (one PR)
- `lib/billing/postOveragePack.ts` helper.
- Pipeline branch in `runAutomationPipeline()` before the QUOTA_EXCEEDED block.
- Reconcile cron at `/api/cron/reconcile-overage-records`.
- `OVERAGE_CAP_REACHED` attention reason wired into `recordBlockedAutoBuild()`.
- Tests: vitest spies on `appUsageRecordCreate`, full pipeline integration test for overage path, cap-reached path, opt-out path.

### Phase 4 — merchant UX (one PR)
- Embedded billing page: overage section, toggle, banner states.
- Portal billing page: read-only mirror.
- Email templates: 80%-warning, cap-reached, cycle-summary.
- i18n keys across 6 locales.
- Tests: UI renders correctly for each subscription state, banner dismissal per cycle.

### Phase 5 — migration prompt + admin observability (one PR)
- One-shot in-app prompt for existing paid subscribers: "Enable overage to avoid getting blocked."
- Admin pipeline view: per-shop overage usage panel.
- Drift alert email/Slack to ops.
- Docs: update `docs/technical.md` § Billing with the new flow; update help articles `help.embedded.billing.*`.

### Phase 6 — soak + tune (no code change)
- Two-week observation window.
- Review drift rate, cap-reached frequency, opt-in rate.
- Adjust default caps if real-world usage shows they're too tight.

---

## 8. Acceptance criteria

- [ ] Migration applies clean and reverses cleanly on a staging DB
- [ ] `appSubscriptionCreate` with overage produces a Shopify subscription whose approval screen shows the localized `terms` string verbatim
- [ ] Approving creates a `plan_entitlements` row with `overage_enabled = true`, correct `overage_cap_cents`, and `overage_line_item_gid`
- [ ] Pipeline path: in-quota pack → no usage record; overage opted in, under cap → usage record posted, `pack_usage_events` row written, `pack_credits_ledger` NOT debited (overage packs don't burn included credits)
- [ ] Pipeline path: overage opted in, at cap → `recordBlockedAutoBuild(OVERAGE_CAP_REACHED)`, banner appears, email sent once per cycle
- [ ] Pipeline path: overage opted out → existing `QUOTA_EXCEEDED` behavior unchanged
- [ ] Reconcile cron detects manually injected drift (Shopify record without local row, local row without Shopify record) and emits audit event
- [ ] Cycle rollover (renewal cron from billing-lifecycle PRD) resets `overage_used_cents_this_cycle` to 0
- [ ] Cap-raise flow: `appSubscriptionLineItemUpdate` returns approval URL, post-approval `plan_entitlements.overage_cap_cents` reflects the new value
- [ ] Embedded billing page shows: rate, cap, cycle-to-date spend, cycle reset countdown
- [ ] Six locales all carry the new keys; `npm run i18n:check` passes
- [ ] `npm run release:verify` green
- [ ] `docs/technical.md` § Billing updated in same commit as the feature
- [ ] Help article `help.embedded.billing.overage` exists for all 6 locales

---

## 9. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Merchant approves overage, then disputes a charge they didn't anticipate ("I didn't know auto-build would run on weekends") | Medium | Reputational, refund overhead | Make `terms` string extremely explicit; show daily cycle-to-date in embedded UI; send 80%-warning email |
| Race condition between two concurrent pack builds at cap boundary results in one being rejected | Low | UX confusion | Idempotent `billing_usage_records` insert; Shopify's reject is the source of truth; surface clearly to merchant |
| Reconciliation drift due to webhook + cron interleaving | Medium | Audit trail integrity | Hourly cron; drift alert email; admin override path |
| Existing subscribers refuse re-approval, traffic drops to top-up purchases | Medium | Revenue churn | Keep top-up product available; only prompt merchants who've hit quota in past 30 days; track opt-in conversion as a metric |
| Cap-raise flow feels like "Shopify charged me twice" because two approvals appear in merchant inbox in one cycle | Medium | Support load | One-line copy in the raise-cap CTA: "This will replace your current cap, not add a second charge" |
| `appUsageRecordCreate` rate limits during a fraud spike | Low | Some overage packs unbilled | Retry with backoff; `billing_usage_records.status='pending'` rows retried by cron; merchant never blocked due to our retry failure (we eat the cost) |
| Currency mismatch when merchant's billing currency != USD | Low at v1 (USD-only) | Wrong cap displayed | Hard-code USD in `appSubscriptionCreate` until localization PRD ships; document the constraint |
| Reviewer at Shopify App Store rejects because overage line item is opaque | Low | Submission delay | Submit with overage *off* by default; reviewer-facing test path uses recurring-only |

---

## 10. Open questions

1. **Cap default policy.** Should defaults scale with the merchant's recent usage (we saw N disputes last month, cap at N × 1.5) or stay tier-uniform? Lean toward tier-uniform for v1 — easier to explain.
2. **Trial overage.** Should overage be available during the 14-day trial? Tentative answer: no — trial is for evaluation, not consumption. Confirm with go-to-market.
3. **Downgrade with overage on.** If a Scale merchant downgrades to Growth, do we keep their cap or reset to Growth's default? Tentative: reset; cap exceeds Growth's max in many cases.
4. **Refunded charges.** Do we issue credits back to the merchant's `pack_credits_ledger` when an overage charge is refunded? Tentative: no — refund is a Shopify-side concept; we just log the refund event for visibility.
5. **Visibility to bank reviewers / auditors.** Overage charges appear on the merchant's Shopify invoice, but do we need them on the dispute timeline too (so an admin can trace "this pack was billed as overage")? Tentative: yes — emit a dispute event when a usage record is posted.

---

## 11. Test plan

### Unit tests
- `lib/billing/plans.ts`: overage config invariants (min ≤ default ≤ max, rate > 0)
- `lib/billing/postOveragePack.ts`: each return value (`charged` / `cap_reached` / `disabled`)
- `lib/shopify/mutations/appUsageRecordCreate.ts`: success, userErrors, network error
- Cap arithmetic: floating-point safety on cents conversions

### Integration tests
- Subscribe with overage + callback round-trip
- Pipeline with quota exhausted + overage on → usage record posted
- Pipeline with cap reached → block
- Reconcile cron detects manually injected drift in both directions
- Cycle rollover resets cycle-spend counter

### E2E tests (Playwright)
- Merchant enables overage from embedded billing page → Shopify approval URL renders correct `terms`
- 80%-warning banner appears at threshold
- Cap-reached banner appears at cap, raise-cap CTA visible

### Manual QA on Shopify dev store
- Approve subscription with overage, run synthetic seed of 30 disputes (Growth, quota 100, but test with 20-pack quota override), confirm 10 usage records appear in `appSubscription.usageRecords`
- Hit cap deliberately, confirm block + email + banner
- Approve cap raise, confirm new value persists and pipeline resumes

### Forbidden-copy grep
- Add to CI: forbid copy that promises "no surprise charges" or "free overage" anywhere in i18n files — both would be untrue claims.

---

## 12. Links

- [`billing-lifecycle-and-merchant-comms.md`](./billing-lifecycle-and-merchant-comms.md) — renewal/cycle infra this PRD depends on
- Shopify docs — App Billing usage charges: <https://shopify.dev/docs/apps/billing/usage-billing>
- Shopify docs — `appUsageRecordCreate`: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/appUsageRecordCreate>
- Shopify docs — `appSubscriptionLineItemUpdate`: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionLineItemUpdate>
- `lib/billing/plans.ts` — current plan config
- `app/api/billing/subscribe/route.ts:102-109` — current single-line subscribe
- `lib/automation/pipeline.ts:190-206` — current QUOTA_EXCEEDED block path
- `lib/billing/checkQuota.ts` — quota gate return shape
- `supabase/migrations/015_pack_credits.sql` — credit ledger foundation
