# Claude Design brief — Historical Intelligence admin surface (`/admin/intelligence`)

Paste this whole file into Claude Design. It contains the purpose, audience, the exact data every screen must show (TypeScript contracts), every interaction, the API surface, and the non-negotiable pedagogic rules. The current React page is a **functional reference only — redesign it entirely.**

---

## 1. What this is
An **internal admin analytics surface** for DisputeDesk (a Shopify chargeback-evidence app). It presents a *Historical Dispute Intelligence* analysis for one merchant at a time: data-quality audit, descriptive dispute/loss report, opportunity recommendations, a policy "what-if" simulator, model-feasibility + a response-win model, and an exportable report.

- **Audience:** internal DisputeDesk operators (not merchants). High data literacy, but the UI must still *teach how to read the numbers*.
- **Stack it renders into:** Next.js + **Tailwind + lucide-react**, light theme to match the rest of `/admin` (page bg `#F8FAFC`, cards white, borders `#E2E8F0`, text `#0F172A`/`#64748B`). **Not Polaris.**
- **Tone:** trustworthy, calm, evidence-first. This is decision **support**, never automation.

## 2. Pedagogic non-negotiables (this is the hard part — design *for* these)
1. **It never acts on a dispute.** No control implies auto-submitting, skipping, or declining a dispute. Actions are: run analysis, read, explain, record a human decision, simulate, export.
2. **Every rate shows its numerator/denominator, 95% CI, method, and confidence.** Binary rates use **Wilson** intervals; monetary quantities use **bootstrap**. The method matters and should be legible (a small label/tooltip), because mixing them is a known error we explicitly avoid.
3. **Evidence grade is a first-class visual.** Three grades, increasing rigor: `descriptive` → `adjusted_observational` → `prospectively_validated`. They must be instantly distinguishable and explained in-context.
4. **Confidence is per-finding:** `insufficient` / `low` / `moderate` / `high`. Not a single global score.
5. **Limitations are always visible, never hidden behind a click by default.** Especially: the model's selection-bias caveat, and the "risk-based prevention NOT supported (leakage)" state.
6. **The negative/empty states are the COMMON case and must feel intentional, not broken.** With small merchants there are often **few or zero** opportunities and **no model built**. Design "nothing passed the sample gates" and "modeling unsupported" as confident, well-reasoned outcomes — not errors.
7. **Honest about uncertainty > lots of insights.** Prefer a few trustworthy, well-caveated conclusions.

## 3. Information architecture (proposed — improve it)
One merchant selected at top. Then, for a selected analysis run:
- **Overview** — coverage window, headline losses/recoveries, the single most important caveat (e.g. risk leakage), count of opportunities.
- **Data quality** — per-input-area reliability + global limitations. This gates everything and should be prominent, not buried.
- **Baseline report** — portfolio totals + the four rates with intervals.
- **Opportunities** — recommendation cards (the merchant-actionable output).
- **Policy simulator** — interactive what-if with scenario ranges.
- **Model** — feasibility verdicts + (if built) the response-win model with backtest + calibration.
- **Methodology / export** — how it was computed; download the report.

## 4. Exact data contracts (what each screen renders)

### 4.1 A run (list + selection)
```ts
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type RunStage = "pending" | "auditing" | "preparing" | "reporting" | "recommending" | "complete";
interface AnalysisRun {
  id: string; shop_id: string; status: RunStatus; stage: RunStage;
  created_at: string; completed_at: string | null;
  feature_registry_version: string; classification_version: string; methodology_version: string;
  errors: string[];
}
```
A run streams through stages; while `running`, the UI polls. Show progress meaningfully (auditing → reporting → recommending → complete).

