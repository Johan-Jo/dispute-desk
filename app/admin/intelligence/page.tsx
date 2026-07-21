"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Play, RefreshCw, AlertTriangle, CheckCircle2, Clock, FlaskConical } from "lucide-react";

/* Phase A shell (design §10): trigger an analysis run for a shop, list runs,
   and render the Data-Quality report. Recommendations / Policy Simulator land
   in later phases. Internal admin only. */

type AreaStatus = "reliable" | "usable_with_limitations" | "insufficient" | "unknown";

interface DataArea {
  area: string;
  status: AreaStatus;
  reason: string;
  notes?: string[];
}

interface DataQuality {
  facts: {
    orders: { count: number; coverage_start: string | null; max_processed_at: string | null; distinct_currencies: number; by_year: Record<string, number> };
    leakage: { median_ingest_lag_hours: number | null; pct_ingested_within_48h: number | null };
    disputes: { count: number; count_adjudicated: number; count_submitted: number; count_with_outcome_amount: number };
  };
  areas: DataArea[];
  riskPreventionSupported: boolean;
  globalLimitations: string[];
}

interface RateMetric { name: string; numerator: number; denominator: number; point: number; lower: number; upper: number; confidence: string; }
interface Baseline {
  currency: string;
  period: { from: string | null; to: string | null };
  portfolio: {
    totalDisputes: number;
    totalDisputedAmount: { amountMinor: string; currency: string };
    totalRecovered: { amountMinor: string; currency: string };
    totalNetLoss: { amountMinor: string; currency: string };
    adjudicatedCount: number; respondedCount: number; disputesWithAmount: number;
  };
  rates: { fullWinRate: RateMetric; anyRecoveryRate: RateMetric; rawResponseRate: RateMetric; actionableResponseRate: RateMetric };
  limitations: string[];
}
interface Recommendation {
  id: string; category: string; title: string; summary: string; suggested_action: string;
  affected_dispute_count: number; affected_disputed_minor: string | null; currency: string | null;
  estimate_lower_minor: string | null; estimate_point_minor: string | null; estimate_upper_minor: string | null;
  evidence_grade: string; confidence: string; implementation_effort: string | null; customer_friction_risk: string | null;
  limitations: string[]; explanation?: string | null;
}
interface Run {
  id: string;
  shop_id: string;
  status: string;
  stage: string;
  created_at: string;
  completed_at: string | null;
  data_quality: DataQuality | null;
  baseline: Baseline | null;
  feasibility: Feasibility | null;
  model_report: ModelReport | null;
  errors: string[];
}

interface ModelVerdict { model: string; feasible: boolean; reason: string; eligibleFeatures: string[]; gateFailures: string[]; }
interface Feasibility { anyModelBuilt: boolean; summary: string; verdicts: ModelVerdict[]; }
interface ModelReport {
  featureSet: string[]; evidenceGrade: string; confidence: string; targetPopulation: string;
  overall: { testN: number; brier: number; baseRate: number; meanPredicted: number };
  folds: { trainThroughYear: string; testYear: string; trainN: number; testN: number; brier: number; observedWinRate: number; meanPredicted: number }[];
  calibration: { bucket: string; n: number; meanPredicted: number; observedWinRate: number }[];
  limitations: string[];
}

