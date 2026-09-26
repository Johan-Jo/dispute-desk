# Counsel v2 — cost refactor

Status: PLAN, 2026-09-26. Nothing here is built.
Scope: cost of the counsel v2 letter writer (`lib/defence/counsel/`) only. Letter rules, exhibits and
validators stay as they are.

## 1. The problem, measured

First production run (#352543, v12, 2026-09-26): **89,970 input + 11,994 output tokens, 68 s,
≈ $0.45** (Sonnet 4.6 at $3 / $15 per million). The template writer costs ≈ $0.03–0.05 on the same
case, mostly served from the prompt cache. Counsel is ~10× more expensive.

Where the tokens go (prompt sizes measured from `prompts.ts`; ≈ chars / 4):

| Stage | Input per call | Calls per run | ≈ Input per run | Why it exists |
|---|---|---|---|---|
| Strategist | 3,400 | 1 | 3,400 | Pilot: plan the argument before writing |
| Writer | 4,650 | **5** | 23,000 | Pilot: best-of-5, then pick one |
| Correction | ~6,000 | ~8 | **~48,000** | Each failing draft gets up to 2 rounds, each resending the full writer prompt + the draft |
| Fact-check | 1,600 | ~13 | ~21,000 | After every draft and every correction |
| Judge | 1,000 | 5 | 5,000 | Ranks the 5 drafts |
| **Total** | | **~32 calls** | **~90,000** | |

Nothing is cached: `run.ts` sends each system prompt as a plain block, so the same 3,300-token
writer instructions are paid for in full ~13 times per run.

Root cause: the pilot's quality harness (best-of-5 + judge + a fact-check on every attempt) went to
production unchanged, with no cost budget. Most of the spend is on drafts that get thrown away and on
correcting sentences the code could have written.

## 2. Target

| | Today | Target |
|---|---|---|
| Model calls per package | ~32 | **2–3** (1 write, 1 review, a correction only when needed) |
| Input tokens | ~90,000 | **≤ 8,000**, most of it cached |
| Cost per package | ≈ $0.45 | **≤ $0.05**, the same as the template writer |
| Rebuild with unchanged evidence | full run again | **$0** (reuse) |
| Quality | judge decides for the merchant from the summary | unchanged, proven on the regression set (§5) |

## 3. The refactor — six changes, in order of savings

### 3.1 Code writes what code knows (fewer words to generate, fewer corrections)

Most correction rounds fixed sentences whose content is fixed by the records: the Shipping pair ("all N
items in this single tracked shipment" / "no partial or second shipment"), the carrier-record sentence
and link, and the conclusion ("The carrier recorded delivery of the entire order. After that delivery,
the same customer … The non-receipt claim is not supported by the record."). All of them follow from
ledger claims.

- Render them from the ledger, like the existing record-built sections (`shipmentRecordSections.ts`):
  each claim gets an optional `sentence` template.
- The model writes **only the executive summary** (≤ 80 words), plus one optional chronology sentence
  when a claim is not already in the summary.
- Code checks stay as they are; they now apply to far less generated text.

Effect: output ~12,000 → ~400 tokens; most correction causes disappear (the shipping-pair and
conclusion failures, and the summary word-count bounce, which came from the model restating those parts).

### 3.2 One draft, not five; no judge in production

- Write **one** draft. Only if it fails the checks: one surgical correction. If that fails: the template
  writer (as today). No second draft.
- The judge moves to the **evaluation harness only** (§5): it ranked 5 drafts; with one draft there is
  nothing to rank. Its "unclear sentence" test is folded into the review call (§3.4).

Effect: writer calls 5 → 1; judge calls 5 → 0; corrections ~8 → 0–1.

### 3.3 No strategist call

The strategist picks a theory from the playbook and places the specifics. Both can be done in code:
the playbook already lists theories with `requiresClaims` in order of force; the first one whose claims
are all in the ledger is the theory. Specifics placement becomes a rule ("each specific once; dates in
the summary"), which the checks already enforce.

Effect: −1 call, −3,400 input tokens.

### 3.4 One review call on a small model

Fact-check (does each sentence match the ledger?) and the judge's clarity test (any sentence to read
twice?) become **one** call on **Haiku 4.5**, reviewing only the model-written text (the summary),
not the record-built sentences.

- Run it only after the code checks pass (as today).
- It returns `{ errors: [...], unclear: [...] }`; any entry triggers the single correction.
- Keep the exemptions from #840 in its prompt (conclusion and Shipping pair); they will mostly be moot
  once code writes those parts.

Effect: ~13 Sonnet fact-checks → 1–2 Haiku calls.

### 3.5 Prompt caching and a shorter prompt

- Send the static instructions (register, bans, example) as a **cached system block**
  (`cache_control: ephemeral`, as `narrativeWriter.ts` does); the case (ledger, context) goes in the user
  message. The correction call reuses the same cached block.
- Cut the writer system prompt from ~3,300 to **≤ 1,500 tokens**: remove rules the code already
  enforces (copy rules, banned words, counts, carrier name, word limit, specific-once). The prompt keeps
  only what code cannot check: the register, the summary's shape, and the example. A rule the code
  rejects costs one correction at most; repeating it in every prompt costs tokens on every call.

Effect: static input billed at the cache-read rate after the first call of the day.

### 3.6 Reuse when nothing changed

Packages rebuild often (#352543 has 12 versions): a pack re-collect, a prompt bump of the *template*
writer, a sync. The counsel letter depends only on its inputs.

- Hash the inputs: ledger (claims + specifics), `COUNSEL_PROMPT_VERSION`, model, merchant name.
- Store the hash with the narrative (`narrative_json.counselInputHash`). On rebuild, if the latest
  counsel narrative for the dispute has the same hash and passed validation, **reuse it** and make no
  model call.

Effect: most rebuilds cost $0.

## 4. Expected cost after the refactor

| Call | Model | Input (≈) | Output (≈) | ≈ Cost |
|---|---|---|---|---|
| Write summary | Sonnet 4.6 | 1,500 cached + 1,200 case | 250 | ~$0.008 |
| Review | Haiku 4.5 | 1,200 | 150 | ~$0.002 |
| Correction (≤ 1 in 3 packages) | Sonnet 4.6 | 1,500 cached + 1,500 | 250 | ~$0.003 on average |
| **Per package** | | | | **≈ $0.01–0.02** |
| Rebuild, inputs unchanged | — | 0 | 0 | **$0** |

Estimates use list prices; the telemetry in §6 replaces them with measured figures.

## 5. Quality gate (before anything ships)

- **Regression set:** #352543 plus 5–8 other item-not-received cases from production inputs (read-only),
  stored redacted under `scripts/.snapshots/` (never committed).
- For each case: run the refactored writer, render the PDF, and run the **judge offline** (the eval
  harness keeps it). Pass: the judge decides for the merchant from the summary alone, no unclear
  sentences, and all code checks pass on the first draft for ≥ 2 of 3 cases.
- The maintainer reviews the #352543 PDF side by side with today's v12 before release.

## 6. Telemetry (ships with the refactor)

- `defence_package_runs` gets per-stage token counts for counsel runs (write, review, correction, reused).
- Log cache-read tokens (already returned by `callClaudeMessages`).
- Admin query: median and p90 counsel cost per package per day; alert if the median exceeds $0.05.

## 7. Order of work

1. §3.6 reuse (independent; stops repeat spend immediately).
2. §3.1 code-written sentences, and §3.3 theory by code.
3. §3.2 one draft + §3.4 Haiku review; judge moved to the eval harness.
4. §3.5 caching + shorter prompt.
5. §5 regression run, §6 telemetry, then the release PR.

## 8. Until the refactor ships

Counsel runs in production now at ≈ $0.45 per item-not-received build (cap: 25 runs per shop per day).
Two ways to stop the spend in the meantime:
- set `DEFENCE_COUNSEL_V2=off` in the production Vercel env (no deploy; the template writer takes over), or
- lower `DEFENCE_COUNSEL_DAILY_RUN_CAP`.
#352543's v12 letter is already written and stays the filed version either way.
