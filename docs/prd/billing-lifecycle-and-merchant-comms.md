# PRD — Shopify Billing Lifecycle & Merchant Communications

**Status:** Draft (proposal)
**Owner:** TBD
**Created:** 2026-05-15
**Trigger incident:** Dispute `bd425f70-e62e-42ce-8cfc-44375aa34a6b` on `surasvenne.myshopify.com` synced cleanly but the automation pipeline silently aborted because the merchant's billing cycle had rolled over 11 days earlier and no process exists to renew monthly credits. See [`scripts/sql/unblock-surasvenne-2026-05-15.sql`](../../scripts/sql/unblock-surasvenne-2026-05-15.sql) for the one-shot fix.

---

## 1. Problem

DisputeDesk charges merchants via Shopify Recurring Application Charges, but the **subscription lifecycle is fire-and-forget**:

- `POST /api/billing/subscribe` creates the charge.
- `GET /api/billing/callback` activates the plan once, grants one cycle of credits, sets `plan_entitlements.billing_cycle_ends_at` 30 days out.
- **Nothing else ever runs.**

Result:
- Monthly `monthly_included` credits are granted once, expire at the cycle end, and are never replenished — the merchant's `pack_balance.remaining_packs` silently goes to zero ~30 days after install.
- `runAutomationPipeline()` returns `quota_exceeded` and exits without emitting an audit event, dispute event, or merchant email.
- The merchant sees new disputes appear in their list with empty evidence packs, no auto-build, and no explanation — exactly the failure mode we just reproduced.
- We have no visibility when Shopify renews a charge, when a payment fails, when a merchant cancels, or when a trial converts to paid.

This PRD closes the loop.

---

## 2. Goals

| Goal | Metric |
|------|--------|
| Monthly credits replenish automatically on every billing cycle | 100% of active paid shops have `remaining_packs ≥ plan.packsPerMonth` within 1 hour of `billing_cycle_ends_at` |
| Subscription state in our DB mirrors Shopify's truth | < 5 min lag from Shopify event to local `plan_entitlements` update (measured against Shopify's `app_subscriptions/update` webhook timestamp) |
| Merchants are told when something needs their attention | Zero unexplained `quota_exceeded` / `feature_blocked` pipeline exits — every silent skip becomes a visible event + notification |
| Trial expiry, payment failure, cancellation, and reactivation each surface to the merchant before the next dispute lands | At least one of: email, in-embedded banner, portal banner |
| Recover from missed webhooks | Reconciliation job catches drift within 24 h |

### Non-goals

- Custom payment processors (we use Shopify Billing exclusively).
- Self-serve plan downgrades (today: contact support — keep that policy).
- Currency localization (Shopify Billing returns USD; revisit when we expand).
- Invoice / receipt generation (Shopify owns this).

---

## 3. Current state inventory

| Surface | Exists? | Notes |
|---------|---------|-------|
| `appSubscriptionCreate` mutation | ✅ | `lib/shopify/mutations/appSubscriptionCreate.ts` |
| `verifyAppCharge` | ✅ | Verifies a charge with Shopify before granting credits |
| `plan_entitlements` table | ✅ | `shop_id`, `plan_key`, `billing_cycle_started_at`, `billing_cycle_ends_at`, `trial_ends_at` |
| `pack_credits_ledger` | ✅ | Source-tagged grants with `expires_at` |
| `pack_balance` view | ✅ | `remaining = sum(unexpired packs) − sum(used packs)` |
| Subscribe + callback routes | ✅ | One-time grant only |
| Top-up callback | ✅ | One-off purchase grants extra credits |
| **Renewal cron** | ❌ | **Missing — root cause of incident** |
| **`app_subscriptions/update` webhook** | ❌ | No handler |
| **Trial-end notification** | ❌ | |
| **Payment-failed notification** | ❌ | |
| **Renewal-success notification** | ❌ | |
| **`quota_exceeded` merchant visibility** | ❌ | Pipeline returns silently |
| **`feature_blocked` merchant visibility** | ❌ | Same |
| Embedded billing UI | ✅ | `app/(embedded)/app/billing/page.tsx` |
| Portal billing UI | ✅ | `app/(portal)/portal/billing/page.tsx` |

---

## 4. Architecture

### 4.1 Source of truth

