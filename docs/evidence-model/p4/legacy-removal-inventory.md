# Legacy-removal inventory + consumer paths (audit of record)

**Method:** read-only call-site audit, 2026-08-05. Companion: `internal-decision-audit.md`.
33 removal items (L1–L33) grouped by the migration phase that deletes them, plus the per-consumer
current paths, the four gate-set variants, and the cross-cutting risks. A consumer is complete
only when it reads exclusively from its canonical layer, its former logic is deleted, and no
fallback can silently reinstate the old truth source.

## The four `calculateCaseStrength` production call sites (gate sets differ)

| Site | coverage | fatalLoss | riskWeakness | nameMismatch | creditAlreadyIssued |
|---|---|---|---|---|---|
| `lib/packs/buildPack.ts:805-822` | real | real | real | real | real |
| `app/api/disputes/[id]/workspace/route.ts:689-713` | real | **null** | **null** | real | pack_json |
| `app/api/disputes/route.ts:467-493` (stage-B) | **null** | **null** | **null** | real | projected |
| `hooks/useDisputeWorkspace.ts:991-1009` (client) | real | **null** | **null** | **null** | pack |

Consequence of row 2 vs row 4: on a fraud case with a cardholder-name mismatch, **the client can
show Strong where the server capped Moderate, on one screen.** ESLint guard `eslint.config.mjs:97,121`
forbids a shared all-nulls constant; `caseStrength.ts:377-399` documents the required object.

## Removal inventory by phase

### Phase 1 (scoring, atomic)
| # | Item | file:line | Replacement / note |
|---|---|---|---|
| L1 | Client `calculateCaseStrength` | `useDisputeWorkspace.ts:991-1009` | server `CaseAssessment` returned by the workspace API |
| L2 | Client `computeContributions` | `:1023-1027` | server contributions |
| L3 | Client `calculateImprovement` (internally a 3rd all-null-gates strength call, `caseStrength.ts:1105-1111`) | `:1030` | `CaseAssessment.strength.improvementHintI18n` |
| L15 | List-route `pack_json.case_strength ?? recompute` (try/catch-swallowed) | `disputes/route.ts:380-506` | versioned snapshots, stale-flagged |
| L25 | The four gate-set variants (table above) | — | one `deriveCaseAssessment(CaseGateAssessment)` |
| L29 | `void caseStrength;` | `workspace/route.ts:856-860` | becomes the returned value |
| F1/F6 | `presentation?.strength ?? clientRecompute`; hardcoded strength literal when `!data` | `OverviewTab.tsx:963-964`; `useDisputeWorkspace.ts:880-892` | deleted with L1 |

### Phase 2 (completeness contract)
| # | Item | file:line | Replacement / note |
|---|---|---|---|
| L4 | Client readiness/blocker recompute (ignores the delivered `submissionReadiness`) | `useDisputeWorkspace.ts:956-974` | `CaseAssessment.completeness` |
| L11 | `evaluateCompleteness` V1 — output `pack_json.completeness` has **zero readers** (verified) | `completeness.ts:283+`; call `buildPack.ts:635-640` | delete |
| L12 | Persisted `pack_json.completeness` block | `buildPack.ts:876-882` | delete |
| L13 | `REASON_TEMPLATES` v1 + `getTemplate` | `completeness.ts:99-181` | v2/definitions only; update `checklistFieldCopy` test |
| L33 | Legacy v1 columns `checklist`/`recommended_actions` (writers ×4; readers `renderPdfJob.ts:35`, `disputes/[id]/route.ts:45`) | — | migrate readers, drop writes |
| **F42** | `submissionReadiness ?? undefined` — silently reverts `autoSaveGate.ts:45-53` to legacy blocker counting | `pipeline.ts:808-810` | always pass a value |
| L30 | Dead `completeness_score` select | `enqueue.ts:67` | delete |

Completeness writers ×5: `buildPack.ts:983-1001`, upload `:301-311`, waive `:153-164/250-261`,
acknowledgement `:219-229`, null-writer `packs/[packId]/route.ts:446-449`. Readers: the auto-save
gate (`pipeline.ts:804-811`), save-to-shopify route gates (`:57-80`), pack page +
`SubmissionSidebar.tsx:52-57` (hardcoded 80/40 display thresholds), portal pages, admin metrics,
evidence-pack PDF (`renderPdfJob.ts:35,70`), intelligence registry (`registry.ts:148`).

