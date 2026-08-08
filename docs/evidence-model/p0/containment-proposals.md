# Phase 0.5 containment proposals — each item separately approvable

**Status: PROPOSED, not approved.** Phase 0's approval covers none of these. Each is a narrow
fix for a defect **currently reachable in production**, shippable before and independently of the
migration. Each ships alone: own approval, own PR, own before/after diff on regenerated packages.
None restores past behaviour; none adds architecture. Reachability measured 2026-08-05
(read-only; queries reproducible).

| # | Defect | Reachability (measured) | Proposed narrow fix | Bank-visible effect |
|---|---|---|---|---|
| **C-1** | Unciteable 3DS reaches the LLM payload, satisfies `three_d_secure_present` for claim guards, and resolves the thesis `paymentAuthMethod` — suppressed only in the PDF table (four-predicate divergence) | **1 open dispute** (unshifted-3DS pack with a defence package) | Unify the LLM-payload filter to the Evidence-Basis predicate (`bankEligible ∧ includeInBankNarrative ∧ ¬submissionRisk`); update `narrativeWriter.bankInclusionInvariant.test.ts` which currently pins the weaker contract | Prompts/guards/thesis stop seeing facts the PDF table already suppresses. **Note (register R-A + `3ds-network-table.md` §0):** the "unciteable" class is network- *and* observability-conditional. The network rules are V-PRIMARY on both sides (Visa ECI 5/6 protected; MC SLI 211/212/217/242 ineligible), but **no DisputeDesk-observable 3DS state is citable today** — Visa ECI 6 and every Mastercard state are blocked on the gateway↔wire-value mapping, and Visa ECI 5 on three unobservable rule conditions. C-1 only makes the four surfaces agree with each other under today's rule; it decides none of those cells |
| **C-2** | Thesis token asserts "undisputed" purchase history without `disputeFreeHistory === true` | **16 live packages** carry an unverified prior-history fact with `priorOrderCount > 0`; any whose thesis includes the clause tells an issuer "undisputed" unverified | **Emit no prior-history clause at all unless `disputeFreeHistory === true`.** `true` → current wording; `null` or `false` → clause absent. (A "count-only" replacement wording was considered and **rejected**: containment removes an unverified claim, it does not invent a new issuer-facing assertion nobody approved. Any count-only clause is a separate proposal with its own justification and approval.) Matches the Evidence-Basis renderer and the repeat-customer strategy prompt, both of which already refuse the word. Primary-anchored: the CE-chart/profile evidence contemplates *undisputed* prior transactions specifically | Removes a potentially false assertion to issuers; adds none |
| **C-3** | `no_return_initiated` renders to the issuer as the word "Confirmed", sorted last (rank 999); 3 more categories share the default | **Every package citing it** (incl. #352552 v5) | Add a renderValue branch ("No return initiated or received") + `CATEGORY_ORDER` entries for `no_return_initiated`, `subscription_terms`, `digital_access_log`, `service_access` | Verified rebuttal content (register R-C) becomes legible instead of noise |
| **C-4** | PDF footer prints `packageMode` + `prompt v{n}` on every page | **Every PDF** | Remove from the footer; keep both in `defence_packages` metadata/audit | Stops disclosing internal posture (narrow/full) to issuers |
| **C-5** | "Cardholder name" Case-Details row falls back to the ORDER customer name | **Any package lacking a gateway cardholder name** | Render the row only when gateway-sourced; otherwise label "Customer name" | Stops mislabeling a name to the issuer on exactly the disputes where names diverge |
| **C-6** | Synthetic chronology assertions ("Authorisation captured against the cardholder's {network} ending in {last4}") bypass all validators | **Conditional** — packs without a rich Shopify timeline | Two requirements, both mandatory: (1) synthetic chronology events may be **derived only from verified structured inputs** actually present on the case (e.g. network + last4 read from the transaction record — never free-composed prose); (2) the derived bullets then ALSO pass `validateComposedDocument`'s phrase + claim-guard checks before render. Phrase checks alone are not authorization to manufacture an assertion | Closes the one unvalidated bank-facing text path, at the derivation layer first |

Not proposed for containment (not reachable):

| # | Defect | Why no containment |
|---|---|---|
| C-7 | Manual-evidence promotion mints `supporting ∧ bankEligible:true` | **0** `defence_manual_evidence` rows in prod; Phase 4 fixes it |
| C-8 | CE 3.0 package: raw IPs, ungated attestation, hard-coded "10.4" | Dormant — no caller; decision P-4 governs |
| C-9 | `canceled_recurring` forced `narrow` by unreachable category | **0** open SUBSCRIPTION_CANCELLED disputes; decision P-5 governs (zero-risk window to fix) |
| C-10 | Prior-chargebacks disclosure branch | Dead (grade `supporting` blocks it); decision P-8 encodes the rule and deletes it |

Recommended order if approved: C-3 and C-4 (pure rendering, lowest risk) → C-5 → C-2 → C-6 →
C-1 (touches the LLM payload; regenerate the one affected package after).
