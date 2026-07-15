# Gorgias Public App — "Dispute Guard"

**Status:** PLANNED — not started. Every phase gates on the one before it; Phase 0 gates on decisions only the maintainer can make (§14).
**Owner surface:** `lib/integrations/gorgias/**`, `app/api/integrations/gorgias/**`, Insights, workspace.
**Related:** Gorgias evidence-core (PRs #267–#274, on develop, held from prod), `docs/technical.md` § *Gorgias Evidence Core*.

---

## 1. Goal

Ship a **listed Gorgias App Store app** that beats the incumbents not by re-doing their comms-to-evidence pull (commoditized — our evidence core already does it with a stronger trust contract) but by owning the one surface none of them ship: **live dispute context inside the support agent's ticket view**, plus a **support-signal early-warning layer** that fires before any card-network alert can and covers the BNPL disputes alert networks structurally cannot see.

## 2. Competitive landscape (verified 2026-07-15 against gorgias.com/apps — the primary directory)

Three chargeback/fraud apps are listed:

| App | Comms → evidence | Agent-facing UI in Gorgias | Delivery-dispute story | Early warning | Pricing signal |
|---|---|---|---|---|---|
| **Chargeflow** | ✓ fully automated ("zero manual work") | none | generic | Verifi/Ethoca network alerts, **$39/deflected** | Automation 25% of recovered |
| **ChargePay** | ✓ auto-maps threads/history; review step in own dashboard | none — "zero workflow disruption" is the pitch | markets **"Win Delivery Disputes"** (interaction timelines + tracking milestones vs INR) | "smart alerts" | 20% of recovered |
| **Securify** | — | **✓ ticket-sidebar widget** (email fraud score, VPN/disposable flags, Shopify high-risk-tag button) | — | pre-order fraud flags | free |

Take-aways:
- A listing is **table stakes** — we'd be the third chargeback app in the directory.
- **ChargePay is the closest feature rival** (their delivery-dispute pitch aims at the ground our carrier-truth work fights on), not Chargeflow.
- **Securify proves the widget surface works in this exact category** (their pitch stat: "40–50% of Gorgias support discussions involve chargebacks and fraud") — but theirs is pre-order email-fraud intel. **Dispute-case context on the ticket is shipped by no one.**

ChargePay's marketing creatives (reviewed 2026-07-15) detail their mechanism: per-message **structured claim extraction** from conversations ("shipping address confirmed", "estimated delivery timeframe provided", "customer confirmed receipt", each timestamped), **ticket-intent chips** (Delivery Issue / Duplicate Charge / Item Not Received — implying they classify all inbound tickets, with no visible privacy tiering), **ticket-attachment harvesting** (delivery photos, invoice PDFs pulled into evidence), and a review kanban (Evidence Ready → Needs Review → Submitted) in their own dashboard. Two structural weaknesses to exploit:
- **Evidence provenance is conversation-derived.** Their "Delivery Confirmed" is sourced from what a support agent *typed* in a reply ("delivered May 7 at 2:14 PM") — the merchant's own assertion, i.e. hearsay, versus carrier records. Our carrier-truth pipeline (Shopify-native event classification + planned carrier-API adapters) produces primary-source proof; their model silently inherits the same Shopify-`deliveredAt` gap we diagnosed (DHL Freight etc.) and papers over it with agent statements.
- **No visible bank-safety judgment in auto-generation** — one creative shows the customer's complaint text ("I haven't received my order yet") bundled INTO the evidence package. Our review contract + bank-safe copy principles are the counter-position.

**Positioning sentence:** *"The only chargeback app your support agents can see — live dispute context on every ticket, and evidence that never reaches the bank without your approval."*

## 3. What we already have (foundation, no rebuild)

- **Phase-1 connect:** per-merchant private app, Basic auth (email + API key), AES-256-GCM in `integration_secrets`, connect/test/disconnect routes, setup-wizard modal.
- **Evidence core (develop):** scored ticket matching (`matchScoring.ts`, versioned algorithm), persisted enrichment runs (state machine, idempotent, LLM daily cap), injection-hardened relevance analyzer, merchant review UI, snapshot-rendered PDF section, admin runs page.
- **The 4 blocking safety rules** (unchanged by this plan): (1) no auto-inclusion in `merchant_review_required` mode, ever; (2) pack generation omits pending Gorgias evidence — never races enrichment; (3) packs render only from the approved snapshot (approved excerpt + content hash); (4) idempotent runs + atomic approval RPC.

The public app is a **transport + surface** upgrade around this core. The core itself does not change.

**Known core gaps surfaced by competitive review (candidate PRs, evidence core — not this app):**
1. **Ticket-attachment harvesting.** Our snapshot pipeline captures message TEXT only; ChargePay pulls **ticket attachments** (delivery photos, invoices) into evidence. Customer-shared delivery photos in support threads are strong INR evidence. Follow-up: extend the enrichment snapshot to attachments (same review gate, same content-hash discipline, size/type allowlist, stored via the existing private-bucket upload path).
2. **Multi-claim conversation timeline.** ChargePay extracts SEVERAL discrete, timestamped evidence facts per conversation ("shipping address confirmed" → "delivery ETA provided" → "tracking number shared" → "customer confirmed receipt") and renders them as a support-interaction chronology. Our model approves ONE excerpt per message, and the pack chronology is thin (transaction date + auth + communication-exists). Facts like *"tracking was shared with the customer on {date}"* have independent evidentiary value in INR disputes (defeats "the merchant never told me where my parcel was") that a single quoted excerpt doesn't itemize. Follow-up: extend the analyzer output to multiple typed claims per message (claim type + timestamp + excerpt span, each individually approvable under the same review contract) and render an approved-claims timeline in the pack's comms section. Bank-safety rule carries over: claims derived from MERCHANT-authored messages assert only that the statement was made (engagement/disclosure), never the underlying fact (an agent saying "it was delivered" is not delivery proof — carrier truth remains the only source for that).

## 4. Phase 0 — hard gates (no code until these clear)

- **G1 — evidence core validated on prod.** It is develop-only today. Promote (per-change approval), then validate end-to-end with cay-collective and at least one more merchant on the existing Basic-auth path. A listing that funnels merchants into an unproven flow risks public bad reviews in front of exactly our ICP.
- **G2 — Gorgias developer-portal account + sandbox** (maintainer action). Create the draft app; obtain OAuth client credentials; confirm partner terms.
- **G3 — platform validation spike (timeboxed, one PR-sized, sandbox-only).** Public docs do not specify enough to build against. Confirm empirically:
  - the **widget data mechanism for apps**: how a sidebar widget fetches third-party data (HTTP data source URL? request signing? auth headers? refresh cadence? template/iframe constraints);
  - the **webhook catalog**: exact events (ticket created, message created, ticket updated, tag applied), payload shapes, retry semantics, signature verification — and specifically **whether tag-scoped subscriptions exist** (early-warning Tier 1 needs tag events, not all-message events);
  - whether webhook payloads / the ticket API expose **Gorgias's own AI intent labels** (early-warning Tier 2 piggybacks them instead of us parsing content);
  - **install-time component APIs**: programmatic creation of widgets/tags/macros on install and clean removal on uninstall;
  - the **OAuth scope catalog**: minimal read scopes + component-write scopes (review criterion).
  - **Output:** a findings doc appended to this plan. Phases 2–3 are re-estimated against it before any build.

## 5. Phase 1 — OAuth foundation (2 PRs)

**PR-A1 — OAuth flow.**
- `app/api/integrations/gorgias/oauth/authorize/route.ts` + `callback/route.ts`; `state` (+ PKCE if supported) per Gorgias spec.
- Tokens persisted encrypted in `integration_secrets` with a new `credential_type: "oauth"` beside the existing `basic`; per-install record keyed to the Gorgias account.
- Migration if needed for `credential_type` (agent applies via `npm run db:migrate:dev`, per repo rules).

**PR-A2 — client abstraction + uninstall.**
- `lib/integrations/gorgias/client.ts` gains an auth-mode seam (Basic | Bearer) with transparent refresh — single-flight refresh claim mirroring the Shopify `ensureFreshSession` pattern (claim column, stale-claim reclaim).
- Uninstall webhook: revoke tokens, mark integration disconnected, write a run-ledger note. **Never delete snapshotted evidence** — approved snapshots are dispute records.
- Existing Basic-auth connections keep working untouched; the connect modal offers OAuth once the app exists.

## 6. Phase 2 — Dispute Guard widget (3 PRs) — the differentiator

**PR-W1 — widget data endpoint.** `app/api/integrations/gorgias/widget/route.ts`:
- Input: ticket context per the G3 auth model (customer email; linked Shopify order when Gorgias's own Shopify integration provides it). Authenticate the request per G3 findings (signature verification or scoped token) — reject anything unauthenticated.
- Output per customer/order:
  - open disputes: phase (inquiry/chargeback), reason family, amount, **deadline countdown**, evidence status (needs review / ready / submitted), case-strength pill;
  - **reply-safety state** — the killer feature: when an open dispute exists, an advisory warning, family-aware:
    - CNP/refund family: "Active refund dispute — don't confirm a refund is owed or promise one in writing; replies can be quoted as evidence at the bank."
    - Fraud family: "Active fraud dispute — don't discuss card details or assert the buyer's identity; route to the dispute workspace."
    - INR family: "Active delivery dispute — share tracking facts only; don't concede non-delivery."
    - Advisory ONLY — never blocks agents. Copy sourced from the same bank-safe principles as `validateNarrative`; all strings structural i18n (`help.embedded.gorgias*` / new `gorgiasWidget.*` namespace, all 6 locales).
  - deep link into the DisputeDesk dispute workspace.
- **Tenancy is strict:** resolve the shop from the installed integration; serve only that shop's disputes; no data beyond what the ticket view already implies (no amounts of *other* orders, no card data — there is none in our DB by design).

**PR-W2 — install-time components.** On install (and repaired on reconnect): register the sidebar widget; create a `disputedesk-dispute` tag; install 2–3 **dispute-safe reply macros** (family-specific: acknowledge + "we're looking into it" + no admissions/promises). All removed cleanly on uninstall (review criterion).

**PR-W3 — auto-tagging.** Webhook handler: new ticket/message from a customer with an open dispute → apply the tag. O(1) indexed lookup (customer email / order number → open dispute), queue-backed, idempotent, rate-limit-polite.

## 7. Phase 3 — webhooks: live evidence + early warning (2 PRs)

**PR-H1 — live evidence during the deadline window.**
`message.created` where the author matches a customer with an open dispute in review → enqueue re-enrichment via the existing `enrich_gorgias_comms` job with new `trigger_source: "gorgias_webhook"`. New candidate messages surface in the review UI with the attention flag. Constraints carried over: one active run per (dispute, integration); LLM daily cap → `analysis_deferred` (never silent); merchant emails/notifications reuse the existing attention machinery.

**PR-H2 — pre-chargeback early warning.**

*The concept, stated honestly.* Card-network alert products (Verifi CDRN/RDR, Ethoca — what Chargeflow resells at $39/deflected alert) fire when the cardholder has **already disputed at their bank**; the only remedy at that stage is a forced full refund plus the fee. But most non-fraud disputers contact **merchant support first** — "my order never arrived", "I was charged twice", "refund me or I call my bank". Those tickets are the same warning **days or weeks earlier**, sitting in Gorgias, and nobody converts them into a prevention queue. Additionally, **Klarna/BNPL disputes have no alert network at all** — support signals are the *only* early warning that exists for them (highly relevant: cay is Klarna-heavy).

*The design constraint that shapes everything here:* a naive implementation means **continuously parsing ALL customer communication** for every connected shop. That is (a) a volume/cost problem, and (b) a **materially different privacy posture** from the evidence core: the core reads tickets *on demand for a named dispute* (narrow purpose); an always-on scanner makes DisputeDesk a processor of a merchant's entire support stream — different GDPR purpose/minimization story, different DPA language, a broader OAuth read scope (which cuts against Gorgias's minimal-scopes review criterion), and a bigger security surface. So early warning ships in **tiers that escalate data access only as value is proven**:

- **Tier 1 — agent-signaled (no parsing at all).** We already install a `disputedesk-dispute` tag and macros (PR-W2). Add a `chargeback-risk` tag + a widget one-click "Flag as dispute risk". Webhook fires **only on that tag** → `dispute_risk_signals` row. Zero content processing, zero privacy expansion, human-precision signals. This is v1 — it validates the Insights surface and the deflection loop with no new data access.
- **Tier 2 — piggyback Gorgias's own intent classification (still no parsing by us).** Gorgias's AI already classifies ticket intents on the merchant's side. **G3 spike must confirm** whether webhook payloads / the ticket API expose those intent labels. If yes: we consume labels ("where is my order", refund demand), never the message bodies — Gorgias already parsed; we read metadata. Filter: label + customer has a recent order → signal.
- **Tier 3 — our own classifier, ephemeral by construction (opt-in per shop).** Only if Tiers 1–2 prove value and coverage gaps justify it: webhook body → in-memory multilingual heuristic classifier (refund demand / bank threat / INR / duplicate-charge patterns; **no LLM**) → **only the signal is persisted** (intent label, ticket ref, order ref, confidence) — message text is never stored on this path. Metadata-first filtering (no recent order for this email → discard before reading the body). Shipped behind a per-shop toggle with its own explicit privacy disclosure, OFF by default.
- Signals surface in **Insights**: "N customers this week are on a path to a chargeback" with per-signal recommended action (respond with carrier facts / offer resolution — the refund decision is the merchant's).
- Close the loop: when a signal's order later gets a real dispute → `became_dispute` (measures precision AND gives the merchant a "we warned you" trail); resolved in support → `resolved`; per-shop mute.

*Honest limits (also for the listing copy):* probabilistic, not deterministic — a ticket means a dispute *might* come; true-fraud disputers rarely contact support first, so network alerts catch cases we can't. This is the **free, earlier, BNPL-inclusive layer above** alert networks — a complement, not a replacement. We do not claim deflection-rate parity with Verifi/Ethoca.

## 8. Phase 4 — App Store submission (1 PR + external review cycle)

- Map to Gorgias's five review criteria: OAuth one-click; **minimal scopes**; differentiated use case (the widget IS the differentiation); rate-limit hygiene; functional widget.
- Listing assets: screenshots (widget on a ticket, review flow, Insights early-warning), copy per §2 positioning.
- Docs: help article (`lib/help/` + `messages/{locale}.json`, all 6 locales) + `docs/technical.md` section — same commit as the feature, per repo rules.
- Privacy/data-processing note: what we read, snapshot bounds, content hashing, retention, GDPR posture.
- Keep the Basic-auth connect as the fallback funnel until approval; if G3 shows widgets work as private-app HTTP integrations, pilot the widget with cay pre-approval.

## 9. Safety contract (additions for this plan)

The 4 evidence-core rules stand unchanged. New, widget/webhook-specific:
5. The widget is **read-only advisory** — it never blocks or auto-edits agent replies; macros are installed as options, never auto-applied.
6. The widget endpoint serves **only the installed shop's disputes**, authenticates every request per the G3 mechanism, and exposes no evidence content — status, deadline, strength, and guidance only. Evidence lives behind DisputeDesk auth.
7. Early-warning signals are **merchant-facing intelligence only** — never auto-refund, never auto-reply, never surfaced to the customer.
7a. Early warning escalates data access by tier (§7 PR-H2): Tier 1 processes no message content; Tier 2 consumes Gorgias-side labels only; Tier 3 (opt-in, off by default) classifies ephemerally and **persists signals only — never message text**. DisputeDesk never becomes a standing store of a merchant's support stream.
8. Webhook handlers are idempotent and queue-backed; a webhook outage degrades to the existing pull-based enrichment (never a correctness dependency).

## 10. Non-goals

No auto-inclusion mode (contract). No writing to tickets beyond installed macros. No Zendesk/Intercom generalization yet — design the widget endpoint provider-agnostically, build Gorgias only. No pricing change: the app is a channel, not a SKU. No LLM in the early-warning classifier v1.

## 11. Success metrics

- Installs from the listing; share of new connections via OAuth vs Basic.
- Widget render rate on dispute-linked tickets; deep-link click-through.
- Disputes with approved Gorgias evidence attached; win-rate delta vs disputes without.
- Early warning: signals raised, precision (`became_dispute` rate), resolution rate, measured deflections.
- Listing review rating ≥ Chargeflow's.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Widget auth/mechanics differ from assumptions | G3 spike gates all agent-facing work; re-estimate before build |
| Gorgias review latency/rejection | Basic path unaffected; widget may pilot as private-app HTTP integration |
| Competitors copy the widget | The moat is what feeds it (carrier truth, review contract, deadline machinery), not the iframe |
| Webhook volume on large merchants | O(1) indexed matching, queue-backed handlers, backpressure |
| Early-warning false positives erode trust | Precision metric from day one; conservative v1 patterns; per-shop mute |
| Always-on comms processing (privacy/scope creep) | Tiered design (§7): v1 processes no content; Gorgias-label piggyback preferred; own classifier is opt-in, ephemeral, signal-only storage |

## 13. Sequencing

`Phase 0 (G1–G3)` → `P1 OAuth (A1, A2)` → `P2 Widget (W1–W3)` → `P3 Webhooks (H1, H2)` → `P4 Listing`. 9 PRs total, all → develop behind existing evidence-mode flags; prod promotion per-change as always. Each phase's PRs land sequentially; phases don't overlap.

## 14. Open decisions (maintainer)

1. **Go/no-go on promoting the evidence core to prod** (gate G1) — prerequisite for everything.
2. Gorgias developer-portal signup + sandbox (G2).
3. App name on the listing ("DisputeDesk" vs "DisputeDesk Dispute Guard").
4. Early-warning v1 languages (propose: en/sv/de first — matches current merchant base).
5. Whether the widget pilot (private-app variant, if feasible per G3) should precede the OAuth work for faster merchant feedback.
6. Whether early-warning Tier 3 (our own content classifier, opt-in) is ever acceptable, or the feature stays capped at Tier 2 (Gorgias-label piggyback) — decide only after Tier 1/2 precision data exists.