### Phase 3 (tabs incl. Review & Forward's inclusion list)
| # | Item | file:line |
|---|---|---|
| L5 | Flat "every available row = moderate" pill | `useDisputeWorkspace.ts:77-114` |
| L6 | Client internal-signals reimplementation (AVS table :411-458, billing :482-539, IP :541-575, name :584-604, prior-CB :621-636, orchestrator :638-704) | `useEvidenceSections.ts:350-704` |
| L7 | The "keep the two in lockstep" markers | `:390`; `evidenceLineItem.ts:404-407`; `internalSignals.ts:9-28` |
| L9 | `classifyEvidenceRow`/`categoryBadge` (+ ci.yml guard update) | `categoryBadge.ts`; `OverviewTab.tsx:1414-1418` |
| L16 | Overview signalId dedup + `deliveryRank` | `OverviewTab.tsx:1443-1479` |
| L20 | Evidence-tab surviving-field collapse | `EvidenceUsedSection.tsx:208-224` |
| L23 | `WHY_THIS_MATTERS` English map | `useEvidenceSections.ts:327-348` |
| L24 | `inferSource` hand-lists (default "shopify") | `:266-298` |
| L14 | Label fallback registries ×7 (`label \|\| field.replace`, try/catch → legacy English) | `useDisputeWorkspace.ts:509-511`; `useEvidenceSections.ts:696,717-726`; `EvidenceUsedSection.tsx:185-194`; `InclusionReviewSection.tsx:110-122` |

### Phase 4 (argument layer + package)
| # | Item | file:line / note |
|---|---|---|
| L8 | `specificInternalReason` (2nd payload→reason classifier) | `evidenceLineItem.ts:719+` |
| L10 | `deriveEvidenceLineItems` (1,524 lines) — after InclusionReview/SubmissionSummary move to plan/usage projections | called `route.ts:799-813` |
| L18/L19 | Remaining delivery collapses (line-items `:1287+`; PDF `evidenceBasisRows.ts:280-284`) — **needs `supersedes` populated first (L32)** | — |
| L21 | `FIELD_LABEL_EN` | `factClassifier.ts:525-550` |
| L22 | `CONTRIBUTION_VALUE_LABEL_KEY` | `caseStrength.ts:96-108` |
| L26 | Hardcoded `caseStrength:"moderate"` ×4 (`enqueue.ts:161`; job `:201,262,341`) — un-hardcoding **revives `derivePackageMode`'s weak→narrow branch: a real behaviour change to measure** | — |
| — | The four-predicate divergence → one canonical bank-inclusion predicate | see audit #27/#60/#136/#165 |

### Phase 5 (automation)
| # | Item | file:line |
|---|---|---|
| L27 | Defence job's independent `evaluateRules` (2nd mode resolution) | `buildDefencePackageJob.ts:611-626` |
| L28 | Reconcile's extra Strong-only pre-filter | `reconcileParkedAutoDisputes.ts:80-86` |
| — | heldState dual source: workspace passes the server RECOMPUTE, the alert email passes the PERSISTED value with `automationMode:"auto"` hardcoded — page and email can disagree on a stale pack | `workspace/route.ts:888-907`; `sendNewDisputeAlert.ts:1064-1079` |

### Carried open
| # | Item | Note |
|---|---|---|
| L31 | `ScoringPolicy.scoreNotApplicable` | = decision P-1 |
| L32 | `provenance.supersedes` declared, never populated | prerequisite for L18/L19 removal |
| — | CE 3.0 dormant package/router | = decision P-4 |

## Automation entry-point map (Phase 5 input)

- `pipeline.ts` `evaluateAndMaybeAutoSave` steps: failed→block · covered→skip · rules→mode ·
  guards (auto only) · fatal block / moderate park / weak block · review park · **completeness
  gate reached ONLY by Strong/credited** · auto-save or block.
- `buildDefencePackageJob.ts:611-683` — own `evaluateRules` + own guard call; park and block
  both land as `draft`, distinguishable only by `verdict_reason` in the audit row.
- `reconcileParkedAutoDisputes.ts` — pack `ready` + persisted strength `=== "strong"`
  (pre-filter) + guards + rules-auto + package draft/ok/pdf + no in-flight job → finalize.
- **`defence-package-deadline-submit` cron — the actual submitter — consults NO strength, NO
  completeness, NO coverage, NO guards.** Files every non-conceded case with a valid PDF in the
  due window (skips `needs_review`; includes `review_state=approved`).
- `deadline-rebuild` cron — freshness-based `build_pack` enqueue only; **includes `needs_review`**
  unlike the submit cron.
- `heldState` (workspace + email callers, sources differ — above) ·
  `saveToShopifyJob` — status/final/pdf gates only, by design.

## Cross-cutting risks

- **R1** `autoSaveGate` legacy fallback on `undefined` readiness (F42).
- **R2** Prod thresholds (60/50) calibrated for semantics nothing runs — completeness contract is
  ordered early for exactly this reason.
- **R3** The deadline cron consults none of the seven decisions (= decision P-6).
- **R4** `EvidenceFact.id` is positional and `computeEvidenceHash` sorts on it
  (`computeEvidenceHash.ts:90-91`) — record-id migration changes every hash once: schedule a
  deliberate fleet-wide package version bump with the enqueue idempotency check accounted for.
