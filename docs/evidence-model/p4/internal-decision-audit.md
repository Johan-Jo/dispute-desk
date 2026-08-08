# Internal bank-package decision-flow audit (audit of record)

**Method:** traced backward from the Shopify mutation and every PDF section, 2026-08-05,
read-only. Every entry: what it decides · file:line · model-representation status
(**yes / partial / no** = is the decision expressible in `lib/evidence/model/` today).
166 decision points, 16 layers. Companion: `legacy-removal-inventory.md`.

## Layer 0 — What physically leaves for Shopify
1. Submission is EXACTLY `{uncategorizedFile, submitEvidence:true, customer name/email}`; all structured text columns empty — `composeShopifyMutationPayload.ts:35-55` — **no**
2. `customer_display_name` split on first whitespace → first/last sent to issuer; this is the ORDER customer name, not the gateway cardholder name — `:43-49` — **no** (see #130)
3. Refuse unless pack status ∈ {ready, saving, saved_to_shopify} — `saveToShopifyJob.ts:56,86-109` — **no**
4. Window-closed suppression: once `submitted_confirmed`, the prior PDF is final (early `:146-173`, post-upload `:343-378`) — **no**
5. Only highest-version `defence_packages` row, `final`, with `pdf_path` — `:177-205` — **no**
6. 2 MiB PDF cap — a package can be too verbose to defend the merchant — `:223-243` — **no**
7. Bank-visible filename `Defence-{id}-{merchant}-{date}` dated by submission — `:253-261` — **no**
8. `submitted` only after read-back verification — `:570-600` — **no**
9. Coalesced-regenerate tail decides whether a SECOND artifact ships — `:646-724` — **no**

## Layer 1 — PDF section existence and order
10. `SECTION_ORDER` — canonical argument order, PDF + HTML mirror — `render/sections.ts:24-34` — **no**
11. `SECTION_TITLES` — the literal headings issuers read — `:41-51` — **no**
12. Per-module section deny list (`visa_10_4_fraud` drops `policyArgument`) — `sectionVisibility.ts:32-47` — **no**
13. Drop section unless LLM text or deterministic fallback; honour `omittedSections` — `composePdfBlocks.ts:64-95` — **no**
14. The one hard-coded fallback prose (fulfillment, FULFILLED only) — `:35-38,79-88` — **no**
15. Thesis attached only to sections with body — `:101-106` — **no**
16. Render order incl. Evidence Basis between policy and manual sections; chronology outside the validator path — `DefencePackageDocument.tsx:405-472` — **no**
17. Empty-body drops heading; llmText preferred over fallback — `:132-154,383-401` — **no**
18. Cover line `reasonCode — claimType • amount • version` — `:158-175` — **no**
19. Deliberate ABSENCE of the Evidence-Basis caption (old caption leaked an internal approval layer) — `:288-296` — **no**
20. Supporting Evidence Index prints per-document inclusion labels to the issuer — `:319-361` — **partial**
21. Footer prints `packageMode` + `prompt v{n}` on every page — internal posture leaked — `:365-379` — **no**

## Layer 2 — Case Details table
22. The 13 metadata rows and order — `render/caseDetails.ts:118-132` — **no**
23. Per-family row deny list (`unauthorized_fraud` hides "Fulfillment status") — `:77-95,114-134` — **no**
24. Empty values render `—` (layout over hiding) — `:111-112` — **no**
25. Non-card disputes: Klarna category label replaces network code — `buildDefencePackageJob.ts:518-520` — **no**
26. Shopify reason → Klarna display category, never inventing a code — `klarnaDisputeCategory.ts:27-49` — **no**

## Layer 3 — Evidence Basis table (deterministic)
27. Row filter: `bankEligible ∧ includeInBankNarrative ∧ ¬submissionRisk` — `evidenceBasisRows.ts:288-291` — **partial** (model uses a different single-axis predicate)
28. `collapseDeliveryPair` drops tracking when delivery survived — `:280-284` — **yes** (`collapsesWith`)
29. `CATEGORY_ORDER` fixes issuer reading order; **gap:** `no_return_initiated`, `subscription_terms`, `digital_access_log`, `service_access` absent → rank 999 — `:16-49` — **no**
30. Payment-auth cell: `verificationSummary` only, never raw AVS/CVV letters; 3DS appended only with ECI + DS txn id — `:54-102` — **no**
31. Delivery cell: proofType → state + carrier + number + URL on every state incl. in-transit — `:106-136` — **no**
32. Prior-history cell TRI-STATE incl. an adverse "(account has prior chargebacks)" branch — currently dead (grade `supporting` blocks bank-eligibility) but live if grading changes — `:149-181` — **no**
33. `order_record` cell never echoes the raw fulfillment enum — `:187-193` — **no**
34. IP cell country/region grain only — never city/coords/ISP/raw IP — `:198-213` — **no**
35. Fraud-screening cell exposes Shopify's ACCEPT verdict + positive signals to the issuer — `:216-248` — **no**
36. Default cell "Confirmed" for categories without a branch — `no_return_initiated` prints as the meaningless word "Confirmed" today — `:249-251` — **no**
37. First-char capitalisation at the boundary — `:261-264,301` — **no**

## Layer 4 — Chronology (bypasses the composed-document validator)
38. `CHRONO_ALLOW` — 7-category allow-list over free-text events — `chronology.ts:128-194` — **no**
39. Chargeback category scoped to dispute-OPEN verbs; payout-debit lines excluded — `:182-193` — **no**
40. kept/dropped partition; dropped tail logged stderr-only — `:202-225` — **no**
41. Doubled-currency normalisation in bank prose — `:84-90` — **no**
42. All bank timestamps rendered explicit UTC — `:246-257` — **no**
43. Rich Shopify timeline preferred over synthetic — `:259-296` — **no**
44. **Synthetic fallback MANUFACTURES bank-facing assertions** ("Authorisation captured against the cardholder's {network} ending in {last4}") outside claim guards and phrase checks — `:298-330` — **no**
45. Chronology section renders if bullets OR LLM text — bullets can appear with no validated prose — `DefencePackageDocument.tsx:432-451` — **no**
46. Line items prefer `orderContext` over the fact; drop incomplete rows — `render/lineItems.ts:39-65` — **no**

## Layer 5 — Thesis templates
47. Template selection (section, family, mode) with fallback ladder — `renderThesis.ts:32-52` — **no**
48. Required-token gate: any unresolved token suppresses the whole thesis — `:111-114` — **no**
49. `[[ … ]]` optional-clause stripping — `:67-78` — **no**
50. Punctuation repair post-strip — `:93-102` — **no**
51. 16 templates fixing each section's opening claim per (family, mode) — `thesisTemplates.ts:28-206` — **no**
52. `gated()` — every token short-circuits on its predicate — `thesisTokens.ts:30-47` — **no**
53. `paymentAuthMethod` claim hierarchy 3DS+shift > 3DS > AVS+CVV > AVS > CVV; **gap:** its gates don't know `isUnciteableThreeDsFact` — `:50-72` — **no**
54. **`priorOrderHistoryClause` writes "undisputed" whenever `priorOrderCount > 0`** — without checking `disputeFreeHistory`; diverges from Evidence Basis (#32) and the strategy prompt — `:74-87` — **no**
55. Per-clause sentence fragments (comms/delivery/digital/refund/policy) — `:89-173` — **no**
56. `reasonCodeContext` never restates the reason as a merchant-held fact — `:175-181` — **no**

## Layer 6 — Narrative writer (LLM)
57. `BASE_SYSTEM_PROMPT` — 13 numbered rules = the primary argument policy as PROSE: internal-id ban (r5); never mention missing evidence (r6); raw AVS/CVV codes forbidden, quote `verificationSummary` (:105-115); overclaim/accusation blacklist (r8); absolute-authorization ban (r8a); physical-card ban for CNP (r8b); 11 forbidden fulfilment words + raw-enum ban + empty-section instruction (r8c); narrower-not-filled (r9); packageMode tone (r10) — `narrativeWriter.ts:80-224` — **no**
58. `PROMPT_VERSION` drives cache invalidation + the regenerate signal (and leaks via #21) — `:69` — **no**
59. System-block precedence: base → family overlay → payment overlay → module → strategies — `:302-343` — **no**
60. **LLM payload fact filter `!f.submissionRisk || f.includeInBankNarrative`** — WEAKER than the Evidence-Basis filter; admits `bankEligible:false` facts (incl. unciteable 3DS) — `:456-466` — **partial**
61. `alwaysAdmissibleCategories` widens the module's advisory allow-list for 3 fact shapes — `:470-480` + `alwaysAdmissible.ts:52-104` — **no**
62. `prioritize/avoid/mustNotClaim/critical/allowed` shipped as guidance only — no validator enforces them — `:488-497` — **no**
63. Manual evidence to the LLM only when `includeInPackage`, with self-gate flags — `:505-514` — **partial**
64. `internalOnlyFactIds` + `missingEvidence` handed to the model as negative context — `:515-519` — **no**
65. Validator-feedback retry guidance injection — `:286-293` — **no**
66. One JSON-parse retry; API errors no retry — `:353-427` — **no**
67. **Per-shop daily cap: on cap, the dispute gets NO bank document at all** — `:266-278,625-649` — **no**
68. `applySectionSuppression` — structural enforcement of strategy `suppressesSections` — `:539-572` — **no**
69. Malformed JSON → no narrative (fail closed); bad `usedFactIds` entries silently dropped — `:574-623` — **no**

## Layer 7 — Validation
70. 21 global forbidden regexes (overclaim, accusation, raw codes, `UNFULFILLED` case-sensitive) — `validateNarrative.ts:36-78` — **no**
71. Narrow-mode-only aggressive-phrase list — `:80-84,188-201` — **no**
72. Family `prohibitedBankPhrases` + BNPL card-construct bans as hard rejections — `:159-171` — **no**
73. Family `guardedBankPhrases` — rejected only when the gating predicate fails — `:173-187` — **no**
74. `usedFactIds` referential integrity + internal-id citation rejection — `:246-269` — **no**
75. `omittedSections` bidirectional consistency — `:271-292` — **no**
76. `validateComposedDocument` covers every BLOCK sub-text — **gap: chronology bullets, Evidence Basis cells, Case Details values, Supporting Evidence Index are NOT blocks and never validated** — `:316-356` — **no**
77. 13 claim guards, each with its own `appliesToSections` — the same claim allowed in one section, guarded in another — `claimGuards.ts:54-180` — **no**
78. 26 named predicates — the shared authority for guards, strategy gates, thesis tokens (e.g. `delivery_confirmed` excludes `delivered_unverified`; `credit_covers_disputed_amount` gates "in full") — `factPredicates.ts:90-338` — **no**
79. Validation failure → exactly ONE retry; retry output replaces the first regardless — `buildDefencePackageJob.ts:306-388` — **no**
80. Failed validation → no PDF, no submission; `failure_reason` routes the operator — `:390-422,469-502` — **no**

## Layer 8 — Reason modules
81. code → module resolution; DB row can override prompt/lists AND the model — `reasonCodes/registry.ts:38-84` — **no**
82. BNPL path: no network code → route on Shopify enum (5 mapped) — `:96-141` — **no**
83. Family resolution incl. `unmodeledCodes`, collisions throw, unknown → fallback — `familyRegistry.ts:60-143` — **no**
84. `visa_10_4_fraud` — critical `[payment_authentication, billing_match]`; avoid `[device_session, policies]`; allowed 14 incl. re-admitted `fraud_screening`+`ip_location`; prompt: cite screening as ≥2 named signals never score, IP country/region only, omit policyArgument with stated reason, never cite fulfillmentStatus — **no**
85. `inr_product_not_received` — critical `[delivery_proof]`; avoid `[ip, device, fraud_screening]`; tracking-without-delivery framing rule — **no**
86. `product_unacceptable` — critical `[order_record]`; **allowed list omits `payment_authentication`** (the #352552 suppression) — **no**
87. `credit_not_processed` — critical `[refund_record]`; the only module listing `no_return_initiated` — **no**
88. `duplicate_processing` — critical `[order_record]` — **no**
89. `canceled_recurring` — critical `[subscription_terms, policy_cancellation]` — `subscription_terms` unreachable ⇒ near-always `narrow` — **no**
90. `generic_fallback` — widest allowed (20); hedged framing mandated — **no**
91. Family `unauthorized_fraud` — the only non-empty overlay + prohibited phrases (`card absent`, `friendly fraud`…) + guarded phrases (`online transaction` needs `transaction_channel_online_present`) — **no**

## Layer 9 — Strategies
92. Declaration order IS bundle order; `credit_already_issued` registered first in all nine families — `strategies/registry.ts:63-105` — **no**
93. `gatePass` all/any/none predicate sets; fallback bypasses — `:121-131` — **no**
94. `rankStrategies`: canonical order, cap 3 (one reserved for fallback), **`exclusive:true` replaces the whole bundle** — `:136-185` — **no**
95. `credit_already_issued`: cross-family, exclusive, `suppressesSections:[paymentAuthenticationArgument]`, "in full" only when covered, never speculate why refunded — **no**
96. 24 per-strategy prompt rules (auth-stack hedging; repeat-customer TRI-STATE wording — `true`→"undisputed", `null`→count only, `false`→don't cite; delivery never-to-address without verified; listing-as-published not quality; post-chargeback refund "subsequently processed"; etc.) — **no**

## Layer 10 — Fact classifier
97. `SUBMISSION_RISK_FIELDS` = {device_session}; screening/IP removed with dated rationale — `factClassifier.ts:95-120` — **partial**
98. `INTERNAL_ONLY_FIELDS` = {device_session} — never reaches LLM — `:154-169` — **yes**
99. `isUnciteableThreeDsFact` — **gap: clears flags but the fact still lands in `approved` → reaches LLM payload (#60), satisfies `three_d_secure_present` (#77), resolves thesis `paymentAuthMethod` (#53); only Evidence Basis suppresses it** — `:140-149` — **yes** (predicate shared) / **no** (containment)
100. `isFieldBankEligible` = not-internal ∧ grade ∈ {strong,moderate} — `:182-189` — **partial**
101. `categoryForField` — the category every allow-list/token/predicate keys off; `activity_log`→`service_access` iff `digitalAccessUsed` — `:191-237` — **yes**
102. **`verificationSummary` synthesis** — the plain-language substitute the prompt and PDF must quote (Y/X street+code, A street, Z/W postal, M CVV) — `:278-313` — **no**
103. 3DS extraction carries eci/dsTxn/version/flow/exemption — `:314-336` — **partial**
104. Delivery extraction reaches into `fulfillments[].tracking[]`; `firstTrackingEntry` picks WHICH parcel the defence cites — `:339-368,252-269` — **partial**
105. `effectivePriorOrders` excludes the disputed order; `disputeFreeHistory` tri-state — `:375-396` — **partial**
106. `refund_record` carries `precededDispute`/`coversDisputedAmount` strict === true — `:416-441` — **partial**
107. `no_return_initiated` synthesized as a positive assertion — `:442-449` — **partial**
108. Fraud-screening passes ≤5 positive phrases + level + recommendation — `:450-479` — **partial**
109. IP payload reduced to `locationMatch` — everything else dropped AT THIS BOUNDARY — `:480-483` — **no**
110. `order_confirmation` surfaces `fulfillmentStatus` (guards only) + `channel` — `:489-505` — **partial**
111. `FIELD_LABEL_EN` — the literal English the issuer reads — `:525-550` — **partial**
112. `derivePackageMode` (weak/insufficient→narrow ∥ fatal ∥ <2 categories ∥ missing critical) — `:554-576` — **no**
113. Coverage short-circuit → no bank document — `:580-594` — **partial**
114. Per-fact flags + routing out of `approved` — `:642-673` — **partial**
115. `invalid` grade drops the field BEFORE a fact exists (the #352552 mechanism) — `:614-618` — **yes** (fixed in model)
116. Missing rows built from checklist, `bankVisible:false` — `:677-685` — **partial**
117. Manual rows default `bankEligible:false` when DB null — `:688-704` — **partial**
118. **Manual promotion mints `strength:"supporting" ∧ bankEligible:true`** — a combination the eligibility rule can never produce; enters LLM, skips Evidence Basis when narrative-flag false — `:709-731` — **no**
119. No-bank-eligible-facts short-circuit → package skipped — `:734-747` — **no**

## Layer 11 — Payment-method overlays
120. Overlay applicability (family, Klarna sub-product) — `paymentOverlays.ts:97-120` — **no**
121. `BNPL_PROHIBITED_CARD_PHRASES` — 16 hard-rejected card constructs incl. CE 3.0, liability shift — `:34-51` — **no**
122. Neutral BNPL overlay: delivery-first/refund-first framing, no provider-adjudication claims — `:59-82` — **no**
123-125. Klarna category mapping + per-category evidence demands (GNR needs true POD; unauthorized forbids card constructs) + sub-product naming — `klarnaOverlay.ts:46-153` — **no**

## Layer 12 — Gates
126. Fatal loss: refund≥amount (unless credit preceded or inquiry) ∥ INR+UNFULFILLED+0 fulfillments — `fatalLoss.ts:102-158` — **no**
127. Fatal-loss reason is merchant-only; bank-side effect is only `narrow` mode — `:58-65` — **no**
128. `evaluateAutoSubmitGuards` — coverage → fatal → credit-in-full proceeds → moderate parks → weak blocks — `autoSubmitGuards.ts:106-160` — **no**
129. Defence job re-resolves mode + re-applies guards, demotes to draft — `buildDefencePackageJob.ts:611-683` — **no**
130. **Name-mismatch merchant-only rule enforced only by absence of consumers**; residual exposure: PDF "Cardholder name" row falls back to the ORDER customer name (`caseDetails.ts:127`; job `:532-533`), and the mutation sends the order name as customer first/last (#2) — `nameMismatch.ts` — **no**
131. `MERCHANT_UI_HIDDEN_FIELDS` — merchant/bank asymmetry as policy — `merchantUiHiddenFields.ts:33-64` — **partial**

## Layer 13 — Merchant mirror claiming to mirror bank decisions
132. `isNegativeOrAmbiguous` — the ONLY family-gated payload predicate anywhere; no classifier equivalent — `evidenceLineItem.ts:861-935` — **no**
133. `resolveSubmissionMethod` ladder; force_include never self-elevates to bank — `:985-1094` — **partial**
134. Internal field with no payload → `not_included` (don't claim we hid what we never had) — `:1022-1026` — **no**
135. `bank_argument` can assert bank status from the categorizer alone BEFORE any classifier run — `:1056-1065` — **no**
136. Mirrored flags with `?? bankEligibleField` fallback substituting field eligibility for fact truth — `:1447-1455` — **no**
137. Multi-fact OR-merge per field — `:945-962` — **no**
138. Fourth delivery collapse — `:1119-1140,1287+` — **yes** (`collapsesWith`)
139. Payload-aware bank-facing reason copy for IP/AVS — `:440-460` — **no**

## Layer 14 — Collector-level gates
140. `categorizeEvidenceField` — THE grading authority; per-field bank-exposure decisions in disguise — `canonicalEvidence.ts:410-620` — **yes** (R2)
141. ipinfo `computeBankEligible` (match ∧ no VPN/proxy/hosting ∧ consistency) — `deviceLocationSource.ts:112-121` — **yes**
142. Positive IP paragraph deliberately vague — `:191-209` — **no**
143. Fraud screening emits bank path only on shopify ∧ LOW/NONE ∧ ACCEPT/NONE ∧ ≥1 positive; ≤3 cited — `fraudRiskSource.ts:180-231` — **yes**
144. Negative verdicts emitted un-gradeable (merchant sees why; bank never does) — `:248-268` — **partial**
145. **Gorgias `BANK_EXCLUDED_EVIDENCE_CATEGORIES`** — refund/cancellation history can NEVER enter a bank pack even merchant-approved; `resolution_attempt` deliberately not blocked — `gorgiasCommSource.ts:196-220` — **no**
146. `derivesCustomerConfirmsOrder` — the flag that upgrades comms to strong; requires category+confidence+approval — `:223-234` — **no**
147. Collectors fix the `proofType` vocabulary + chronology line wording `CHRONO_ALLOW` depends on — **partial**
148. Policy text deliberately not exposed raw — `policySource.ts` — **no**
149. Name-mismatch verdict computed and persisted merchant-only — `buildPack.ts:793-800` — **no**

## Layer 15 — The parallel pipeline (Visa CE 3.0)
**Verdict: a second, dormant bank pipeline. Qualification RUNS in prod; the package/router have
NO caller. Zero shared classification with the defence pipeline.**
150. Triggered non-fatally during pack build — `buildPack.ts:388-405` — **no**
151. Gates: disputed order + LSE-0 code — `evaluateQualification.ts:62-78` — **no**
152. Prefers LSE-4 pixel session IP/device over order fields — `:96-108` — **no**
153. Priors only for Visa + customer; subscription 2-year branch — `:110-161` — **no**
154. **A SECOND 3DS reader** from receiptJson, not consulting `threeDSecureSource`/`isUnciteableThreeDsFact` — `:294-331` — **no**
155. verdict/branch/matchPoints/confidence persisted to `dispute_qualifications` — `:163-196` — **no**
156. Branch selection + priors cap 2 — `packageTemplates.ts:88-143` — **no**
157. CE3.0 headline prose passes NO phrase/claim validation — `:147-185` — **no**
158. Transaction rows carry **raw IP, full shipping address, account id/email** — direct conflict with #34/#109 — `:187-213` — **no**
159. Raw-IP column rendered — `CE30PackDocument.tsx:165-207` — **no**
160. Cover hard-codes "Reason Code 10.4" — `:72` — **no**
161. First-person merchant attestation with no predicate gate — `packageTemplates.ts:247-263` — **no**
162. `submissionRouter.activateSubmissionChannels` — would route channels; not invoked anywhere — `submissionRouter.ts:53-80` — **no**

## Layer 16 — The model's own bank decisions (baseline)
163. `CITATION_POLICY` never/conditional/when_valid — `definitions.ts:73-78`
164. `citationFor` → eligible/ineligible/withheld_internal/withheld_risk — `derive.ts:121-164`
165. `selectForBank`: `eligibility==="eligible" ∧ quality≠null`, sibling collapse, **no payload by design** — `projections.ts:140-161`
166. Relevance from templates only; may never decide existence (R3) — `definitions.ts:118-141`

## The twenty decision layers with no canonical representation

argument topicality · reason-code routing/family resolution · strategy selection (incl.
exclusive/suppression) · package mode · claim guards as a permission system · redaction &
synthesis transforms · prompt-as-policy · phrase-level prohibition (5 independent lists) ·
section composition/visibility · thesis templating · chronology admissibility + synthetic
generation · Evidence-Basis presentation · manual-evidence promotion/disclosure · CE 3.0
qualification+package · submission-artifact contract · automation/submission gating (incl. the
daily LLM cap silently yielding no document) · merchant/bank asymmetry policy ·
self-incrimination content classes · failure/retry semantics · **cross-layer agreement itself
(four disagreeing bank-inclusion predicates)**.

## The ten live contradictions (D2.3 of the plan; containment status in `p0/containment-proposals.md`)

1. Four bank-inclusion predicates disagree; unciteable 3DS reaches LLM/guards/thesis, suppressed only in the PDF table.
2. Thesis token writes "undisputed" unchecked (16 live packages carry unverified prior-history facts).
3. `no_return_initiated` prints to the issuer as "Confirmed", sorted last.
4. PDF footer leaks packageMode + prompt version.
5. "Cardholder name" row mislabeled under fallback sourcing.
6. Synthetic chronology assertions bypass all validators.
7. Manual promotion mints an impossible flag combination.
8. Dormant CE3.0 package violates redaction rules and hard-codes its reason code.
9. `canceled_recurring` forced narrow by an unreachable critical category.
10. Prior-chargebacks disclosure branch — dead today, live if grading changes.
