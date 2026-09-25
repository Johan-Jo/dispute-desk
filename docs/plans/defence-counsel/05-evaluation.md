# Plan 5: Evaluation. How "better" is decided before anything ships

The previous cycle judged letters by rule compliance, one draft at a time, in production. It failed. This plan puts persuasion first and keeps the maintainer's time for the final say.

**Past DisputeDesk letters and their outcomes are NOT used**, neither as examples nor as a benchmark. The maintainer: "we have not been doing good defences. Up until now, there's no value in that."

## 1. The eval set: cases, not letters

About 12 real open or recent disputes, chosen to cover the shapes counsel must handle. The **inputs** are used (ledger records), never the letters we wrote:

| Shape | Example |
|---|---|
| Single parcel, carrier-delivered, dispute long after | #352543 (reference) |
| Multi-parcel, one delivered and one only shipped | #360980 |
| Delivered after the dispute opened | find one |
| Signature on delivery | find one |
| Delivered, no line-item mapping (count only) | find one |
| Digital goods, access record | find one |
| Fraud 10.4 with Apple Pay, IP match and history | find one (for the fraud playbook later) |

Store each as a fixture: `inputs.json` in the shape of `case-352543/inputs.json`, redacted.

## 2. The judge: an LLM acting as the issuer analyst

A separate model call (a different model from the writer where possible) with this role:

> "You are a senior dispute analyst at a card issuer. You have two minutes. Read the merchant's response."

It returns:
```json
{
  "decisionAfterSummaryOnly": "merchant | cardholder | undecided",
  "decisionAfterFullLetter":  "merchant | cardholder | undecided",
  "theoryOfTheCase": "what you understood the merchant's story to be, in one sentence",
  "strongestLine": "…",
  "weakestLine": "…",
  "scores": { "punchline": 1-5, "clarity": 1-5, "evidenceUse": 1-5, "noRepetition": 1-5, "credibility": 1-5 },
  "redFlags": ["any overstatement, accusation, disclaimer, or anything that made you doubt the merchant"]
}
```

Hard fails, regardless of score:
- any Plan 2 §3 item;
- any code check failure (Plan 4 §6);
- `decisionAfterSummaryOnly` other than "merchant" on a case whose ledger has all core claims.

## 3. Loop

1. Run the full eval set for each prompt or model variant. That's about 12 cases × 3 candidates.
2. Rank the variants by: hard fails (must be 0), then summary-only merchant decisions, then mean score.
3. **The maintainer reviews only the best three and worst three letters of the leading variant, printed in chat**, not every draft.
4. The maintainer's verdict overrides the judge. When they disagree, update the rubric or the judge prompt with the maintainer's reason, so the judge learns what excellent means *to this maintainer*.

## 4. Acceptance to ship (the item-not-received family)
- 0 hard fails across the eval set;
- summary-only decision "merchant" on every case where the core claims are present;
- the maintainer calls the reference case (#352543) and #360980 "excellent counsel".

## 5. Tooling
- Extend `case-352543/pilot-harness.mts` into `scripts/eval/counsel-eval.mts`, with fixtures under `scripts/eval/fixtures/`.
- Anthropic calls: the staging pilot route (`app/api/public/pilot-inr-letter/route.ts`) exists and is token-gated. Alternatively, add a local workspace-scoped key to `.env.local`: the key there today needs an `anthropic-workspace-id`. OpenAI calls run locally.
- Output one HTML report per run: the letters side by side, the judge's JSON, and the check results.