### 4.2 Data-quality report
```ts
type DataAreaStatus = "reliable" | "usable_with_limitations" | "insufficient" | "unknown";
interface DataQualityReport {
  facts: {
    orders: { count: number; coverage_start: string|null; max_processed_at: string|null; distinct_currencies: number; by_year: Record<string,number>;
      pct_null_risk_initial: number|null; pct_null_country: number|null; pct_null_payment_gateway: number|null; pct_null_delivery_status: number|null; };
    leakage: { median_ingest_lag_hours: number|null; pct_ingested_within_48h: number|null; };
    disputes: { count: number; count_adjudicated: number; count_submitted: number; count_with_outcome_amount: number;
      pct_orphan_no_order: number|null; pct_null_phase: number|null; pct_null_final_outcome: number|null; pct_network_code_direct_or_derived: number|null; by_year: Record<string,number>; };
    evidence: { pack_count: number; item_count: number; };
  };
  areas: { area: string; status: DataAreaStatus; reason: string; notes?: string[] }[];
  riskPreventionSupported: boolean;   // false is the norm — design a strong "leakage" callout
  globalLimitations: string[];
}
```

### 4.3 Baseline report
```ts
interface RateMetric { name: string; numerator: number; denominator: number;
  point: number; lower: number; upper: number; method: "wilson"; confidence: string;
  excluded?: { reason: string; count: number }[]; }
interface BootstrapMetric { name: string; point: number; lower: number; upper: number; method: "bootstrap"; sampleSize: number; confidence: string; }
interface BaselineReport {
  currency: string; otherCurrencyDisputeCount: number; period: { from: string|null; to: string|null };
  portfolio: { totalDisputes: number;
    totalDisputedAmount: { amountMinor: string; currency: string };  // amountMinor is a decimal STRING (e.g. "12345.67")
    totalRecovered: { amountMinor: string; currency: string };
    totalNetLoss: { amountMinor: string; currency: string };
    adjudicatedCount: number; respondedCount: number; disputesWithAmount: number; disputesByYear: Record<string,number>; };
  rates: { fullWinRate: RateMetric; anyRecoveryRate: RateMetric; rawResponseRate: RateMetric; actionableResponseRate: RateMetric };
  monetary: { monetaryRecoveryRate: BootstrapMetric; avgRecoveryPerResponse: BootstrapMetric };
  limitations: string[];
}
```
Design note: `fullWinRate` and `anyRecoveryRate` are DISTINCT metrics (full win vs any recovery). `disputesByYear` is a natural small trend chart. Money is a decimal string + currency code — never a float.

### 4.4 Recommendation (opportunity card)
```ts
interface Recommendation {
  id: string;
  category: "prevention" | "response" | "automation" | "economic_non_response";
  title: string; summary: string; suggested_action: string;
  affected_dispute_count: number; affected_order_count: number;
  affected_disputed_minor: string|null; currency: string|null;
  baseline_metric: { name: string; value: number; numerator?: number; denominator?: number };
  estimate_lower_minor: string|null; estimate_point_minor: string|null; estimate_upper_minor: string|null;  // a MONEY RANGE
  estimate_period: "historical_total" | "annualized" | null;
  evidence_grade: "descriptive" | "adjusted_observational" | "prospectively_validated";
  confidence: "insufficient" | "low" | "moderate" | "high";
  implementation_effort: "low"|"medium"|"high"|null;
  customer_friction_risk: "low"|"medium"|"high"|null;
  limitations: string[]; assumptions: string[];
  explanation?: string|null;   // optional LLM-generated plain-English prose (see interactions)
}
```
A card must show: title, category, evidence grade, confidence, the why (summary), the action, a **financial estimate as a range** (lower→point→upper), affected counts, effort, friction, and limitations. Plus per-card actions (§5).

### 4.5 Policy simulation result
```ts
interface SimulationResult {
  template: string; currency: string;
  ordersAffected: number; disputesInSegment: number;
  revenueAffected: string; disputedValueInSegment: string; netLossInSegment: string;
  legitimateOrdersAffected: number;   // friction exposure — orders in segment with NO dispute
  reviewWorkload: number; implementationCost: string;
  avoidedLoss:  { conservative: string; expected: string; optimistic: string };  // a 3-point RANGE
  netImpact:    { conservative: string; expected: string; optimistic: string };
  confidence: string; evidenceGrade: string; assumptions: string[]; limitations: string[];
}
```
Inputs the user adjusts: a template, min order value, expected-effectiveness %, per-order cost, currency. Output emphasizes the **avoided-loss RANGE** and net impact — always a range, always labeled an estimate, never a promise.

