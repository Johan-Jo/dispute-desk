# Defence letters written as excellent counsel: plan series

**Audience:** an engineer or LLM taking this work over with no prior context. Read this file first, then the plans in order.
**Status:** PLANS ONLY. Nothing here is built. Written 2026-09-25 after the maintainer rejected every letter variant produced so far.

## The brief, in the maintainer's own words

> "This is only a really boring, objective listing of the facts that have happened. It is not written in a defence letter mode."

> "This is nothing like we make a bank analyst fall backwards and agree with us, not even close."

> "We are looking for excellent counsel. We should always do the best with the evidence we have to work with… you're still speaking objectively about data points here without any punchline at all."

> "I just read the executive summary, and if you think this is good counselling, you should really go and update yourself."

Plus standing rules from the same review cycle, which still apply:

- "It makes it unprofessional to repeat redundant information… each section should provide new information else it shouldn't be there."
- Don't repeat what the page already shows: no order number in the prose (the header has it), no timestamps, no restating the line-items arithmetic.
- The letter is written by counsel in the **third person** ("the merchant", "Blume"), in the existing **numbered layout**.
- Use the merchant's **name** ("Blume"), not its domain.
- Past DisputeDesk letters are **not** a benchmark or training source: "we have not been doing good defences".

## What "done" means

A bank dispute analyst who reads the executive summary alone knows the merchant's theory of the case and wants to side with it. Every section after it moves that case forward with evidence. Every sentence is true and provable from the records, and the letter never volunteers a weakness. The maintainer reads it and says it is excellent counsel.

## The plans

| # | File | Answers |
|---|---|---|
| 1 | [01-diagnosis.md](01-diagnosis.md) | Why every version so far failed, with the verbatim outputs and verdicts |
| 2 | [02-counsel-standard.md](02-counsel-standard.md) | What excellent counsel is, concretely: theory of the case, punchline, structure, rhetoric, and what is off-limits |
| 3 | [03-evidence-and-claim-ledger.md](03-evidence-and-claim-ledger.md) | All evidence we hold (most of it never reaches the model today), and how it becomes provable claims |
| 4 | [04-prompt-architecture.md](04-prompt-architecture.md) | What the model is sent and why: system prompt, playbooks, output schema, validation, model choice |
| 5 | [05-evaluation.md](05-evaluation.md) | How "better" is judged before anything ships |
| 6 | [06-implementation-and-rollout.md](06-implementation-and-rollout.md) | Code map, changes, tests, deploy rules, deadlines |

## Reference material

| File | What it is |
|---|---|
| [appendix-A-current-production-prompt.md](appendix-A-current-production-prompt.md) | **Everything production sends the letter model today, verbatim**: 4 system blocks plus the user payload, for case #352543 |
| [case-352543/inputs.json](case-352543/inputs.json) | **Every input variable held for the reference case** (dispute row, full evidence pack, facts, plan, filed narrative), customer identity redacted. Use it as the worked example and as a training or eval fixture |
| [case-352543/production-request.json](case-352543/production-request.json) | The exact production request in machine-readable form |
| [case-352543/pilot-harness.mts](case-352543/pilot-harness.mts) | The pilot: a claim ledger plus an "advocacy" prompt, run on three models. **Its prompt was rejected too**; see 01 |
| [case-352543/pilot-output.*.txt](case-352543/) | The three pilot outputs (Sonnet 4.6, Opus 5.5, GPT-6 Astra), sentence by sentence with the claims each cites |

## Reference case

**blume-box order #352543.**

| | |
|---|---|
| Claim | Visa 13.1, item not received, CAD 120.75 |
| Order | Three items, placed and paid (Apple Pay) on 2 Jul 2026 |
| Shipment | Shipped the same day in one Stallion Express shipment, tracking 260702441A |
| Delivery | The carrier recorded it as delivered on 6 Jul 2026, and a delivery email went to the order's address that day |
| Dispute | Opened 19 Sep 2026, 75 days after delivery |
| Deadline | Files automatically on 3 Oct 2026 unless changed |

Links:
- Dispute (merchant app): https://admin.shopify.com/store/blume-box/apps/disputedesk-1/app/disputes/25034e1e-ab3e-4457-88d1-d1f9751f9a12
- Second live case in the same family, the harder multi-parcel shape (#360980, files 3 Oct): https://admin.shopify.com/store/blume-box/apps/disputedesk-1/app/disputes/4576ee51-53ec-4ed2-8c66-65b04bb31d72

## Non-negotiables (from CLAUDE.md and the maintainer; do not relitigate)

1. **Merchant's counsel.** Always defend. Never recommend conceding. Never volunteer an adverse fact, a weakness or a caveat in bank-facing text.
2. **Every sentence true.** Nothing is invented and nothing is overstated. Persuasion comes from selection, order, framing and inference, never from fabrication.
3. **No delivery-destination claims** (the "rule 14" in the current prompt). We hold no evidence tying a carrier's delivery event to an address, so the letter never says where a parcel went or that the address was verified or matched. It never says the cardholder personally received the goods either.
4. **Production releases need the maintainer's explicit in-chat approval for each change.** Staging (`develop`) is free. See CLAUDE.md rule 9.
5. **Database commands must name dev or prod explicitly** (`npm run db:query:prod` / `db:query:dev`). See CLAUDE.md rules 0–2.