const STATUS_STYLE: Record<AreaStatus, string> = {
  reliable: "bg-emerald-50 text-emerald-700 border-emerald-200",
  usable_with_limitations: "bg-amber-50 text-amber-700 border-amber-200",
  insufficient: "bg-red-50 text-red-700 border-red-200",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function IntelligencePage() {
  const [shopId, setShopId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadRuns = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/intelligence/runs?shop_id=${encodeURIComponent(sid)}`);
      if (!r.ok) throw new Error((await r.json()).error || "Failed to load runs");
      setRuns((await r.json()).runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerRun = async () => {
    if (!shopId) return;
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/intelligence/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId }),
      });
      const data = await r.json();
      if (r.status === 409) setMsg(data.message || "A run is already active.");
      else if (!r.ok) throw new Error(data.error || "Failed to trigger run");
      else setMsg(`Run ${data.runId} queued — the worker will process it within ~2 minutes.`);
      await loadRuns(shopId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openRun = async (id: string) => {
    const r = await fetch(`/api/admin/intelligence/runs/${id}`);
    if (r.ok) { const d = await r.json(); setSelected(d.run); setRecs(d.recommendations || []); }
  };

  useEffect(() => {
    if (!selected || selected.status === "succeeded" || selected.status === "failed") return;
    const t = setInterval(() => openRun(selected.id), 5000);
    return () => clearInterval(t);
  }, [selected]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
          <Brain className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Historical Intelligence</h1>
          <p className="text-sm text-slate-500">Phase A — data-quality audit &amp; analysis runs (internal).</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <label className="block text-xs font-semibold text-slate-600 mb-1">Shop ID (uuid)</label>
        <div className="flex gap-2">
          <input
            value={shopId}
            onChange={(e) => setShopId(e.target.value.trim())}
            placeholder="shops.id uuid"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
          />
          <button
            onClick={() => loadRuns(shopId)}
            disabled={!shopId || loading}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Load
          </button>
          <button
            onClick={triggerRun}
            disabled={!shopId || loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Play className="w-4 h-4" /> Run audit
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-indigo-700">{msg}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {shopId && <PolicySimulator shopId={shopId} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Runs</h2>
          <div className="space-y-2">
            {runs.length === 0 && <p className="text-sm text-slate-400">No runs yet.</p>}
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => openRun(run.id)}
                className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                  selected?.id === run.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500">{run.id.slice(0, 8)}</span>
                  <StatusBadge status={run.status} />
                </div>
                <div className="text-xs text-slate-400 mt-1">{new Date(run.created_at).toLocaleString()} · {run.stage}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selected ? (
            <p className="text-sm text-slate-400">Select a run to view its data-quality report.</p>
          ) : selected.status === "failed" ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Run failed</div>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{(selected.errors || []).join("\n")}</pre>
            </div>
          ) : !selected.data_quality ? (
            <div className="p-4 rounded-lg border border-slate-200 bg-white text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4 animate-pulse" /> Audit in progress ({selected.stage})… refreshing.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-end">
                <a href={`/api/admin/intelligence/runs/${selected.id}/export`} className="px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Export report (.md)
                </a>
              </div>
              {selected.baseline && <BaselineView b={selected.baseline} />}
              <RecommendationsView recs={recs} />
              {selected.feasibility && <FeasibilityView f={selected.feasibility} />}
              {selected.model_report && <ModelReportView m={selected.model_report} />}
              <DataQualityView dq={selected.data_quality} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    succeeded: "bg-emerald-100 text-emerald-700",
    running: "bg-blue-100 text-blue-700",
    queued: "bg-slate-100 text-slate-600",
    failed: "bg-red-100 text-red-700",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || "bg-slate-100 text-slate-600"}`}>{status}</span>;
}

function DataQualityView({ dq }: { dq: DataQuality }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Orders" value={dq.facts.orders.count.toLocaleString()} />
        <Stat label="Disputes" value={dq.facts.disputes.count.toLocaleString()} />
        <Stat label="Adjudicated" value={dq.facts.disputes.count_adjudicated.toLocaleString()} />
        <Stat label="Currencies" value={String(dq.facts.orders.distinct_currencies)} />
      </div>

      <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${dq.riskPreventionSupported ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
        {dq.riskPreventionSupported ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        Risk-based prevention {dq.riskPreventionSupported ? "supported (provenance still needs confirmation)" : "NOT supported — retrospective/leakage"}
        <span className="ml-auto text-xs opacity-70">median ingest lag {dq.facts.leakage.median_ingest_lag_hours ?? "?"}h</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Input-area assessment</h3>
        <div className="space-y-2">
          {dq.areas.map((a) => (
            <div key={a.area} className={`p-3 rounded-lg border text-sm ${STATUS_STYLE[a.status]}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.area}</span>
                <span className="text-xs font-semibold uppercase tracking-wide">{a.status.replace(/_/g, " ")}</span>
              </div>
              <p className="text-xs mt-1 opacity-90">{a.reason}</p>
              {a.notes?.map((n, i) => <p key={i} className="text-xs mt-1 opacity-70">• {n}</p>)}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Global limitations</h3>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          {dq.globalLimitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>
    </div>
  );
}

interface SimResult {
  template: string; currency: string; ordersAffected: number; disputesInSegment: number;
  revenueAffected: string; netLossInSegment: string; legitimateOrdersAffected: number;
  implementationCost: string;
  avoidedLoss: { conservative: string; expected: string; optimistic: string };
  netImpact: { conservative: string; expected: string; optimistic: string };
  confidence: string; evidenceGrade: string; assumptions: string[]; limitations: string[];
}

function PolicySimulator({ shopId }: { shopId: string }) {
  const [templates, setTemplates] = useState<{ key: string; label: string; description: string }[]>([]);
  const [tpl, setTpl] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [minValue, setMinValue] = useState("150");
  const [expectedPct, setExpectedPct] = useState("35");
  const [perOrderCost, setPerOrderCost] = useState("0.00");
  const [result, setResult] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/intelligence/simulate").then((r) => r.ok ? r.json() : { templates: [] }).then((d) => {
      setTemplates(d.templates || []); if (d.templates?.[0]) setTpl(d.templates[0].key);
    }).catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true); setErr(null);
    const exp = Math.round(parseFloat(expectedPct) * 100) || 3500;
    const input = {
      template: tpl, currency,
      filters: { minValueDecimal: parseFloat(minValue) || null, riskLevels: tpl.includes("high_risk") ? ["HIGH"] : null, crossBorder: tpl.includes("international") ? true : null },
      effectiveness: { conservativeBps: Math.round(exp * 0.4), expectedBps: exp, optimisticBps: Math.round(exp * 1.7) },
      costs: { perOrderCostMinor: Math.round((parseFloat(perOrderCost) || 0) * 100) },
    };
    try {
      const r = await fetch("/api/admin/intelligence/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId, input }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Simulation failed");
      setResult(d.result);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="w-4 h-4 text-purple-600" />
        <h2 className="text-sm font-semibold text-slate-700">Policy Simulator</h2>
        <span className="text-xs text-slate-400">historical what-if · labeled estimate</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        <label className="text-xs text-slate-600 col-span-2 sm:col-span-1">Template
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm">
            {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Min order value
          <input value={minValue} onChange={(e) => setMinValue(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
        </label>
        <label className="text-xs text-slate-600">Expected effect %
          <input value={expectedPct} onChange={(e) => setExpectedPct(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
        </label>
        <label className="text-xs text-slate-600">Cost / order
          <input value={perOrderCost} onChange={(e) => setPerOrderCost(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
        </label>
        <label className="text-xs text-slate-600">Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
        </label>
      </div>
      <button onClick={run} disabled={busy || !tpl} className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
        {busy ? "Simulating…" : "Simulate"}
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {result && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Orders affected" value={result.ordersAffected.toLocaleString()} />
            <Stat label="Disputes in segment" value={String(result.disputesInSegment)} />
            <Stat label="Net loss in segment" value={`${result.currency} ${result.netLossInSegment}`} />
            <Stat label="Legit orders affected" value={result.legitimateOrdersAffected.toLocaleString()} />
          </div>
          <div className="p-3 rounded-lg border border-purple-200 bg-purple-50 text-sm">
            <div className="font-medium text-purple-800">Estimated avoided loss (range)</div>
            <div className="text-purple-700 mt-1">{result.currency} {result.avoidedLoss.conservative} → <b>{result.avoidedLoss.expected}</b> → {result.avoidedLoss.optimistic}</div>
            <div className="text-purple-700 mt-1">Net impact (after {result.currency} {result.implementationCost} cost): {result.currency} {result.netImpact.conservative} → <b>{result.netImpact.expected}</b> → {result.netImpact.optimistic}</div>
            <div className="text-xs text-purple-500 mt-1">confidence: {result.confidence} · {result.evidenceGrade}</div>
          </div>
          <ul className="list-disc pl-5 text-xs text-slate-400 space-y-0.5">
            {result.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ModelReportView({ m }: { m: ModelReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Response-win model (Phase D)</h3>
      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 mb-2">
        <b>Target population:</b> {m.targetPopulation}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <Stat label="Backtest test-N" value={String(m.overall.testN)} />
        <Stat label="Brier" value={m.overall.brier.toFixed(3)} />
        <Stat label="Base win rate" value={pct(m.overall.baseRate)} />
        <Stat label="Confidence" value={m.confidence} />
      </div>
      <div className="p-3 rounded-lg border border-slate-200 bg-white text-xs">
        <div className="font-medium text-slate-600 mb-1">Chronological folds</div>
        {m.folds.map((f, i) => (
          <div key={i} className="flex justify-between py-0.5 border-b border-slate-100 last:border-0">
            <span>train ≤{f.trainThroughYear} → test {f.testYear} (n={f.testN})</span>
            <span className="text-slate-500">Brier {f.brier.toFixed(3)} · obs {pct(f.observedWinRate)} · pred {pct(f.meanPredicted)}</span>
          </div>
        ))}
        <div className="font-medium text-slate-600 mt-2 mb-1">Calibration</div>
        {m.calibration.map((c, i) => (
          <div key={i} className="flex justify-between py-0.5">
            <span>{c.bucket} (n={c.n})</span>
            <span className="text-slate-500">pred {pct(c.meanPredicted)} vs obs {pct(c.observedWinRate)}</span>
          </div>
        ))}
      </div>
      <ul className="list-disc pl-5 mt-2 text-xs text-slate-400 space-y-0.5">
        {m.limitations.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}

function FeasibilityView({ f }: { f: Feasibility }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Model feasibility (Phase D)</h3>
      <div className={`p-3 rounded-lg border text-sm mb-2 ${f.anyModelBuilt ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
        {f.summary}
      </div>
      <div className="space-y-2">
        {f.verdicts.map((v) => (
          <div key={v.model} className="p-3 rounded-lg border border-slate-200 bg-white text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{v.model.replace(/_/g, " ")}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.feasible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{v.feasible ? "feasible" : "not built"}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{v.reason}</p>
            {v.gateFailures.length > 0 && (
              <ul className="list-disc pl-5 mt-1 text-xs text-slate-400 space-y-0.5">
                {v.gateFailures.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function RateRow({ r, label }: { r: RateMetric; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="text-right">
        <span className="text-sm font-semibold text-slate-900">{r.denominator === 0 ? "—" : pct(r.point)}</span>
        {r.denominator > 0 && (
          <span className="text-xs text-slate-400 ml-2">95% CI [{pct(r.lower)}–{pct(r.upper)}] · n={r.numerator}/{r.denominator} · {r.confidence}</span>
        )}
      </div>
    </div>
  );
}

function BaselineView({ b }: { b: Baseline }) {
  const money = (m: { amountMinor: string; currency: string }) => `${m.currency} ${m.amountMinor}`;
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Baseline report</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Stat label="Disputed" value={money(b.portfolio.totalDisputedAmount)} />
        <Stat label="Recovered" value={money(b.portfolio.totalRecovered)} />
        <Stat label="Net loss" value={money(b.portfolio.totalNetLoss)} />
        <Stat label="Adjudicated" value={String(b.portfolio.adjudicatedCount)} />
      </div>
      <div className="p-3 rounded-lg border border-slate-200 bg-white">
        <RateRow label="Full-win rate (Wilson)" r={b.rates.fullWinRate} />
        <RateRow label="Any-recovery rate (Wilson)" r={b.rates.anyRecoveryRate} />
        <RateRow label="Raw response rate" r={b.rates.rawResponseRate} />
        <RateRow label="Actionable response rate" r={b.rates.actionableResponseRate} />
      </div>
      <p className="text-xs text-slate-400 mt-2">Period {b.period.from?.slice(0,10) || "?"} → {b.period.to?.slice(0,10) || "?"} · {b.currency}. Binary rates use Wilson; monetary uses bootstrap. Partial wins are not credited inside a binomial.</p>
    </div>
  );
}

const GRADE_STYLE: Record<string, string> = {
  descriptive: "bg-slate-100 text-slate-600",
  adjusted_observational: "bg-blue-100 text-blue-700",
  prospectively_validated: "bg-emerald-100 text-emerald-700",
};

function RecommendationsView({ recs }: { recs: Recommendation[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Opportunities ({recs.length})</h3>
      {recs.length === 0 && <p className="text-sm text-slate-400">No opportunities passed the sample gates for this run (expected with small N — see limitations).</p>}
      <div className="space-y-3">
        {recs.map((r) => <RecommendationCard key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function RecommendationCard({ r }: { r: Recommendation }) {
  const [explanation, setExplanation] = useState<string | null>(r.explanation ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);

  const explain = async () => {
    setBusy("explain");
    try {
      const res = await fetch("/api/admin/intelligence/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendationId: r.id }) });
      const d = await res.json();
      if (res.ok) setExplanation(d.prose);
    } finally { setBusy(null); }
  };
  const decide = async (action: string) => {
    setBusy(action);
    try {
      await fetch("/api/admin/intelligence/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendationId: r.id, action }) });
      setDecided(action);
    } finally { setBusy(null); }
  };

  return (
    <div className="p-4 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{r.title}</div>
          <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">{r.category.replace(/_/g, " ")}</div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${GRADE_STYLE[r.evidence_grade] || "bg-slate-100 text-slate-600"}`}>{r.evidence_grade.replace(/_/g, " ")}</span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">{r.confidence}</span>
        </div>
      </div>
      <p className="text-sm text-slate-600 mt-2">{r.summary}</p>
      <p className="text-sm text-slate-800 mt-1"><span className="font-medium">Action:</span> {r.suggested_action}</p>
      {(r.estimate_point_minor || r.affected_dispute_count > 0) && (
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500">
          <span>{r.affected_dispute_count} disputes</span>
          {r.estimate_point_minor && r.currency && <span>Est. impact {r.currency} {r.estimate_lower_minor}–{r.estimate_upper_minor} (pt {r.estimate_point_minor})</span>}
          {r.implementation_effort && <span>effort: {r.implementation_effort}</span>}
          {r.customer_friction_risk && <span>friction: {r.customer_friction_risk}</span>}
        </div>
      )}
      {r.limitations?.length > 0 && (
        <ul className="list-disc pl-5 mt-2 text-xs text-slate-400 space-y-0.5">
          {r.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      {explanation && (
        <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 whitespace-pre-wrap">{explanation}</div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={explain} disabled={!!busy} className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {busy === "explain" ? "Explaining…" : "Explain"}
        </button>
        {["accepted", "rejected", "marked_later"].map((a) => (
          <button key={a} onClick={() => decide(a)} disabled={!!busy}
            className={`px-2 py-1 text-xs rounded border disabled:opacity-50 ${decided === a ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {a.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}
