# Plan: tell the merchant to refund an inquiry before it becomes a chargeback (email + cron), driven by live refund state

Replaces the earlier plan for PR #1153 (page-only advice). #1153 stays on `develop` and must NOT go to `master` until PR C below reworks it.

## Context

Customer returns the item, the merchant has not credited it, the card network opens an **inquiry** (reason `CREDIT_NOT_PROCESSED`). A refund closes it. If nobody refunds, it can become a chargeback (the disputed amount and a fee are debited, and it counts in the chargeback rate; inquiries do not: `lib/disputes/chargebackRate.ts` excludes them). The merchant must hear this **when it happens**, not only if they open the dispute page. So: a cron decides, an email tells, the page agrees.

What the research established (live Shopify reads 2026-11-12, every claim re-checked by a second agent; probe scripts are `scripts/shopify/research-pending-*.mjs`):

- A pending refund is invisible in what we store. On this shop refunds sit **PENDING about 24 h** (min 24.01 h, median 24.16 h, 242 refunds). While pending: `Order.totalRefundedSet` = 0.0, status stays PAID, the `Refund` exists with `totalRefundedSet` 0.0, and its **`transactions` hold `REFUND/PENDING` with the real amount**. On settlement everything flips at once; the inquiry then closes **10–24 s later**, never at refund creation.
- Only `Refund.transactions` (kind, status) separates four states that all look like 0.0 in our pack: no refund, pending, settled, failed, plus a no-money record (a `Refund` with zero transactions, from order edits/cancellations).
- Of the 11 "open, return in progress, no refund" inquiries, **7 had already been refunded** on 11 Nov and are now won. Cause: the pack is a stale snapshot (nothing rebuilds it on a refund; the nightly rebuild stopped 2026-11-10) and the order query never reads `Refund.transactions`. Only #24697, #24711, #25072, #25073 truly have no refund.
- Limits on "a refund closes it": 9 of 10 closures were **below** the disputed amount, but cay-collective #16952 (refund about 25% of the disputed amount, settled 7 days ago) is **still open**; a PayPal refund closed an inquiry as **lost**; all closures observed are Klarna on one shop. One PayPal refund has been stuck PENDING for 11 weeks. `Order.returnStatus` stays IN_PROGRESS after a refund, so it says nothing about refund state. `read_returns` is not granted, so Return objects are unreadable.

So the plan is evidence-bounded: advice goes out only where it has been measured to be true.

## Design

