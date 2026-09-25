# Plan 6: Implementation and rollout

## 1. Code map: where the letter is made today

| Step | File | Notes |
|---|---|---|
| Job entry | `lib/jobs/handlers/buildDefencePackageJob.ts` | Loads the dispute and pack, classifies facts, calls the model, applies overrides, validates, composes, renders |
| Fact classification | `lib/defence/factClassifier.ts` | Decides which records are bank-eligible. Its rules stay the authority on what may reach a bank |
| Model call | `lib/defence/narrativeWriter.ts` | `BASE_SYSTEM_PROMPT`, `buildLlmFactPayload`, `generateNarrative`. Model `claude-sonnet-4-6` (env `DEFENCE_PACKAGE_DEFAULT_MODEL`), `PROMPT_VERSION` 39 |
| Family overlay / module / strategies | `lib/defence/reasonCodes/families/item_not_received.ts`, `lib/defence/reasonCodes/registry.ts`, `lib/defence/strategies/*` | The overlay also holds the INR prohibited and guarded phrase lists |
| Template override (INR) | `lib/defence/shipmentRecordSections.ts` | Replaces the model's text for single- and multi-parcel INR letters. Becomes the fallback under this plan |
| Item-by-item coverage | `lib/defence/fulfilmentCoverage.ts` | Already built; the basis of `whole_order_in_shipment` |
| Validation | `lib/defence/validateNarrative.ts`, `lib/defence/claimGuards.ts`, `lib/defence/internalConstraints.ts` | Reused as-is |
| Section visibility | `lib/defence/sectionVisibility.ts` | Record-built sections carry `source: "record"`. The new counsel sections should too, or get their own source value |
| Headline / request templates | `lib/defence/pdf/thesisTemplates.ts`, `thesisTokens.ts`, `renderThesis.ts` | The pull-quote headline is templated today |
| Composition + PDF | `lib/defence/pdf/composePdfBlocks.ts`, `lib/defence/pdf/DefencePackageDocument.tsx` | Numbered layout. Line-items and chronology prose slots exist. The conclusion prints reasoning, then the request |
| In-app preview | `app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx` | Must mirror the PDF |
| Merchant name | `buildDefencePackageJob.ts` (`merchantDisplayName`, uses the domain) | **Change to `shops.shop_name` ("Blume")**, per the maintainer |

## 2. Work packages, in order

1. **WP1: Evidence (Plan 3 §2).** Resolve Q1–Q4 for the reference case. Add the customer's-other-orders read, and the Gorgias claim extraction if it helps.
2. **WP2: Claim ledger (Plan 3 §3).** `lib/defence/claimLedger.ts` plus tests, one per claim condition.
3. **WP3: Counsel standard in prompts (Plans 2 and 4).** Strategist and writer prompts, the INR playbook, and synthetic register examples.
4. **WP4: Checks (Plan 4 §6).** Grounding, copy rule, anti-pattern lint, corrective retry, template fallback.
5. **WP5: Eval harness (Plan 5).** Fixtures, judge, report. Iterate WP3 until the Plan 5 §4 acceptance criteria are met.
6. **WP6: Pipeline wiring behind a flag.** `DEFENCE_COUNSEL_V2_FAMILIES`. Headline from the model (needs the maintainer's approval, see Plan 4 §5). Merchant name from `shop_name`. Bump `PROMPT_VERSION`, `COMPOSITION_VERSION` and `VALIDATOR_VERSION` as their pinned tests require.
7. **WP7: Rollout.**
   - Staging first.
   - Canary on 2–3 live INR cases: read each letter, and get the maintainer's approval of the text.
   - Then production (maintainer approval required for each change).
   - Then rebuild the remaining open INR disputes after printing the list for a yes (standing rule: canary before bulk).

## 3. Repo rules the implementer must follow (from CLAUDE.md and memory)
- **Branches:** work on a branch. Open a PR to `develop` (staging; auto-merge is fine). For `master` (production), get the maintainer's explicit in-chat yes **for that change**. Never use `--admin`, and never auto-merge a `master` PR.
- **Database:** use `npm run db:query:prod` / `db:query:dev` only (a guard confirms the target). Never pipe the output through `tail`.
- **Before calling it done:** run `npm test` and `npx tsc --noEmit`, plus `npm run build` for UI changes. Update `docs/technical.md` in the same commit.
- **Rebuilding one case:** `node scripts/build-one-pack.mjs <disputeId> --rebuild --env-file .env.production.local --apply`. Poll `defence_packages` for the new row, and filter by `created_at`.
- **Local PDF preview:** `node scripts/build-pdf-worker.mjs`, then `node scripts/pdf-worker/render-defence-pdf.mjs < doc.json > out.pdf`.
- **Copy:** each fact once (memory `feedback_letter_copy_each_fact_once`), applied as scoped in Plan 2 §2.3.
- **Show text for approval in chat**, not only as a file path.

## 4. Deadlines and live cases
- **#352543** (single parcel) and **#360980** (two parcels) both file automatically on **3 Oct 2026** through the deadline cron (08:00 UTC), using the current template letter unless it's replaced first.
- **Recommendation:** get the INR playbook through WP2–WP5 on these two cases first. If they pass Plan 5 acceptance and the maintainer approves before 2 Oct, ship behind the flag for those two. Otherwise they file on the current template.

## 5. Cleanup owed from the pilot
- Remove `app/api/public/pilot-inr-letter/route.ts` (a token-gated staging route, never active in production) once the eval harness has its own path.
- The local token lives in the previous implementer's session scratchpad, not in the repo.