**Shopify is canonical** for subscription state. Our DB is a denormalized cache. We update it via three channels:

1. **Synchronous** — `POST /api/billing/subscribe` → `GET /api/billing/callback` (charge created and approved).
2. **Push** — `app_subscriptions/update` webhook (renewals, cancellations, payment failures).
3. **Pull** — reconciliation cron polls `appInstallation.activeSubscriptions` for shops whose `billing_cycle_ends_at < now()` OR whose last webhook is > 24 h stale.

The pull channel exists because webhooks are at-least-once and can be missed entirely (Shopify drops after retry exhaustion). Without it, a single missed webhook strands a merchant for a month.

### 4.2 State machine — `plan_entitlements.subscription_state` (new column)

```
trialing → active → grace → expired
             ↓        ↓
        cancelled  cancelled
```

| State | Meaning | Auto-pack allowed? |
|-------|---------|---------------------|
| `trialing` | Inside trial window | ✅ (trial packs only) |
| `active` | Paid, current | ✅ |
| `grace` | Payment failed within last 3 days, Shopify is retrying | ✅ (read-only grace) |
| `expired` | Payment failed > 3 days, or cycle rolled over without renewal | ❌ — merchant must reactivate |
| `cancelled` | Merchant cancelled the Shopify billing subscription | ❌ — read-only, packs preserved |

> **`cancelled` ≠ uninstalled.** `subscription_state = cancelled` only
> reflects the Shopify billing subscription status. The app
> installation may still be live (and `app-uninstalled` webhook
> handling is a separate concern, today driven by `shops.uninstalled_at`).
> A future iteration may add an explicit
> `installed | uninstalled | access_revoked` installation state on
> `shops`; until then, do NOT infer install status from
> `subscription_state`. **No automation runs for uninstalled shops** —
> `runAutomationPipeline` and every cron must check `shops.uninstalled_at`
> before touching shop data.

Transitions are driven by `app_subscriptions/update` webhook events + the reconciliation pull. **No state transition happens implicitly — every transition writes an audit event and (when merchant-facing) a notification.**

### 4.3 Credit granting model

Credits are granted **once per billing cycle**, keyed by the cycle's `period_end` timestamp:

```
pack_credits_ledger row:
  shop_id,
  source = 'monthly_included',
  packs = plan.packsPerMonth,
  expires_at = next_cycle_end,
  reference = `monthly_${shop_id}_${cycle_end_iso}`  -- UNIQUE INDEX dedupe
```

A new `UNIQUE INDEX` on `(shop_id, reference)` prevents double-granting if a webhook and the renewal cron both fire for the same cycle.

---

## 5. Implementation

### 5.1 New webhook: `app_subscriptions/update`

**Route:** `app/api/webhooks/app-subscriptions-update/route.ts`
**Topic:** `APP_SUBSCRIPTIONS_UPDATE` (register via Shopify CLI / `shopify.app.toml`)

**Payload shape** (Shopify):
```json
{
  "app_subscription": {
    "admin_graphql_api_id": "gid://shopify/AppSubscription/123",
    "name": "Growth",
    "status": "ACTIVE",
    "admin_graphql_api_shop_id": "gid://shopify/Shop/...",
    "created_at": "...",
    "updated_at": "...",
    "currency": "USD",
    "current_period_end": "2026-06-15T00:00:00Z"
  }
}
```

**Handler logic:**

```
1. Verify HMAC (existing helper).
2. Resolve shop_id via shop_domain in the X-Shopify-Shop-Domain header.
3. Re-fetch `appInstallation.activeSubscriptions` from Shopify (do not trust webhook
   payload alone — it can be replayed).
4. For each active subscription:
   - Map `status` → subscription_state:
       ACTIVE    → active
       FROZEN    → grace
       CANCELLED → cancelled
       EXPIRED   → expired
       DECLINED  → expired
       PENDING   → trialing (ONLY when trial_ends_at is in the future)
                   → expired   (otherwise — see §6 open question, plus
                                the defensive-mapping rule below)
   - Update plan_entitlements (state, billing_cycle_started_at, billing_cycle_ends_at).
   - If state transitioned to active AND last `monthly_included` grant for this
     cycle is missing → grantCredits(plan.packsPerMonth, expires_at = period_end).
   - Insert audit_events row: subscription_state_changed.
5. Enqueue a notify job (see §5.5).
```

