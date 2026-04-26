---
name: PRD v1.1 follow-ups (P2, P4, P5)
overview: |
  Captures the three workstreams left over after PRD v1.1 P1 (Coverage Gate)
  and P3 (UI copy) shipped in commits 8cc5591..fc96071. Each is independently
  scopable; none blocks the others. Sequencing recommendation: P2 → P4 → (data-
  gated) P5. Do NOT bundle them — narrow, per-workstream commits per the
  established repo discipline (see CLAUDE.md non-negotiables).

  Source PRD: "Case Classification, Coverage & Automation Guardrails (v1.1)".
  Locked plan summarized in conversation 2026-04-26.

todos:
  - id: p2
    content: |
      P2 — Automation matrix audit.

      Goal: verify `lib/automation/pipeline.ts > evaluateAndMaybeAutoSave`
      and `lib/automation/autoSaveGate.ts` honor the §9 matrix as
      tested invariants:

        - mode === review               → park_for_review (always, no exception)
        - mode === auto + strong + gate ok → auto_save
        - mode === auto + moderate      → park_for_review
        - mode === auto + weak          → block
        - coverage === covered_shopify  → skip_covered (already shipped, P1)

      Read end-to-end. Document any drift from the matrix. Add a test
      that exercises each row deterministically (mock the rule + gate
      inputs; assert action). No new behavior expected; if the matrix
      and code agree the deliverable is the test file. If they disagree,
      tighten the code — the matrix is the source of truth per the
      "User control is absolute" PRD principle.

      Risk: low. Effort: ~30 min read + 0–2 small fixes + ~50 LOC test file.
      Trigger to start: any time, no prerequisites.
    status: pending

  - id: p4
    content: |
      P4 — Fatal-loss gate (limited scope).

      Goal: short-circuit cases where evidence-strength scoring is
      misleading because the case is structurally unwinnable. Lives at
      PRD §3 step 2 (between Coverage Gate and Evidence Strength).

      LOCKED scope — only two triggers in v1:
        1. refundIssued     — pack.refunds[] shows a successful refund
                              for the disputed amount (or full).
        2. INR + no fulfillment
                            — reason ∈ {PRODUCT_NOT_RECEIVED, ITEM_NOT_RECEIVED}
                              AND order has no successful fulfillment
                              (displayFulfillmentStatus === "UNFULFILLED",
                              fulfillments.length === 0).

      Behavior when triggered:
        - caseStrength.overall capped at "weak"
        - autoBlocked = true (new field)
        - reason = "fatal_loss" (new field on caseStrength)
        - heroVariant = "hard_to_win" (no new variant — re-use the red
          palette; the §10 "Low likelihood case" label still applies)
        - Pipeline: even if rule-mode is auto, do NOT auto-submit.

      EXPLICITLY OUT OF SCOPE for v1 (defer to a future P4.1+):
        - "Valid cancellation before billing" — no clean source today
        - "Confirmed fraud accepted by merchant" — no UI for this today
        - "Evidence contradiction" — needs a contradiction model

      Implementation outline:
        - New helper `lib/automation/fatalLoss.ts` returning
          { triggered: bool, reason: "refund_issued" | "inr_no_fulfillment" | null }.
        - Wire into `calculateCaseStrength` after coverage check, before
          the existing fraud/default scoring branches.
        - Wire into `evaluateAndMaybeAutoSave` after the Coverage Gate
          short-circuit, before the rule-mode resolution.
        - Add the FATAL_LOSS rows to docs/technical.md and CLAUDE.md.
        - Tests: each trigger fires; non-triggers don't fire; auto+fatal
          → block, never auto_save.

      Risk: medium-low. The gate only ever makes auto stricter, never
      looser, so false positives manifest as "missed auto-submit" not
      "bad submission". Effort: a few hours. ~1 commit.

      Trigger to start: after P2 lands.
    status: pending

  - id: p5
    content: |
      P5 — Reason-aware Strong floor (DEFERRED).

      Goal: replace the count-based default formula
      (`strongCount >= 2 → Strong`) with reason-aware decisive-evidence
      matching, so e.g. INR with signature delivery is Strong on a single
      decisive signal — matching how fraud already works via the
      existing override.

      Status: NOT in v1.1. Locked decision (2026-04-26): keep the current
      ≥2 strong floor + fraud override; stabilize the system first.

      Why deferred:
        - This is a new scoring engine, not a patch.
        - "1 decisive → Strong" pushes the Strong floor down, making
          more cases auto-submit-eligible. Risk of false positives.
        - Cannot be validated without outcome data we don't have yet.

      Prerequisites before starting:
        1. Backtest harness — re-run the rebuilder against historical
           disputes both ways (current vs proposed) and compare classifications.
        2. Feature flag — must ship behind a per-shop toggle, default off.
        3. Real outcome data — auto-submit win rate, % moderate routed
           to review, % weak overridden. PRD §12 metrics are the gating
           signal.

      Trigger to revisit: when ≥ N (TBD; suggest 200) labeled outcomes
      are flowing AND P2/P4 have been stable for ≥1 month.

      Until then: do not pre-design. The existing fraud override already
      demonstrates the reason-aware pattern; expanding it requires data,
      not code.
    status: pending

isProject: false
---