### 4.6 Model feasibility + response-win model
```ts
interface Feasibility {
  anyModelBuilt: boolean; summary: string;
  verdicts: { model: "prevention"|"response_win_pooled"|"response_win_by_category";
    feasible: boolean; reason: string; eligibleFeatures: string[]; gateFailures: string[] }[];
}
interface ModelReport {   // present ONLY when the response model was feasible
  featureSet: string[]; evidenceGrade: "adjusted_observational"; confidence: string;
  targetPopulation: string;   // e.g. "P(win | historically contested & adjudicated) — NOT an unbiased win probability."
  overall: { testN: number; brier: number; baseRate: number; meanPredicted: number };
  folds: { trainThroughYear: string; testYear: string; trainN: number; testN: number; brier: number; observedWinRate: number; meanPredicted: number }[];
  calibration: { bucket: string; n: number; meanPredicted: number; observedWinRate: number }[];
  limitations: string[];
}
```
Design note: **feasibility "not built" is the usual outcome and must look deliberate.** When a model IS built, the `targetPopulation` selection-bias warning must be unmissable, and calibration (predicted vs observed per bucket) is a natural reliability chart.

## 5. Interactions (every user action)
- **Select a client** (by name/domain — resolves to an internal id). *(We are handling the picker separately; leave a slot for "client selector".)*
- **Run analysis** for the selected client → creates a run; UI polls until complete. Guard against duplicate active runs.
- **Browse past runs** and open one.
- **Explain a recommendation** → calls an LLM that turns the *validated* recommendation into plain-English prose. It never recalculates or changes any number; it only explains. Show the prose inline; it can be regenerated/stored.
- **Record a decision** on a recommendation → `accepted` / `rejected` / `marked_later` (also `modified`/`activated`/`overridden` exist). This only *logs* the human decision (for later validation) — it does not act.
- **Run a simulation** with adjustable inputs → shows a `SimulationResult`.
- **Export** the run as a self-contained report (markdown download).

## 6. API surface (contracts the design binds to)
```
GET  /api/admin/intelligence/runs?shop_id=<uuid>              -> { runs: AnalysisRun[] }
POST /api/admin/intelligence/runs        { shopId }           -> { runId } | 409 { duplicate:true, message }
GET  /api/admin/intelligence/runs/:id                         -> { run: AnalysisRun & {data_quality, baseline, feasibility, model_report}, recommendations: Recommendation[] }
GET  /api/admin/intelligence/runs/:id/export                  -> text/markdown (download)
GET  /api/admin/intelligence/simulate                         -> { templates: {key,label,description}[] }
POST /api/admin/intelligence/simulate    { shopId, input }    -> { result: SimulationResult }
POST /api/admin/intelligence/explain     { recommendationId } -> { prose, model }
POST /api/admin/intelligence/decision    { recommendationId, action, reason? } -> { ok:true }
```

## 7. Visual system guidance (not prescriptive — do better)
- Light admin theme; cards, generous whitespace, strong typographic hierarchy so dense stats stay scannable.
- Consistent semantic encoding for the four recurring scales, used everywhere: **data-area status**, **evidence grade**, **confidence**, and **risk/friction level**. Pick one legible color+shape language for each and reuse it (a legend the user learns once).
- Numbers-with-intervals need a repeatable component (point estimate + CI + n + method) — this appears dozens of times; it is the core "molecule."
- Money is always `currency + decimal string`; render right-aligned, monospace-tabular where listed.
- Ranges (estimates, avoided loss, net impact) need a clear conservative→expected→optimistic visual.
- Design the empty/negative states as first-class: "no opportunities cleared the gates," "modeling unsupported for this merchant," "risk-based prevention not supported (data leakage)."

## 8. What to deliver
A redesigned `/admin/intelligence` covering the IA in §3, binding to the contracts in §4/§6, honoring the pedagogic rules in §2. Include: the run/overview screen, data-quality view, baseline report, opportunity cards (with explain + decision + limitations), the policy simulator, and the model/feasibility view. Provide the reusable molecules (stat-with-interval, evidence-grade badge, confidence badge, money, range, status pill) as a small system.