### 1. One pure resolver: `lib/disputes/refundState.ts` (single source, CLAUDE.md "fix the class")
Input: the live order read below. Output `RefundState`: `{ kind: "none" | "pending" | "settled" | "failed" | "mixed" | "unknown", pendingAmount, settledAmount, currency, firstRefundAt, settledAt, stalledPending }`.
- Derived **per Refund** from its REFUND transactions (a single order-level state cannot hold #24393: one settled + one pending).
- `none` only if: zero REFUND transactions anywhere (a `Refund` with no transactions is "no money", not a refund) AND `totalRefundedSet` = 0 AND the read was complete (no `hasNextPage`, no cap hit).
- `unknown` (fail closed, never "none") for: order-level REFUND transaction not tied to a Refund (cay #17210, a gift-card reversal), any status other than PENDING/SUCCESS/FAILURE, truncated lists, query errors.
- `stalledPending` = PENDING for more than 72 h (the 11-week PayPal case): treated as `unknown` for advice, flagged for admin.
- `settledAt` = `Refund.updatedAt` of the SUCCESS refund (not `processedAt`, which stays at the click time).
- `orderSituation.refund` and `refundStatement` get their refund value from this when a snapshot exists; otherwise stay as today (fail closed to `unknown`, not `none`).

### 2. Live read: new query `ORDER_REFUND_STATE_QUERY` (`lib/shopify/queries/orderRefundState.ts`, registered in `registry.ts` for the schema-drift cron)
`order(id:){ displayFinancialStatus returnStatus totalRefundedSet refunds(first:10){ id createdAt updatedAt totalRefundedSet transactions(first:10){ id kind status processedAt errorCode amountSet } } transactions(first:20){ id kind status amountSet } paymentGatewayNames }`. Via `makeAuthedRequest` / `getShopBackgroundSession` (refreshes expiring offline tokens; do not copy `buildPack.ts`, which does not). Needs no new scope (`read_orders` / `read_all_orders` cover it); **do not** add `read_returns`.

### 3. Snapshot table `dispute_refund_state` (migration; apply to dev then prod with `db:migrate:dev` / prod fallback, guard-checked)
`dispute_id` PK, `shop_id`, `order_gid`, `state`, amounts, `currency`, `first_refund_at`, `settled_at`, `return_status`, `payment_method`, `checked_at`, `last_changed_at`, plus `state_at_close` / `closed_state_checked_at` (for stats). RLS on, service-role only. No jsonb dump of customer data.

### 4. Cron `app/api/cron/refund-state-check/route.ts`
- `cronEnvGate(req)` first (enumeration test enforces it); `vercel.json` every 3 h; time budget like `post-outcome-analysis` (`BUDGET_MS` 240 s, `maxDuration` 300).
- Select open inquiries (`phase='inquiry'`, status in `OPEN_DISPUTE_STATUSES`), reason `CREDIT_NOT_PROCESSED`, group by shop (pattern: `dispute-reminders`), oldest `checked_at` first, cap per run, `log` anything skipped by the cap (no silent truncation).
- Per dispute: live read → `resolveRefundState` → upsert snapshot.
- **Send rule (all must hold):** state `none`; live return status `IN_PROGRESS` or `RETURNED`; payment method is **Klarna** (the only gateway with measured closures; other methods stay page-only until measured); dispute still open; not a historical import; shop opted in; `teamEmail` present; no prior send for this dispute+cycle. **Re-read the order live immediately before sending** (closes the race where the merchant refunds minutes before).
- Variants (all i18n): `none` → refund advice; `failed` → "your refund did not go through, redo it"; `pending`/`settled`/`unknown`/`mixed` → **no email**; the page explains instead.
- Dedupe: audit row `event_type='refund_advice_sent'`, `dispute_event_key = ${disputeId}:REFUND_ADVICE:c${response_cycle}` written **after** a successful send (unique index absorbs a race); failed send retried next run. Kill switch env `REFUND_ADVICE_EMAILS_ENABLED` (pattern: `BANK_CLAIM_EMAILS_ENABLED`); `dryRun` mode logs the decision per dispute with no send.
- No automatic backlog blast: the first enabled run lists what it would send; real sends begin only after the in-chat canary (below).

### 5. Email `lib/email/sendRefundAdviceAlert.ts` + pure `renderRefundAdviceEmail`, copy in `messages/*.json` under `email.refundAdvice.*` (6 locales: en/de/es/fr/pt/sv, translated in the same session, terms grepped for consistency)
Pattern: `lib/email/billingLifecycle.ts` (`createTranslator`, `plateLayout`/`ctaButton` from `digestShared.ts`, locale from `shops.locale`; **no strings in `lib/`**). Recipient `teamEmail`; deep link via `getEmbeddedAppUrl(shop, "disputes/<id>")`; new opt-out key `refundAdvice` + a Settings toggle (`app/(embedded)/app/settings/page.tsx`, `app/api/shop/preferences/route.ts`), explicit-`false` opt-out like the others.
Content, only what is backed:
1. What happened: the customer says the credit was not processed; the order shows a return; no refund has been issued (live-checked just now).
2. What to do: refund **the disputed amount** ({amount}) in Shopify Admin (not "in full": see limits above). Whether to refund is the merchant's decision.
3. What happens: the refund settles with the payment provider, often about a day on Klarna, and the inquiry typically closes shortly after settlement. Not a promise (hedged wording; no number).
4. Why: left unresolved an inquiry can become a chargeback: the amount and a Shopify chargeback fee are debited, refunds are then blocked, and it counts toward your chargeback rate (inquiries do not). The fee **amount** is not stated unless read from Shopify; confirm the fee claim against Shopify's help page during implementation and cite it in the PR.
5. Store results line, **only** when the store has at least 10 measured cases (see 7); otherwise omitted, never platform-wide numbers.
No forbidden phrases (CI gate), no "Shopify automatic response", no bare gateway codes, no claim that DisputeDesk files or refunds anything.

### 6. Page (rework #1153, PR C)
`statusCopy.shouldAdviseRefund` stops reading `returns` alone: it requires the snapshot state `none` (fresh, `checked_at` within 12 h). New lines: `pending` → "A refund of {amount} is on its way; it was started {date}. The inquiry usually closes after it settles; nothing more to do." ; `failed` → redo; `settled` but still open → neutral note, no advice; no snapshot / `unknown` → no refund line and **no evidence ask when a return is on record** (kept from #1153). Fix: "A return … is marked as received" shown while the return is only in progress (`RETURN_DETAIL_KEY` vs `item.return.returned`). The workspace route reads only the snapshot (it refetches every 4 s and on focus: no live Shopify call there); `POST /api/disputes/[id]/sync` also refreshes the snapshot for that dispute. Keep the "Return opened" timeline row and the evidence-line removal from #1153.

### 7. "N won" numbers: measured, per store, reproducible
- Capture at close: the existing outcome path (`applyDisputeSnapshot` `OUTCOME_DETECTED`) triggers one live read to fill `state_at_close`. (Close follows settlement by seconds, so a 3 h snapshot would miss it.)
- One-off backfill script `scripts/backfill-refund-state-at-close.mjs` (explicit `--env-file`, dry run, rate-limited, read-only against Shopify; **canary 2–3 disputes, read the result, then batch**) for closed inquiry-origin disputes in the last 12 months.
- Definition (code + test + docs, one function `lib/disputes/refundOutcomeStats.ts`): an inquiry **counts as refunded** when a SUCCESS refund's `settledAt` falls after the dispute's `initiated_at` and at or before `closed_at` + 5 min; a refund settled before the inquiry opened is excluded (#23750 did not close). Reported per store: `{won, decided}` for refunded inquiries, and `{escalated, unrefunded}` for inquiries with no refund. Minimum 10 cases (same threshold as `storePatterns`), else no number.
- The same function can later feed the dispute page card; not in this scope.

### 8. i18n guard for emails (your add-on) + migrate the refund-related emails
- New invariant test `lib/email/__tests__/noHardcodedCopy.invariant.test.ts` (models: `claimOwnership.invariant.test.ts`, `tests/unit/rawReadScan.ts`): every module in `lib/email/` that builds merchant copy must resolve it through `createTranslator`/`resolveToken` over `messages/*.json`; no in-file locale tables (`STRINGS`), no English sentence literals in `lib/email/**`. Legacy offenders sit in an explicit allowlist (**ratchet**: the test also fails if an allowlisted module no longer needs to be there, so the list can only shrink). Scope of the list is enumerated from `lib/email/` at implementation time.
- Migrated now: the new email, **`sendFatalLossAlert`** (hard-coded English; its inquiry branch says "refund the order now" for never-shipped orders without checking refund state: it must follow the same state rule and wording) and **`sendEvidenceNeededAlert`** (English-only). Every other email stays on the allowlist as a tracked follow-up.
- `scripts/verify-i18n-parity.mjs` stays the parity gate (all keys, all 6 locales, same session).

## Delivery (small PRs, each → `develop` via branch+PR; worktree off `origin/master`)
- **PR A**: query + `refundState` resolver + fixtures captured from the research (pending, settled, line-only no-money, mixed #24393, gift-card #17210, truncated, failure shape = best known) + migration + snapshot upsert helper.
- **PR B**: cron + email + messages (6 locales) + settings toggle + opt-out + dedupe + kill switch + i18n guard + fatal-loss/evidence-needed migration.
- **PR C**: page rework on the snapshot (supersedes #1153's advice gating; keeps its timeline + evidence-ask removal).
- **PR D**: close-time capture + backfill script + `refundOutcomeStats` + the email's results line.
- Docs in the same commits: `docs/technical.md` (cron list `:8608`, Email section `:426`, refund advice `:10625`, order situation `:4093`, refund statement `:4029`), help articles `understanding-inquiries` / `returned-to-sender-parcels` (`lib/help/articles.ts`, 6 locales).
- **Prod (`master`) needs your explicit in-chat go per PR** (rule 9). Prod enablement: deploy with `REFUND_ADVICE_EMAILS_ENABLED` off → run the cron in `dryRun` on prod (read-only) → show you the exact list it would email (expected today: #24697, #24711, #25072, #25073, subject to re-check) and ONE rendered email → you approve → enable. No backlog bulk send before that.

## Verification
- Unit: resolver table over all fixtures (every state, fail-closed paths), `renderRefundAdviceEmail` per locale (6), email no-send cases (opt-out, no teamEmail, pending, settled, unknown, non-Klarna, historical, already sent), cron enumeration test, stats definition (refund before inquiry excluded, <10 cases → no number), invariant test.
- `npm test`, `npx tsc --noEmit`, `npm run build`, `node scripts/verify-i18n-parity.mjs`, `npm run release:verify`.
- Prod read-only: `dryRun` cron against live Shopify; its decisions for the 4 known "no refund" cases and the 7 known "refunded" cases must match the table in this research (4 `none`, 7 not-`none`). `db:query:prod` with `--read-only`, ref guard on every command.
- Dev/staging e2e: seeded dispute with a pending refund shows the "on its way" line and no email; a `none` dispute renders the email in all 6 locales.
- After prod enablement: open one real case in prod and confirm the email, the page and the snapshot agree.

## Risks / still open (stated, not guessed)
- The shape of a **failed** refund is unobserved: unknown statuses are treated as `unknown` (no email) until measured.
- Auto mode: the 08:00 deadline cron files evidence on an inquiry with no inquiry-specific branch; whether it should hold while a refund is pending is **not investigated** here. Separate decision; flag if you want it in scope.
- The Klarna-only restriction and the "disputed amount, not in full" wording are deliberate: one shop's data, one counter-example (#16952). Widening to card/PayPal needs its own measurement.
- `Order.returns` stays unreadable (no `read_returns`); return state comes from `returnStatus`, which is enough for the trigger but cannot confirm the goods arrived.
- The research workflow's one failed verifier (zero-refund semantics: hit the usage limit) was covered by two other agents and the live reads; no conclusion in this plan depends on it alone.