> **PENDING mapping is defensive.** Blindly mapping `PENDING → trialing`
> let a non-trial pending charge (e.g. mid-approval, declined-then-retrying)
> falsely unlock auto-build. The fix:
>
> ```ts
> if (status === "PENDING" && trialEndsAt && new Date(trialEndsAt) > new Date()) {
>   subscriptionState = "trialing";
> } else if (status === "PENDING") {
>   subscriptionState = "expired"; // merchant must reauthorize the charge
> }
> ```
>
> Adding a dedicated `pending` state to the enum would mean threading
> it through quota checks, banner copy, billing-page UI, and lifecycle
> emails. Not in scope for this PRD — keep PENDING collapsed into
> `trialing` or `expired` based on the trial-window check.

**Idempotency:** the `pack_credits_ledger` unique index on `reference` is the safety net.

### 5.2 Billing reconciliation cron

**Route:** `app/api/cron/reconcile-billing-cycles/route.ts`
**Schedule:** `0 * * * *` (hourly — fast enough that a merchant who renewed mid-hour doesn't wait the full hour for credits, slow enough not to hammer Shopify).

> **Naming note.** This job is intentionally called *billing
> reconciliation*, not *renewal*. The name reflects what it actually
> does: verify Shopify subscription truth, catch missed
> `app_subscriptions/update` webhooks, grant any missing
> `monthly_included` credits for the current cycle, transition shops
> whose subscriptions lapsed to `expired`, and emit the matching
> audit + email events. "Renewal" implies a single happy-path action;
> the job is a full state-reconciliation loop.

```
1. SELECT plan_entitlements WHERE billing_cycle_ends_at < now() + interval '1 hour'
                                  AND subscription_state IN ('active','trialing')
2. For each row:
   - Pull `appInstallation.activeSubscriptions` from Shopify.
   - If active sub exists with period_end > our billing_cycle_ends_at:
       → run the same update + credit grant as the webhook path.
   - If no active sub:
       → transition to `expired`, emit notification.
3. Audit event per shop processed.
```

This is the safety net. The webhook is the fast path; the cron catches dropped webhooks.

### 5.3 New cron: `expire-grace`

**Route:** same file, second pass.
**Schedule:** daily.

```
1. SELECT plan_entitlements WHERE subscription_state = 'grace'
                                  AND updated_at < now() - interval '3 days'
2. Transition to `expired`, notify merchant, audit event.
```

Shopify normally finalizes a frozen subscription within 3 retry attempts (~3 days). After that, we stop hoping and surface the failure to the merchant.

### 5.4 Pipeline visibility fixes (shipped 2026-05-15)

`lib/automation/pipeline.ts:runAutomationPipeline` previously exited silently on three branches:

```ts
if (!settings.auto_build_enabled) return { action: "skipped_auto_build_off" };
if (!quota.allowed)                return { action: "quota_exceeded" };
if (!featureCheck.allowed)         return { action: "feature_blocked" };
```

Each branch now calls a shared `recordBlockedAutoBuild` helper that:

1. Inserts an `audit_events` row (`event_type: 'auto_build_skipped'`, payload includes the canonical reason + a typed payload — quota numbers, plan id, etc.).
2. Emits a `PACK_BLOCKED` `dispute_event` so the timeline shows it.
3. Updates `disputes`:
   - `needs_attention = true`
   - `attention_reason = <canonical constant from lib/disputes/attentionReasons.ts>`
   - `attention_payload = <structured object>` (quota numbers, plan id, etc.)
   - `next_action_type = 'billing'`
   - `next_action_text = <merchant-readable copy>`
4. Calls `claimAndSendDeferredNewDisputeAlert(disputeId, 'review')` subject to the **billing-blocked email throttle** (see §5.4.1).

The new structured columns (`attention_reason`, `attention_payload`) shipped in
migration `20260515150000_disputes_structured_attention.sql`. UI code must
never parse `next_action_text` to decide which banner / CTA to show — read
`attention_reason` (typed against `DisputeAttentionReason`) instead.

#### 5.4.1 Email throttle for repeated billing-blocked disputes

A shop with five new disputes in an hour and a depleted quota would
otherwise get five identical "upgrade to keep building packs" emails.
`lib/automation/billingBlockedEmailThrottle.ts:claimBillingBlockedEmailSlot`
implements the throttle:

- **Per dispute:** one billing-blocked email per dispute, ever.
- **Per shop + per reason:** 6-hour cooldown window
  (`BILLING_BLOCKED_EMAIL_THROTTLE_HOURS`).
- **Deadline override:** when the dispute's `due_at` is within 72 hours
  (`BILLING_BLOCKED_DEADLINE_OVERRIDE_HOURS`), the email always sends,
  ignoring the cooldown.
- **Fail-open:** if the throttle infrastructure errors, the helper
  returns `allowed: true` so a billing problem is never silenced by a
  Supabase blip.

State of truth lives in `audit_events` rows of type
`billing_blocked_email_sent`. The helper queries them; concurrent
pipeline calls either both observe an existing claim or one wins the
insert.

> **In-app banners and dispute timeline events are NEVER throttled.**
> Only the email is rate-limited.

**Key invariants:**
- The merchant must never see a dispute land with no evidence and no explanation.
- Billing restrictions may pause new automation, but must not block access to historical disputes, evidence packs, or audit events. The disputes list, dispute detail, evidence-pack view, and audit timeline remain fully readable for shops in `expired`, `cancelled`, or `grace` states; only "build new pack" / "auto-submit" actions are gated.

### 5.5 Merchant communications matrix

Each row below is a distinct lifecycle event. Implementation: a single `lib/email/billingLifecycle.ts` module with one function per event, all idempotency-keyed against `plan_entitlements` columns.

| Event | Channel | Idempotency key | Copy intent |
|-------|---------|------------------|-------------|
| **Trial started** | Email + embedded banner | `trial_started_at` | "You have 14 days + 25 free packs. Here's how to test." |
| **Trial ending in 3 days** | Email | `trial_ending_notice_sent_at` | "Add a payment method or your auto-build pauses on `<date>`." |
| **Trial expired → paid active** | Email | `first_paid_cycle_started_at` | "You're on Growth. First $79 charge cleared. 75 packs available." |
| **Trial expired → no payment** | Email + embedded banner | `subscription_expired_at` | "Auto-build paused. Reactivate to keep automating." |
| **Cycle renewed** | Email (digest, monthly) | `last_renewal_email_sent_cycle_end` | "75 fresh packs unlocked. Last cycle: X disputes auto-built." |
| **Payment failed (entered grace)** | Email + embedded banner | `grace_entered_at` | "Shopify couldn't charge your card. Auto-build still runs for 3 days." |
| **Payment failed (expired)** | Email + embedded banner | `subscription_expired_at` | "Auto-build paused. Update payment method in Shopify Admin." |
| **Cancelled (merchant)** | Email | `cancelled_at` | "Sorry to see you go. Packs and history are preserved if you reactivate." |
| **Top-up purchased** | Email | `last_topup_reference` | "100 extra packs added. Expires `<date>`." |
| **Credits running low (<10% of monthly)** | Embedded banner only | `low_balance_banner_dismissed_for_cycle` | "Almost out. Buy a top-up or upgrade." |
| **Quota exceeded (mid-cycle)** | Email + dispute event | per-dispute (existing `new_dispute_alert_sent_at`) | "We couldn't auto-build this dispute. Upgrade or top up to resume." |
| **Auto-build feature blocked (Free plan)** | Email + dispute event | per-dispute | "Auto-build is a paid feature. Upgrade to enable." |

**Tone constraints (per existing `feedback_bank_optimized_rebuttal` memory, applied here to billing comms):**
- No FUD ("your dispute won't be won"). Tone is calm, actionable, deadline-aware.
- Every notification links directly to the action: `/app/billing` for upgrade, `/portal/billing` for payment-method updates, Shopify Admin for card-on-file.

### 5.6 In-product banners

Both the embedded app (Polaris `Banner`) and the portal (existing CVA `InfoBanner`) gain three new banner variants:

- `billing.gracePeriod` — yellow, dismissible-per-cycle.
- `billing.subscriptionExpired` — red, sticky until reactivated.
- `billing.lowCredits` — blue, dismissible-per-cycle, only shown if `remaining/limit < 0.10`.

Banner copy lives in `messages/{locale}.json` under `billing.banners.*`. Translate across all locales in the same commit (per `feedback_translate_on_add` memory).

---

## 6. Data model changes

```sql
-- Migration: 20260516000000_billing_lifecycle.sql

alter table plan_entitlements
  add column subscription_state text not null default 'active'
    check (subscription_state in ('trialing','active','grace','expired','cancelled')),
  add column shopify_subscription_gid text,
  add column last_renewal_email_sent_cycle_end timestamptz,
  add column trial_ending_notice_sent_at timestamptz,
  add column grace_entered_at timestamptz,
  add column subscription_expired_at timestamptz,
  add column cancelled_at timestamptz;

-- Idempotency for monthly grants: prevents dual-grant when webhook + cron race.
create unique index if not exists pack_credits_ledger_shop_reference_uniq
  on pack_credits_ledger (shop_id, reference);
```

The `disputes.needs_attention` boolean already existed; structured
attention columns shipped in
[`supabase/migrations/20260515150000_disputes_structured_attention.sql`](../../supabase/migrations/20260515150000_disputes_structured_attention.sql):

```sql
alter table disputes
  add column if not exists attention_reason text,
  add column if not exists attention_payload jsonb not null default '{}'::jsonb;
```

Canonical values for `attention_reason` are maintained in TypeScript
([`lib/disputes/attentionReasons.ts`](../../lib/disputes/attentionReasons.ts))
rather than via a DB CHECK constraint — adding new reasons is a code
change with a typed contract, not a migration. The trade-off is
deliberate: faster iteration on attention copy + payload shapes;
discipline is enforced in the type system and in
`pipeline.ts:recordBlockedAutoBuild`.

### 6.1 Top-up credit expiry

Top-up packs **expire 30 days from purchase**, independent of the
monthly billing cycle. Shipped 2026-05-15 in
[`app/api/billing/topup-callback/route.ts`](../../app/api/billing/topup-callback/route.ts)
via `TOPUP_EXPIRY_DAYS = 30`. The earlier behavior — top-ups expiring
at `billing_cycle_ends_at` — destroyed packs purchased hours before
renewal.

> **Top-up rule (invariant):** Top-up packs expire 30 days from
> purchase, independent of subscription cycle. A merchant who buys
> 100 packs an hour before cycle-end gets 100 usable packs for the
> next 30 days, not one hour.

---

## 7. Implementation phases

Phase boundaries chosen so each commit is independently shippable and reversible. Per `feedback_minimal_but_complete` — each phase wires its consumers in the same PR.

### Phase 1 — Stop the bleed (1 PR, ~1 day)
- Pipeline visibility fix (§5.4). `auto_build_skipped` audit, `PACK_BLOCKED` event, deferred review email.
- Tests: every branch of `runAutomationPipeline` returns an action AND a side effect (audit event + dispute event + email claim).
- **Ship first** so the next time this bug recurs the merchant is told.

### Phase 2 — Billing reconciliation cron (1 PR, ~2 days)
- `app/api/cron/reconcile-billing-cycles/route.ts` + `vercel.json` entry.
- `lib/billing/reconcileBillingCycle.ts` — Shopify `appInstallation.activeSubscriptions` query + credit grant + state transition.
- Idempotency unique index migration.
- Tests (named billing-reconciliation, not renewal):
  - cycle rollover with active sub → credits granted exactly once;
  - duplicate webhook + cron race → no duplicate credits (unique index);
  - no active sub → transition to `expired`;
  - expired / cancelled shops retain read-only access to historical disputes, packs, and audit events.

### Phase 3 — Webhook (1 PR, ~1.5 days)
- `app/api/webhooks/app-subscriptions-update/route.ts`.
- Register in `shopify.app.toml`.
- Re-uses Phase 2's `reconcileBillingCycle` library.
- Tests:
  - payload variants (ACTIVE / FROZEN / CANCELLED / EXPIRED) → correct state transition + audit;
  - PENDING with `trial_ends_at > now()` → `trialing`;
  - PENDING with `trial_ends_at <= now()` or null → `expired` (never `trialing`);
  - `cancelled` transition does NOT change install state or revoke read access.

### Phase 4 — Communications (1 PR, ~2 days)
- `lib/email/billingLifecycle.ts` (eight functions, one per row in §5.5).
- Banner copy + i18n across all supported locales.
- Hook the banners + emails into the Phase 2 + Phase 3 state transitions.
- Tests: each lifecycle event fires email exactly once per its idempotency key.

### Phase 5 — Cleanup (1 PR, ~0.5 day)
- Delete `scripts/sql/unblock-surasvenne-2026-05-15.sql` (no longer needed).
- Backfill `subscription_state` for existing shops based on current data.
- Update `docs/epics/EPIC-6-billing.md` to reflect the new architecture.

---

## 8. Acceptance criteria

- [x] A merchant on Growth whose cycle ends today gets 75 fresh packs within 1 hour, without manual intervention. (Shipped 2026-05-15 — hourly `reconcile-billing-cycles` cron.)
- [ ] If Shopify fails the renewal charge, the merchant is emailed within 5 minutes of the webhook, AND sees a yellow banner in the embedded app on next open. (Webhook trigger landed 2026-05-15 — `app_subscriptions/update` handler → `reconcileBillingCycleForShop`; email + banner copy land with Phase 4.)
- [x] If the webhook is dropped entirely, the hourly billing reconciliation cron catches the missed renewal within 1 hour. (Shipped 2026-05-15 — `lib/billing/reconcileBillingCycle.ts` re-verifies against `currentAppInstallation.activeSubscriptions`.)
- [x] Every `quota_exceeded` / `feature_blocked` / `auto_build_off` pipeline exit produces: 1 audit event, 1 dispute_event with `event_type=pack_blocked`, 1 throttled email (review variant) to the team email, `disputes.needs_attention = true` with a canonical `attention_reason` and structured `attention_payload`. (Shipped 2026-05-15.)
- [x] Repeated billing-blocked disputes for the same shop + reason within the 6-hour throttle window do NOT generate repeated emails; they DO still generate audit events, dispute timeline events, and in-app banners. A dispute whose deadline is within 72 hours always generates an email regardless of the throttle. (Shipped 2026-05-15.)
- [x] Re-running the billing reconciliation cron against an already-renewed cycle creates zero duplicate ledger rows (idempotency index). (Shipped 2026-05-15 — `pack_credits_ledger_shop_reference_uniq` + `tryGrantMonthlyCredits` SELECT-then-INSERT with 23505 catch.)
- [x] Cancelling the subscription in Shopify Admin transitions to `cancelled` in our DB within 5 min via webhook and within 1 h via reconciliation cron. (Both paths shipped 2026-05-15. Webhook handler at `app/api/webhooks/app-subscriptions-update/route.ts` re-queries Shopify rather than trusting the payload, so a replayed or forged push can't drive a wrong transition.)
- [ ] Reactivating a cancelled subscription restores `active` state and grants the new cycle's credits. (Partial — reconciler grants credits on next active observation; the explicit `cancelled → active` transition + idempotency under back-to-back reactivation needs a separate test once Phase 3 is in.)
- [ ] **Read-only access invariant.** A shop with `subscription_state` in `{expired, cancelled, grace}` can still: load the disputes list, open any historical dispute, view its evidence pack, view its audit/timeline events, download stored PDFs. The shop CANNOT: auto-build a new pack, auto-submit, or trigger any new outbound Shopify save mutation. Billing route guards must enforce this asymmetry; no global "subscription required" middleware that blocks read paths. (`readOnlyAccessAllowed()` always returns true; route-guard audit lands with Phase 4.)
- [x] **Top-up expiry.** A top-up purchased one day before cycle end remains available after the monthly cycle renews and expires exactly 30 days from purchase. (Shipped 2026-05-15.)
- [x] `cancelled` (billing state) and `uninstalled` (install state on `shops.uninstalled_at`) are independent — neither implies the other; no automation runs for uninstalled shops regardless of billing state. (Shipped 2026-05-15 — reconciler checks `shops.uninstalled_at` BEFORE any other read.)
- [x] `PENDING` Shopify subscription status maps to `trialing` ONLY when `trial_ends_at > now()`; otherwise maps to `expired`. (Shipped 2026-05-15 — `mapShopifyStatusToState`.)
- [x] `npm run release:verify` passes after each phase (per `feedback_run_release_verify` memory).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Shopify webhook delivery is at-least-once → duplicate credit grants | Unique index on `pack_credits_ledger (shop_id, reference)` |
| Reconciliation cron over-polls Shopify | Only poll shops with `billing_cycle_ends_at` within next 1 h OR stale by 24 h |
| Merchant gets two emails for the same renewal (webhook + cron) | All email functions claim on a `*_sent_at` column with conditional UPDATE; second writer skips |
| Trial-end transition fires while quota check still passes (race) | State transition + credit grant happen in a single transaction; pipeline reads `subscription_state` before quota |
| We accidentally grant credits for a charge that didn't actually clear | All renewals re-verify against `appInstallation.activeSubscriptions` before granting — we never trust the webhook payload alone |
| Email vendor outage masks lifecycle events | Banners are independent of email; audit event always fires; merchant can self-serve from `/app/billing` |
| Existing shops have `subscription_state = NULL` after migration | Phase 5 backfill: shops with `billing_cycle_ends_at > now()` → `active`, others → `expired` |

---

## 10. Open questions

1. **Grace-period duration.** Shopify retries failed charges over ~3 days. Should we extend grace to a full week to be merchant-friendly, or hold at 3 days to match Shopify's own behavior? Recommend: 3 days, escalating banner urgency on day 2 and day 3.
2. ~~**Top-up extension semantics.**~~ Resolved 2026-05-15: top-ups expire 30 days from purchase. See §6.1.
3. **Multi-store merchant.** If a merchant owns two stores and one renews while the other lapses, the email goes to whichever team email is configured per-shop. Confirm no cross-shop confusion in copy. Likely a no-op — every email already includes `shop_domain`.
4. **Downgrade flow.** Today: contact support. Future iteration could allow self-serve downgrade taking effect at next cycle. Out of scope here, but the `subscription_state` machine is forward-compatible.
5. **Webhook registration backfill.** New webhooks only register on next OAuth install. Do we force-reinstall existing shops, or run a one-shot script to call `webhookSubscriptionCreate` for the new topic? Recommend: one-shot script, fail-soft if the merchant uninstalls.
6. **Explicit installation state.** Today install/uninstall is tracked solely via `shops.uninstalled_at`. Should we add an explicit `installation_state` column (`installed | uninstalled | access_revoked`) alongside `subscription_state` so the two concerns can't drift? Out of scope here; tracked as a follow-up.

---

## 11. Test plan

Beyond per-phase unit tests:

- **Integration:** `tests/integration/billing-lifecycle.test.ts` walks a fake merchant through trial → paid → renewal → payment fail → grace → expired → reactivate → cancel. Asserts every state transition, every email idempotency, every credit grant.
- **E2E smoke:** extend `scripts/smoke-test.mjs` with a billing-lifecycle scenario that runs against a test Shopify store using `test: true` charges.
- **Replay:** load fixture webhook payloads from `tests/fixtures/shopify/app-subscriptions-update/*.json` and assert handler behavior for each. Include intentionally malformed payloads to confirm HMAC verification and graceful degradation.
- **Reconciliation:** assert that simulating a "dropped webhook" (manual DB tampering) is recovered by the next cron run.

---

## 12. Links

- [`scripts/sql/unblock-surasvenne-2026-05-15.sql`](../../scripts/sql/unblock-surasvenne-2026-05-15.sql) — the one-shot fix that motivated this PRD.
- [`docs/epics/EPIC-6-billing.md`](../epics/EPIC-6-billing.md) — current billing scope (to be revised at end of Phase 5).
- [`lib/automation/pipeline.ts`](../../lib/automation/pipeline.ts) — silent-exit branches to fix in Phase 1.
- [`lib/billing/plans.ts`](../../lib/billing/plans.ts), [`lib/billing/checkQuota.ts`](../../lib/billing/checkQuota.ts), [`lib/billing/consumePack.ts`](../../lib/billing/consumePack.ts) — existing primitives the renewal engine builds on.
- Shopify docs: [App subscription webhooks](https://shopify.dev/docs/api/admin-rest/2026-01/resources/webhook#topic-app_subscriptions-update), [`appInstallation.activeSubscriptions`](https://shopify.dev/docs/api/admin-graphql/2026-01/objects/AppInstallation).
