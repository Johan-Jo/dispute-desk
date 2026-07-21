"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Play, RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

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

interface Run {
  id: string;
  shop_id: string;
  status: string;
  stage: string;
  created_at: string;
  completed_at: string | null;
  data_quality: DataQuality | null;
  errors: string[];
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
    if (r.ok) setSelected((await r.json()).run);
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
            <DataQualityView dq={selected.data_quality} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}
