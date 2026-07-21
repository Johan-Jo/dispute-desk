"use client";

/* Historical Dispute Intelligence — internal admin surface.
   Literal transcription of the Claude Design mockup "Historical Intelligence.dc.html".
   Inline styles are reproduced from the design; sample data is replaced with real
   data from /api/admin/intelligence/* and /api/admin/shops. Nothing is auto-submitted;
   every control reads, explains, simulates, exports, or records a human decision. */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/* ───────────────────────── data contracts ───────────────────────── */

type Confidence = "insufficient" | "low" | "moderate" | "high";
type EvidenceGrade = "descriptive" | "adjusted_observational" | "prospectively_validated";
type AreaStatus = "reliable" | "usable_with_limitations" | "insufficient" | "unknown";

interface Money { amountMinor: string; currency: string }

interface DataArea { area: string; status: AreaStatus; reason: string; notes?: string[] }
interface DataQuality {
  facts: {
    orders: {
      count: number; coverage_start: string | null; max_processed_at: string | null;
      distinct_currencies: number; by_year: Record<string, number>;
      pct_null_risk_initial: number; pct_null_country: number;
      pct_null_payment_gateway: number; pct_null_delivery_status: number;
    };
    leakage: { median_ingest_lag_hours: number | null; pct_ingested_within_48h: number | null };
    disputes: {
      count: number; count_adjudicated: number; count_submitted: number;
      count_with_outcome_amount: number; pct_orphan_no_order: number;
      pct_null_phase: number; pct_null_final_outcome: number;
      pct_network_code_direct_or_derived: number; by_year: Record<string, number>;
    };
    evidence: { pack_count: number; item_count: number };
  };
  areas: DataArea[];
  riskPreventionSupported: boolean;
  globalLimitations: string[];
}

interface RateMetric {
  name: string; numerator: number; denominator: number; point: number;
  lower: number; upper: number; method: "wilson"; confidence: Confidence;
  excluded?: { reason: string; count: number }[];
}
interface BootstrapMetric {
  name: string; point: number; lower: number; upper: number;
  method: "bootstrap"; sampleSize: number; confidence: Confidence;
}
interface Baseline {
  currency: string; otherCurrencyDisputeCount: number;
  period: { from: string | null; to: string | null };
  portfolio: {
    totalDisputes: number; totalDisputedAmount: Money; totalRecovered: Money; totalNetLoss: Money;
    adjudicatedCount: number; respondedCount: number; disputesWithAmount: number;
    disputesByYear: Record<string, number>;
  };
  rates: { fullWinRate: RateMetric; anyRecoveryRate: RateMetric; rawResponseRate: RateMetric; actionableResponseRate: RateMetric };
  monetary: { monetaryRecoveryRate: BootstrapMetric; avgRecoveryPerResponse: BootstrapMetric };
  limitations: string[];
}

interface Recommendation {
  id: string; category: string; title: string; summary: string; suggested_action: string;
  affected_dispute_count: number; affected_order_count: number; affected_disputed_minor: string | null;
  currency: string | null;
  baseline_metric: { name: string; value: string; numerator?: number; denominator?: number } | null;
  estimate_lower_minor: string | null; estimate_point_minor: string | null; estimate_upper_minor: string | null;
  estimate_period: string | null;
  evidence_grade: EvidenceGrade; confidence: Confidence;
  implementation_effort: string | null; customer_friction_risk: string | null;
  limitations: string[]; assumptions: string[]; explanation?: string | null;
}

interface ModelVerdict { model: string; feasible: boolean; reason: string; eligibleFeatures: string[]; gateFailures: string[] }
interface Feasibility { anyModelBuilt: boolean; summary: string; verdicts: ModelVerdict[] }
interface ModelReport {
  featureSet: string[]; evidenceGrade: EvidenceGrade; confidence: Confidence; targetPopulation: string;
  overall: { testN: number; brier: number; baseRate: number; meanPredicted: number };
  folds: { trainThroughYear: string; testYear: string; trainN: number; testN: number; brier: number; observedWinRate: number; meanPredicted: number }[];
  calibration: { bucket: string; n: number; meanPredicted: number; observedWinRate: number }[];
  limitations: string[];
}

interface Run {
  id: string; shop_id: string; status: string; stage: string;
  created_at: string; completed_at: string | null;
  feature_registry_version: string | null; classification_version: string | null; methodology_version: string | null;
  data_quality: DataQuality | null; baseline: Baseline | null;
  feasibility: Feasibility | null; model_report: ModelReport | null; errors: string[];
}

interface SimulationResult {
  template: string; currency: string; ordersAffected: number; disputesInSegment: number;
  revenueAffected: string; disputedValueInSegment: string; netLossInSegment: string;
  legitimateOrdersAffected: number; reviewWorkload: number; implementationCost: string;
  avoidedLoss: { conservative: string; expected: string; optimistic: string };
  netImpact: { conservative: string; expected: string; optimistic: string };
  confidence: Confidence; evidenceGrade: EvidenceGrade; assumptions: string[]; limitations: string[];
}

interface ShopRow { id: string; shop_domain: string; [k: string]: unknown }
interface TemplateOpt { key: string; label: string; description: string }

type Section = "overview" | "data" | "baseline" | "opps" | "sim" | "model" | "method";

/* ───────────────────────── formatting helpers ───────────────────────── */

const CUR_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
function fmtMoney(cur: string, val: string | number): string {
  const sym = CUR_SYMBOL[cur] || cur + " ";
  let s = typeof val === "number" ? val.toFixed(2) : String(val ?? "0");
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  const parts = s.split("."); let int = parts[0] || "0"; let dec = parts[1] || "00";
  dec = (dec + "00").slice(0, 2);
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + sym + int + "." + dec;
}
const nfmt = (x: number | string) => Number(x).toLocaleString("en-US");
const p1 = (x: number) => (x * 100).toFixed(1) + "%";
const p0 = (x: number) => Math.round(x * 100) + "%";

/* ───────────────────────── chip system (ported from design) ───────────────────────── */

interface Chip { label: string; pillStyle: CSSProperties; pips: { style: CSSProperties }[] }
type ChipKind = "status" | "risk" | "category" | "confidence" | "grade";

const chipBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 9px",
  borderRadius: "999px", fontSize: "11px", fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap",
};
const P = (bg: string, fg: string, bd: string): CSSProperties => ({ background: bg, color: fg, border: "1px solid " + bd });
const dot = (c: string) => [{ style: { width: "7px", height: "7px", borderRadius: "999px", background: c, flex: "0 0 auto" } as CSSProperties }];
const bars = (k: number, c: string) =>
  [0, 1, 2].map((i) => ({ style: { width: "11px", height: "4px", borderRadius: "2px", background: i < k ? c : "rgba(15,23,42,.13)", flex: "0 0 auto" } as CSSProperties }));

function chip(kind: ChipKind, value: string): Chip {
  if (kind === "status") {
    const M: Record<string, [string, string, string, string, string]> = {
      reliable: ["Reliable", "#DCFCE7", "#166534", "#BBF7D0", "#16A34A"],
      usable_with_limitations: ["Usable · limits", "#FEF3C7", "#92400E", "#FDE68A", "#D97706"],
      insufficient: ["Insufficient", "#FEE2E2", "#991B1B", "#FECACA", "#DC2626"],
      unknown: ["Unknown", "#F1F5F9", "#475569", "#E2E8F0", "#94A3B8"],
    };
    const m = M[value] || M.unknown;
    return { label: m[0], pillStyle: { ...chipBase, ...P(m[1], m[2], m[3]) }, pips: dot(m[4]) };
  }
  if (kind === "risk") {
    const M: Record<string, [string, string, string, string, string]> = {
      low: ["Low", "#DCFCE7", "#166534", "#BBF7D0", "#16A34A"],
      medium: ["Medium", "#FEF3C7", "#92400E", "#FDE68A", "#D97706"],
      high: ["High", "#FEE2E2", "#991B1B", "#FECACA", "#DC2626"],
    };
    const m = M[value] || ["n/a", "#F1F5F9", "#475569", "#E2E8F0", "#94A3B8"];
    return { label: m[0], pillStyle: { ...chipBase, ...P(m[1], m[2], m[3]) }, pips: dot(m[4]) };
  }
  if (kind === "category") {
    const M: Record<string, [string, string, string, string, string]> = {
      prevention: ["Prevention", "#E0F2FE", "#075985", "#BAE6FD", "#0284C7"],
      response: ["Response", "#DBEAFE", "#1E3A8A", "#BFDBFE", "#2563EB"],
      automation: ["Automation", "#EDE9FE", "#5B21B6", "#DDD6FE", "#7C3AED"],
      economic_non_response: ["Economic · don’t respond", "#F1F5F9", "#334155", "#E2E8F0", "#64748B"],
    };
    const m = M[value] || M.response;
    return { label: m[0], pillStyle: { ...chipBase, ...P(m[1], m[2], m[3]) }, pips: dot(m[4]) };
  }
  if (kind === "confidence") {
    const M: Record<string, [string, number, string, string, string, string]> = {
      insufficient: ["Insufficient", 0, "#F1F5F9", "#475569", "#E2E8F0", "#94A3B8"],
      low: ["Low conf.", 1, "#FEF3C7", "#92400E", "#FDE68A", "#D97706"],
      moderate: ["Moderate conf.", 2, "#DBEAFE", "#1E40AF", "#BFDBFE", "#2563EB"],
      high: ["High conf.", 3, "#DCFCE7", "#166534", "#BBF7D0", "#16A34A"],
    };
    const m = M[value] || M.insufficient;
    return { label: m[0], pillStyle: { ...chipBase, ...P(m[2], m[3], m[4]) }, pips: bars(m[1], m[5]) };
  }
  // grade
  const M: Record<string, [string, number, string, string, string, string]> = {
    descriptive: ["Descriptive", 1, "#F1F5F9", "#334155", "#E2E8F0", "#64748B"],
    adjusted_observational: ["Adjusted / observational", 2, "#E0E7FF", "#3730A3", "#C7D2FE", "#4F46E5"],
    prospectively_validated: ["Prospectively validated", 3, "#CCFBF1", "#115E59", "#99F6E4", "#0D9488"],
  };
  const m = M[value] || M.descriptive;
  return { label: m[0], pillStyle: { ...chipBase, ...P(m[2], m[3], m[4]) }, pips: bars(m[1], m[5]) };
}

function methodTag(kind: "wilson" | "bootstrap"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700,
    padding: "2px 8px", borderRadius: "6px", letterSpacing: ".02em", fontFamily: "ui-monospace,Menlo,monospace",
  };
  if (kind === "wilson") return { ...base, background: "#EFF6FF", color: "#1E40AF", border: "1px solid #BFDBFE" };
  return { ...base, background: "#F5F3FF", color: "#5B21B6", border: "1px solid #DDD6FE" };
}

function ChipView({ c }: { c: Chip }) {
  return (
    <span style={c.pillStyle}>
      {c.pips.map((p, i) => <span key={i} style={p.style} />)}
      {c.label}
    </span>
  );
}

/* ───────────────────────── design-system leaf components ───────────────────────── */

const card: CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 2px rgba(15,23,42,.04)" };
const inset: CSSProperties = { background: "#F8FAFC", border: "1px solid #EEF2F7", borderRadius: "10px", padding: "12px 13px" };

function Button({ variant = "secondary", size, onClick, disabled, children, full }: {
  variant?: "primary" | "secondary" | "danger"; size?: "sm"; onClick?: () => void; disabled?: boolean; children: ReactNode; full?: boolean;
}) {
  const palette: Record<string, CSSProperties> = {
    primary: { background: "#1D4ED8", color: "#fff", border: "1px solid #1D4ED8" },
    secondary: { background: "#fff", color: "#334155", border: "1px solid #E2E8F0" },
    danger: { background: "#DC2626", color: "#fff", border: "1px solid #DC2626" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...palette[variant], display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "inherit", fontWeight: 700, borderRadius: "9px", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap",
        padding: size === "sm" ? "0 13px" : "0 16px", height: size === "sm" ? "34px" : "40px",
        fontSize: size === "sm" ? "12.5px" : "13.5px", width: full ? "100%" : "auto",
      }}
    >
      {children}
    </button>
  );
}

function InfoBanner({ variant, title, children }: { variant: "danger" | "info" | "warning"; title: string; children?: ReactNode }) {
  const V: Record<string, { bg: string; bd: string; tt: string; bd2: string }> = {
    danger: { bg: "#FEF2F2", bd: "#FECACA", tt: "#991B1B", bd2: "#7F1D1D" },
    info: { bg: "#EFF6FF", bd: "#BFDBFE", tt: "#1E40AF", bd2: "#1E3A8A" },
    warning: { bg: "#FFFBEB", bd: "#FDE68A", tt: "#92400E", bd2: "#78350F" },
  };
  const v = V[variant];
  return (
    <div style={{ background: v.bg, border: "1px solid " + v.bd, borderRadius: "12px", padding: "14px 16px" }}>
      <div style={{ fontSize: "13.5px", fontWeight: 800, color: v.tt, marginBottom: children ? "4px" : 0 }}>{title}</div>
      {children ? <div style={{ fontSize: "13px", color: v.bd2, lineHeight: 1.55 }}>{children}</div> : null}
    </div>
  );
}

function KPICard({ label, value, footer }: { label: string; value: string; footer: string }) {
  return (
    <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "120px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#94A3B8" }}>{label}</div>
      <div className="mono" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-.02em", margin: "6px 0 4px" }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#64748B" }}>{footer}</div>
    </div>
  );
}

/* ───────────────────────── static content (design legends & method rows) ───────────────────────── */

const LEGEND = [
  { title: "Data-area status", desc: "Reliability of each input area. Insufficient areas are dropped from the finding that needs them.", chips: (["reliable", "usable_with_limitations", "insufficient", "unknown"] as string[]).map((v) => chip("status", v)) },
  { title: "Evidence grade", desc: "Rigor of a finding, increasing left→right. More filled bars = stronger causal footing.", chips: (["descriptive", "adjusted_observational", "prospectively_validated"] as string[]).map((v) => chip("grade", v)) },
  { title: "Confidence", desc: "Per-finding, not a global score. Reflects sample size and interval width for that number.", chips: (["insufficient", "low", "moderate", "high"] as string[]).map((v) => chip("confidence", v)) },
  { title: "Risk / friction", desc: "Effort and customer-friction levels on recommendations.", chips: (["low", "medium", "high"] as string[]).map((v) => chip("risk", v)) },
];

const METHOD_ROWS = [
  { quantity: "Full-win rate", method: "Wilson" as const, note: "Binary proportion (won ÷ adjudicated). Wilson score interval — stable at small n and near 0/1." },
  { quantity: "Any-recovery rate", method: "Wilson" as const, note: "Binary proportion; distinct from full-win — any dollars back counts." },
  { quantity: "Response rates", method: "Wilson" as const, note: "Binary proportions over all vs. eligible disputes." },
  { quantity: "Monetary recovery rate", method: "Bootstrap" as const, note: "Ratio of recovered ÷ disputed dollars; percentile bootstrap over disputes." },
  { quantity: "Avg recovery / response", method: "Bootstrap" as const, note: "Mean recovered dollars; percentile bootstrap. Never a Wilson interval — it is not a proportion." },
  { quantity: "Opportunity estimates", method: "Bootstrap" as const, note: "Dollar ranges (conservative→expected→optimistic) from resampled segment outcomes." },
];

const RATE_DESC: Record<string, string> = {
  fullWinRate: "won in full ÷ adjudicated",
  anyRecoveryRate: "any $ back ÷ adjudicated",
  rawResponseRate: "responded ÷ all disputes",
  actionableResponseRate: "responded ÷ eligible",
};

const STAGE_ORDER = ["auditing", "preparing", "reporting", "recommending", "complete"];

/* ───────────────────────── main component ───────────────────────── */

export default function IntelligencePage() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [shopId, setShopId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [section, setSection] = useState<Section>("overview");
  const [triggering, setTriggering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, { loading: boolean; text: string | null }>>({});

  // simulator state
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [sim, setSim] = useState({ template: "", minOrderValue: 150, effectivenessPct: 45, perOrderCost: 3.5, currency: "USD" });
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);

  /* ── initial loads: shops + simulator templates ── */
  useEffect(() => {
    fetch("/api/admin/shops?search=")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: ShopRow[]) => {
        setShops(d || []);
        if (d && d[0] && !shopId) setShopId(d[0].id);
      })
      .catch(() => {});
    fetch("/api/admin/intelligence/simulate")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => { setTemplates(d.templates || []); if (d.templates?.[0]) setSim((s) => ({ ...s, template: d.templates[0].key })); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRuns = useCallback(async (sid: string) => {
    if (!sid) { setRuns([]); return; }
    try {
      const r = await fetch(`/api/admin/intelligence/runs?shop_id=${encodeURIComponent(sid)}`);
      const d = await r.json();
      const list: Run[] = d.runs || [];
      setRuns(list);
      if (list[0]) setSelectedRunId(list[0].id);
      else { setSelectedRunId(""); setRun(null); setRecs([]); }
    } catch { /* ignore */ }
  }, []);

  const openRun = useCallback(async (id: string) => {
    if (!id) return;
    const r = await fetch(`/api/admin/intelligence/runs/${id}`);
    if (r.ok) { const d = await r.json(); setRun(d.run); setRecs(d.recommendations || []); }
  }, []);

  useEffect(() => { loadRuns(shopId); setSection("overview"); }, [shopId, loadRuns]);
  useEffect(() => { openRun(selectedRunId); }, [selectedRunId, openRun]);

  // poll while the selected run is still in progress
  useEffect(() => {
    if (!run || run.status === "succeeded" || run.status === "failed") return;
    const t = setInterval(() => openRun(run.id), 5000);
    return () => clearInterval(t);
  }, [run, openRun]);

  const triggerRun = async () => {
    if (!shopId || triggering) return;
    setTriggering(true); setNotice(null);
    try {
      const r = await fetch("/api/admin/intelligence/runs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId }),
      });
      const d = await r.json();
      if (r.status === 409) setNotice(d.message || "A run is already active for this shop.");
      else if (!r.ok) setNotice(d.error || "Failed to trigger run");
      await loadRuns(shopId);
    } finally { setTriggering(false); }
  };

  /* ── simulator ── */
  const runSim = async () => {
    if (!shopId || !sim.template) return;
    setSimBusy(true); setSimErr(null);
    const expBps = Math.round(sim.effectivenessPct * 100);
    const input = {
      template: sim.template,
      currency: sim.currency,
      filters: { minValueDecimal: sim.minOrderValue || null, riskLevels: null, crossBorder: null },
      effectiveness: { conservativeBps: Math.round(expBps * 0.6), expectedBps: expBps, optimisticBps: Math.round(expBps * 1.3) },
      costs: { perOrderCostMinor: Math.round((sim.perOrderCost || 0) * 100) },
    };
    try {
      const r = await fetch("/api/admin/intelligence/simulate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId, input }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Simulation failed");
      setSimResult(d.result);
    } catch (e) { setSimErr(e instanceof Error ? e.message : String(e)); } finally { setSimBusy(false); }
  };

  /* ── explain / decide ── */
  const explain = async (id: string) => {
    setExplanations((m) => ({ ...m, [id]: { loading: true, text: null } }));
    try {
      const r = await fetch("/api/admin/intelligence/explain", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendationId: id }),
      });
      const d = await r.json();
      setExplanations((m) => ({ ...m, [id]: { loading: false, text: r.ok ? d.prose : "Explanation unavailable." } }));
    } catch {
      setExplanations((m) => ({ ...m, [id]: { loading: false, text: "Explanation unavailable." } }));
    }
  };
  const decide = async (id: string, action: string) => {
    const next = decisions[id] === action ? "" : action;
    setDecisions((m) => ({ ...m, [id]: next }));
    if (!next) return;
    try {
      await fetch("/api/admin/intelligence/decision", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendationId: id, action }),
      });
    } catch { /* ignore — UI already reflects the choice */ }
  };

  const exportRun = () => {
    if (!selectedRunId) return;
    const a = document.createElement("a");
    a.href = `/api/admin/intelligence/runs/${selectedRunId}/export`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* ── derived view model ── */
  const running = triggering || (!!run && run.status !== "succeeded" && run.status !== "failed");
  const dq = run?.data_quality || null;
  const baseline = run?.baseline || null;
  const feasibility = run?.feasibility || null;
  const modelReport = run?.model_report || null;
  const leakage = dq ? !dq.riskPreventionSupported : false;

  const merchantName = shops.find((s) => s.id === shopId)?.shop_domain || "—";
  const disputeCount = dq?.facts.disputes.count ?? baseline?.portfolio.totalDisputes ?? 0;

  const runOptions = useMemo(
    () => runs.map((r) => ({ id: r.id, label: `${new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${r.status}` })),
    [runs],
  );

  const stageSteps = useMemo(() => {
    const curIdx = STAGE_ORDER.indexOf((run?.stage || "").toLowerCase());
    return STAGE_ORDER.map((s, i) => {
      const done = i < curIdx, now = i === curIdx;
      return {
        label: s.charAt(0).toUpperCase() + s.slice(1),
        wrap: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 10px", borderRadius: "999px", background: now ? "#DBEAFE" : done ? "#DCFCE7" : "#fff", border: "1px solid " + (now ? "#93C5FD" : done ? "#BBF7D0" : "#E2E8F0") } as CSSProperties,
        dot: { width: "7px", height: "7px", borderRadius: "999px", background: now ? "#1D4ED8" : done ? "#16A34A" : "#CBD5E1" } as CSSProperties,
        text: { fontSize: "12px", fontWeight: 700, color: now ? "#1E40AF" : done ? "#166534" : "#94A3B8" } as CSSProperties,
      };
    });
  }, [run?.stage]);

  const navDefs: [Section, string][] = [
    ["overview", "Overview"], ["data", "Data quality"], ["baseline", "Baseline report"],
    ["opps", "Opportunities"], ["sim", "Policy simulator"], ["model", "Model"], ["method", "Methodology / export"],
  ];

  /* ── shared bits ── */
  const navStyle = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "9px 11px", border: "none",
    borderRadius: "9px", cursor: "pointer", fontSize: "13.5px", fontWeight: active ? 700 : 600,
    background: active ? "#EFF4FF" : "transparent", color: active ? "#1D4ED8" : "#475569", textAlign: "left",
  });
  const markerStyle = (active: boolean): CSSProperties => ({ width: "6px", height: "6px", borderRadius: "999px", background: active ? "#1D4ED8" : "#CBD5E1", flex: "0 0 auto" });
  const badgeStyle: CSSProperties = { fontSize: "10.5px", fontWeight: 800, background: "#1D4ED8", color: "#fff", borderRadius: "999px", padding: "1px 7px", minWidth: "18px", textAlign: "center" };

  const selArrow = <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none", fontSize: "11px" }}>▾</span>;

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "Inter,system-ui,-apple-system,sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        @keyframes dd-spin{to{transform:rotate(360deg)}}
        @keyframes dd-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .dd-spin{animation:dd-spin .8s linear infinite}
        .dd-pulse{animation:dd-pulse 1.4s ease-in-out infinite}
        a{color:#1D4ED8;text-decoration:none}
      ` }} />

      {/* ───────── TOP BAR ───────── */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "14px 28px", display: "flex", alignItems: "center", gap: "18px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: 0 }}>
            <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "#1D4ED8", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "15px", flex: "0 0 auto" }}>D</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "11px", letterSpacing: ".09em", textTransform: "uppercase", color: "#94A3B8", fontWeight: 700, lineHeight: 1 }}>DisputeDesk · Admin</div>
              <div style={{ fontSize: "15px", fontWeight: 700, lineHeight: 1.3, whiteSpace: "nowrap" }}>Historical Dispute Intelligence</div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", flexWrap: "wrap" }}>
            {/* Client selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#94A3B8" }}>Client</label>
              <div style={{ position: "relative" }}>
                <select value={shopId} onChange={(e) => setShopId(e.target.value)}
                  style={{ appearance: "none", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "8px 34px 8px 12px", fontSize: "13.5px", fontWeight: 600, color: "#0F172A", minWidth: "230px", cursor: "pointer", fontFamily: "inherit" }}>
                  {shops.length === 0 && <option value="">No clients</option>}
                  {shops.map((s) => <option key={s.id} value={s.id}>{s.shop_domain}</option>)}
                </select>
                {selArrow}
              </div>
            </div>

            {/* Run selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#94A3B8" }}>Analysis run</label>
              <div style={{ position: "relative" }}>
                <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}
                  style={{ appearance: "none", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "8px 34px 8px 12px", fontSize: "13.5px", fontWeight: 600, color: "#0F172A", minWidth: "210px", cursor: "pointer", fontFamily: "inherit" }}>
                  {runOptions.length === 0 && <option value="">No runs yet</option>}
                  {runOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {selArrow}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", height: "56px" }}>
              <Button variant="primary" onClick={triggerRun} disabled={running || !shopId}>{running ? "Running…" : "Run analysis"}</Button>
            </div>
          </div>
        </div>

        {notice && (
          <div style={{ borderTop: "1px solid #E2E8F0", background: "#FFFBEB" }}>
            <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "8px 28px", fontSize: "12.5px", color: "#92400E", fontWeight: 600 }}>{notice}</div>
          </div>
        )}

        {/* RUN PROGRESS STRIP */}
        {running && (
          <div style={{ borderTop: "1px solid #E2E8F0", background: "#F1F5F9" }}>
            <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "12px 28px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", fontWeight: 700, fontSize: "13px", color: "#1E40AF" }}>
                <span className="dd-spin" style={{ width: "15px", height: "15px", border: "2px solid #BFDBFE", borderTopColor: "#1D4ED8", borderRadius: "999px", display: "inline-block" }} />
                Running analysis
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {stageSteps.map((s, i) => (
                  <div key={i} style={s.wrap}>
                    <span style={s.dot} />
                    <span style={s.text}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>

      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "26px 28px", display: "grid", gridTemplateColumns: "216px minmax(0,1fr)", gap: "28px", alignItems: "start" }}>

        {/* ───────── SIDEBAR NAV ───────── */}
        <nav style={{ position: "sticky", top: "96px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#94A3B8", padding: "4px 10px 8px" }}>Sections</div>
          {navDefs.map(([k, label]) => {
            const active = section === k;
            return (
              <button key={k} onClick={() => setSection(k)} style={navStyle(active)}>
                <span style={markerStyle(active)} />
                <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                {k === "opps" && recs.length > 0 && <span style={badgeStyle}>{recs.length}</span>}
              </button>
            );
          })}

          <div style={{ marginTop: "14px", padding: "12px 12px 4px", borderTop: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#94A3B8", marginBottom: "8px" }}>Run provenance</div>
            <div style={{ fontSize: "11.5px", color: "#64748B", lineHeight: 1.7 }}>
              <div>feature <span className="mono" style={{ color: "#334155" }}>{run?.feature_registry_version || "—"}</span></div>
              <div>classifier <span className="mono" style={{ color: "#334155" }}>{run?.classification_version || "—"}</span></div>
              <div>method <span className="mono" style={{ color: "#334155" }}>{run?.methodology_version || "—"}</span></div>
            </div>
          </div>
        </nav>

        {/* ───────── MAIN ───────── */}
        <main style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "18px" }}>

          {/* ═══ OVERVIEW ═══ */}
          {section === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "24px", fontWeight: 800, letterSpacing: "-.01em" }}>{merchantName}</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B" }}>
                  Coverage {baseline ? `${baseline.period.from?.slice(0, 10) || "?"} – ${baseline.period.to?.slice(0, 10) || "?"}` : "—"} · run {selectedRunId ? selectedRunId.slice(0, 8) : "—"}
                </div>
              </div>

              {leakage
                ? <InfoBanner variant="danger" title="Most important caveat — risk-based prevention is NOT supported (data leakage)">Risk signals for this merchant are ingested after the order, so prevention findings would be circular and are suppressed. Everything below is response, recovery, and economics — not risk prevention.</InfoBanner>
                : <InfoBanner variant="info" title="Read the limitations first">Findings below are descriptive unless a stronger grade is shown.</InfoBanner>}

              {/* headline KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "14px" }}>
                <KPICard label="Disputes in window" value={baseline ? nfmt(baseline.portfolio.totalDisputes) : "—"} footer={baseline ? `${baseline.portfolio.adjudicatedCount} adjudicated · ${baseline.portfolio.respondedCount} responded` : "awaiting run"} />
                <KPICard label="Total disputed" value={baseline ? fmtMoney(baseline.currency, baseline.portfolio.totalDisputedAmount.amountMinor) : "—"} footer={baseline ? `${baseline.portfolio.disputesWithAmount} with an outcome amount` : "awaiting run"} />
                <KPICard label="Recovered" value={baseline ? fmtMoney(baseline.currency, baseline.portfolio.totalRecovered.amountMinor) : "—"} footer="across the coverage window" />
                <KPICard label="Net loss" value={baseline ? fmtMoney(baseline.currency, baseline.portfolio.totalNetLoss.amountMinor) : "—"} footer="disputed minus recovered" />
              </div>

              {/* what this run found */}
              <div style={card}>
                <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "4px" }}>What this run found</div>
                <p style={{ margin: "0 0 16px", fontSize: "13.5px", color: "#64748B", maxWidth: "70ch" }}>
                  {recs.length
                    ? `This run surfaced ${recs.length} opportunit${recs.length === 1 ? "y" : "ies"} that cleared the sample and economic gates${feasibility?.anyModelBuilt ? ", built a pooled response-win model," : ""}${leakage ? " and flagged one hard limit: risk-based prevention is not supported." : "."} Read data quality first — it gates every number here.`
                    : `This run found no opportunities that cleared the gates${feasibility && !feasibility.anyModelBuilt ? " and did not build a model" : ""}. With ${disputeCount} disputes that is the expected, deliberate outcome — the data cannot support confident recommendations yet. The baseline and audit below are still informative.`}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "12px" }}>
                  <div style={inset}>
                    <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Opportunities cleared gates</div>
                    <div style={{ fontSize: "26px", fontWeight: 800, marginTop: "2px" }}>{recs.length}</div>
                    <button onClick={() => setSection("opps")} style={{ marginTop: "6px", background: "none", border: "none", color: "#1D4ED8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", padding: 0 }}>View opportunities →</button>
                  </div>
                  <div style={inset}>
                    <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Response-win model</div>
                    <div style={{ fontSize: "16px", fontWeight: 800, marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <ChipView c={(() => { const c = chip("status", feasibility?.anyModelBuilt ? "reliable" : "insufficient"); c.label = feasibility?.anyModelBuilt ? "Built" : "Not built"; return c; })()} />
                    </div>
                    <button onClick={() => setSection("model")} style={{ marginTop: "6px", background: "none", border: "none", color: "#1D4ED8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", padding: 0 }}>Model &amp; feasibility →</button>
                  </div>
                  <div style={inset}>
                    <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Data quality gate</div>
                    <div style={{ fontSize: "16px", fontWeight: 800, marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <ChipView c={(() => { const c = chip("status", leakage ? "usable_with_limitations" : "reliable"); c.label = leakage ? "Leakage flagged" : "Clean"; return c; })()} />
                    </div>
                    <button onClick={() => setSection("data")} style={{ marginTop: "6px", background: "none", border: "none", color: "#1D4ED8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", padding: 0 }}>Data quality →</button>
                  </div>
                </div>
              </div>

              {/* scale legend */}
              <div style={card}>
                <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>Reading the badges <span style={{ fontWeight: 500, color: "#94A3B8" }}>— four scales, reused everywhere</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "14px 28px" }}>
                  {LEGEND.map((lg, i) => (
                    <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", minWidth: "150px" }}>
                        {lg.chips.map((c, j) => <ChipView key={j} c={c} />)}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}><b style={{ color: "#334155" }}>{lg.title}.</b> {lg.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ DATA QUALITY ═══ */}
          {section === "data" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Data quality audit</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B", maxWidth: "74ch" }}>This gates everything below. Rates and models are only computed on inputs that pass. Areas graded <b>insufficient</b> are excluded from the finding that depends on them.</div>
              </div>

              {!dq && <div style={{ ...card, color: "#64748B", fontSize: "13.5px" }}>No data-quality report on this run yet{running ? " — audit in progress…" : "."}</div>}

              {dq && leakage && (
                <InfoBanner variant="danger" title="Risk-based prevention is NOT supported for this merchant (data leakage)">
                  Risk signals are ingested a median {dq.facts.leakage.median_ingest_lag_hours ?? "?"}h after the order and only {dq.facts.leakage.pct_ingested_within_48h != null ? p0(dq.facts.leakage.pct_ingested_within_48h) : "?"} land within 48h — partly derived after the fact. Scoring prevention on them would leak the outcome into the feature, so any &ldquo;prevented loss&rdquo; would be circular. Prevention findings are suppressed for this merchant.
                </InfoBanner>
              )}

              {dq && (
                <>
                  {/* area cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "14px" }}>
                    {dq.areas.map((a, i) => (
                      <div key={i} style={card}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                          <div style={{ fontSize: "14.5px", fontWeight: 700 }}>{a.area}</div>
                          <ChipView c={chip("status", a.status)} />
                        </div>
                        <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>{a.reason}</div>
                        {a.notes && a.notes.length > 0 && (
                          <ul style={{ margin: "9px 0 0", paddingLeft: "16px", color: "#64748B", fontSize: "12px", lineHeight: 1.7 }}>
                            {a.notes.map((nt, j) => <li key={j}>{nt}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* facts grid */}
                  <div style={card}>
                    <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "14px" }}>Audited facts</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "14px" }}>
                      {buildFacts(dq).map((f, i) => (
                        <div key={i} style={inset}>
                          <div style={{ fontSize: "11.5px", color: "#64748B", fontWeight: 600, lineHeight: 1.35 }}>{f.label}</div>
                          <div className="mono" style={{ fontSize: "20px", fontWeight: 800, marginTop: "4px", color: f.color }}>{f.value}</div>
                          {f.sub && <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{f.sub}</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* global limitations */}
                  <div style={card}>
                    <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>Global limitations <span style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8" }}>always shown — never collapsed</span></div>
                    <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {dq.globalLimitations.map((l, i) => <li key={i} style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>{l}</li>)}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ BASELINE ═══ */}
          {section === "baseline" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Baseline report</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B" }}>
                  Descriptive portfolio in {baseline?.currency || "—"} · {baseline ? `${baseline.period.from?.slice(0, 10) || "?"} – ${baseline.period.to?.slice(0, 10) || "?"}` : "—"}
                  {baseline && baseline.otherCurrencyDisputeCount > 0 && <span style={{ color: "#94A3B8" }}> · {baseline.otherCurrencyDisputeCount} disputes in other currencies excluded</span>}
                </div>
              </div>

              {!baseline && <div style={{ ...card, color: "#64748B", fontSize: "13.5px" }}>No baseline on this run yet{running ? " — computing…" : "."}</div>}

              {baseline && (() => {
                const pf = baseline.portfolio;
                const totals: [string, string, string][] = [
                  ["Total disputes", nfmt(pf.totalDisputes), "#0F172A"],
                  ["Total disputed", fmtMoney(baseline.currency, pf.totalDisputedAmount.amountMinor), "#0F172A"],
                  ["Total recovered", fmtMoney(baseline.currency, pf.totalRecovered.amountMinor), "#166534"],
                  ["Net loss", fmtMoney(baseline.currency, pf.totalNetLoss.amountMinor), "#B91C1C"],
                  ["Adjudicated", nfmt(pf.adjudicatedCount), "#334155"],
                  ["Responded", nfmt(pf.respondedCount), "#334155"],
                ];
                const yearEntries = Object.entries(pf.disputesByYear).sort((a, b) => a[0].localeCompare(b[0]));
                const maxYear = Math.max(1, ...yearEntries.map(([, c]) => c));
                const rateEntries: [keyof Baseline["rates"], RateMetric][] = [
                  ["fullWinRate", baseline.rates.fullWinRate], ["anyRecoveryRate", baseline.rates.anyRecoveryRate],
                  ["rawResponseRate", baseline.rates.rawResponseRate], ["actionableResponseRate", baseline.rates.actionableResponseRate],
                ];
                const monScaleMax = Math.max(baseline.monetary.avgRecoveryPerResponse.upper * 1.15, 1);
                return (
                  <>
                    {/* portfolio + trend */}
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: "14px" }}>
                      <div style={card}>
                        <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "14px" }}>Portfolio totals</div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {totals.map((t, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #F1F5F9" }}>
                              <span style={{ fontSize: "13px", color: "#475569" }}>{t[0]}</span>
                              <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: t[2] }}>{t[1]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={card}>
                        <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "14px" }}>Disputes by year</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                          {yearEntries.map(([year, count]) => (
                            <div key={year} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <span className="mono" style={{ fontSize: "12px", color: "#64748B", width: "34px" }}>{year}</span>
                              <div style={{ flex: 1, height: "22px", background: "#F1F5F9", borderRadius: "6px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: Math.round((count / maxYear) * 100) + "%", background: "#1D4ED8", borderRadius: "6px" }} />
                              </div>
                              <span className="mono" style={{ fontSize: "12.5px", fontWeight: 700, width: "38px", textAlign: "right" }}>{nfmt(count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* rates */}
                    <div style={card}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                        <div style={{ fontSize: "15px", fontWeight: 700 }}>The four rates</div>
                        <div style={{ fontSize: "11.5px", color: "#94A3B8" }}>point · 95% CI · n · method · confidence</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "14px", marginTop: "10px" }}>
                        {rateEntries.map(([key, r]) => {
                          const excluded = (r.excluded || []).filter((e) => e.count > 0).map((e) => `${e.count}: ${e.reason}`).join("; ");
                          return (
                            <div key={key} style={{ border: "1px solid #E2E8F0", borderRadius: "11px", padding: "15px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                                <div>
                                  <div style={{ fontSize: "13.5px", fontWeight: 700 }}>{r.name}</div>
                                  <div style={{ fontSize: "11.5px", color: "#94A3B8", marginTop: "1px" }}>{RATE_DESC[key]}</div>
                                </div>
                                <ChipView c={chip("confidence", r.confidence)} />
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "12px 0 6px" }}>
                                <span className="mono" style={{ fontSize: "30px", fontWeight: 800, letterSpacing: "-.02em" }}>{r.denominator === 0 ? "—" : p1(r.point)}</span>
                                <span className="mono" style={{ fontSize: "12.5px", color: "#64748B" }}>95% CI {p1(r.lower)} – {p1(r.upper)}</span>
                              </div>
                              <div style={{ position: "relative", height: "8px", background: "#F1F5F9", borderRadius: "6px", margin: "8px 0 12px" }}>
                                <div style={{ position: "absolute", top: 0, bottom: 0, left: p1(r.lower), width: ((r.upper - r.lower) * 100).toFixed(1) + "%", background: "#BFDBFE", borderRadius: "6px" }} />
                                <div style={{ position: "absolute", top: "-3px", left: p1(r.point), width: "3px", height: "14px", background: "#1D4ED8", borderRadius: "2px", transform: "translateX(-50%)" }} />
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px", color: "#64748B" }}>
                                <span className="mono">n = {r.numerator} / {r.denominator}</span>
                                <span style={methodTag("wilson")} title="Binary proportion — Wilson score interval">Wilson</span>
                              </div>
                              {excluded && <div style={{ marginTop: "9px", fontSize: "11.5px", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "7px", padding: "6px 9px" }}>Excluded {excluded}</div>}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ height: "1px", background: "#E2E8F0", margin: "18px 0" }} />
                      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px" }}>Monetary metrics <span style={{ fontWeight: 500, color: "#94A3B8" }}>— bootstrap intervals, not Wilson</span></div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "14px" }}>
                        {([
                          { m: baseline.monetary.monetaryRecoveryRate, kind: "pct" as const, name: "Monetary recovery rate" },
                          { m: baseline.monetary.avgRecoveryPerResponse, kind: "money" as const, name: "Avg recovery / response" },
                        ]).map(({ m, kind, name }, i) => {
                          const fmt = (v: number) => (kind === "money" ? fmtMoney(baseline.currency, v) : p1(v));
                          const scale = kind === "money" ? monScaleMax : 1;
                          return (
                            <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: "11px", padding: "15px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                                <div style={{ fontSize: "13.5px", fontWeight: 700 }}>{name}</div>
                                <ChipView c={chip("confidence", m.confidence)} />
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "12px 0 6px" }}>
                                <span className="mono" style={{ fontSize: "26px", fontWeight: 800 }}>{fmt(m.point)}</span>
                                <span className="mono" style={{ fontSize: "12.5px", color: "#64748B" }}>95% CI {fmt(m.lower)} – {fmt(m.upper)}</span>
                              </div>
                              <div style={{ position: "relative", height: "8px", background: "#F1F5F9", borderRadius: "6px", margin: "8px 0 12px" }}>
                                <div style={{ position: "absolute", top: 0, bottom: 0, left: (m.lower / scale * 100).toFixed(1) + "%", width: ((m.upper - m.lower) / scale * 100).toFixed(1) + "%", background: "#C7D2FE", borderRadius: "6px" }} />
                                <div style={{ position: "absolute", top: "-3px", left: (m.point / scale * 100).toFixed(1) + "%", width: "3px", height: "14px", background: "#4F46E5", borderRadius: "2px", transform: "translateX(-50%)" }} />
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px", color: "#64748B" }}>
                                <span className="mono">bootstrap n = {m.sampleSize}</span>
                                <span style={methodTag("bootstrap")} title="Monetary quantity — bootstrap percentile interval">Bootstrap</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={card}>
                      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "9px" }}>Limitations of this baseline</div>
                      <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "7px" }}>
                        {baseline.limitations.map((l, i) => <li key={i} style={{ fontSize: "12.5px", color: "#475569", lineHeight: 1.55 }}>{l}</li>)}
                      </ul>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ═══ OPPORTUNITIES ═══ */}
          {section === "opps" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Opportunities</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B", maxWidth: "74ch" }}>Merchant-actionable findings that cleared the sample and economic gates. Each is decision support — recording a decision logs a human choice; nothing is auto-submitted.</div>
              </div>

              {recs.length === 0 && (
                <div style={{ ...card, textAlign: "center", padding: "44px 28px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: "24px" }}>◔</div>
                  <div style={{ fontSize: "17px", fontWeight: 800, marginBottom: "6px" }}>No opportunities cleared the gates</div>
                  <p style={{ margin: "0 auto 18px", fontSize: "13.5px", color: "#64748B", maxWidth: "56ch" }}>Every candidate segment either fell below the minimum-sample gate or failed the positive-economics test. Rather than surface a fragile recommendation, this run reports none.</p>
                  <InfoBanner variant="info" title="This is an expected outcome, not an error">With {disputeCount} disputes, no segment reached the minimum sample or positive-economics threshold. Re-run when more disputes have accrued.</InfoBanner>
                </div>
              )}

              {recs.map((o) => (
                <OpportunityCard
                  key={o.id} o={o}
                  currency={baseline?.currency || o.currency || "USD"}
                  decision={decisions[o.id] || ""}
                  ex={explanations[o.id]}
                  onExplain={() => explain(o.id)}
                  onDecide={(a) => decide(o.id, a)}
                />
              ))}
            </div>
          )}

          {/* ═══ SIMULATOR ═══ */}
          {section === "sim" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Policy simulator</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B", maxWidth: "74ch" }}>A what-if on a policy segment. Output is an <b>estimated range</b>, never a promise — and it never acts on any dispute.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,340px) minmax(0,1fr)", gap: "16px", alignItems: "start" }}>
                {/* inputs */}
                <div style={{ ...card, position: "sticky", top: "96px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "14px" }}>Scenario inputs</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "5px" }}>Template</label>
                      <div style={{ position: "relative" }}>
                        <select value={sim.template} onChange={(e) => setSim((s) => ({ ...s, template: e.target.value }))}
                          style={{ width: "100%", appearance: "none", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "9px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.4 }}>{templates.find((t) => t.key === sim.template)?.description || ""}</div>
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}><label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569" }}>Min order value</label><span className="mono" style={{ fontSize: "12px", fontWeight: 700 }}>{fmtMoney(sim.currency, sim.minOrderValue)}</span></div>
                      <input type="range" min={0} max={500} step={10} value={sim.minOrderValue} onChange={(e) => setSim((s) => ({ ...s, minOrderValue: Number(e.target.value) }))} style={{ width: "100%", accentColor: "#1D4ED8" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}><label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569" }}>Expected effectiveness</label><span className="mono" style={{ fontSize: "12px", fontWeight: 700 }}>{sim.effectivenessPct}%</span></div>
                      <input type="range" min={5} max={90} step={5} value={sim.effectivenessPct} onChange={(e) => setSim((s) => ({ ...s, effectivenessPct: Number(e.target.value) }))} style={{ width: "100%", accentColor: "#1D4ED8" }} />
                      <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "4px" }}>Share of segment loss the policy avoids.</div>
                    </div>
                    <div>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "5px" }}>Cost per reviewed order</label>
                      <input type="number" min={0} step={0.5} value={sim.perOrderCost} onChange={(e) => setSim((s) => ({ ...s, perOrderCost: Number(e.target.value) }))} className="mono" style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "9px 12px", fontSize: "13px", fontFamily: "inherit" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "5px" }}>Currency</label>
                      <div style={{ position: "relative" }}>
                        <select value={sim.currency} onChange={(e) => setSim((s) => ({ ...s, currency: e.target.value }))}
                          style={{ width: "100%", appearance: "none", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "9px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          <option value="USD">USD $</option><option value="EUR">EUR €</option><option value="GBP">GBP £</option>
                        </select>
                      </div>
                    </div>
                    <Button variant="primary" full onClick={runSim} disabled={simBusy || !sim.template || !shopId}>{simBusy ? "Simulating…" : "Run simulation"}</Button>
                    {simErr && <div style={{ fontSize: "12px", color: "#B91C1C" }}>{simErr}</div>}
                  </div>
                </div>

                {/* results */}
                {!simResult ? (
                  <div style={{ ...card, color: "#64748B", fontSize: "13.5px" }}>Run a simulation to see the estimated avoided-loss range and segment breakdown.</div>
                ) : (() => {
                  const r = simResult;
                  const cur = r.currency;
                  const av = { c: parseFloat(r.avoidedLoss.conservative), e: parseFloat(r.avoidedLoss.expected), o: parseFloat(r.avoidedLoss.optimistic) };
                  const scale = Math.max(av.o * 1.05, 1);
                  const netExp = parseFloat(r.netImpact.expected);
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div style={{ ...card, background: "linear-gradient(180deg,#F8FAFF,#fff)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#94A3B8" }}>Avoided loss — estimated range</div>
                          <ChipView c={chip("confidence", r.confidence)} />
                        </div>
                        <div className="mono" style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-.02em", margin: "4px 0 2px" }}>{fmtMoney(cur, r.avoidedLoss.expected)}</div>
                        <div style={{ position: "relative", height: "14px", margin: "12px 2px 8px" }}>
                          <div style={{ position: "absolute", left: 0, right: 0, top: "3px", height: "8px", background: "#EEF2F7", borderRadius: "6px" }} />
                          <div style={{ position: "absolute", left: (av.c / scale * 100).toFixed(1) + "%", right: (100 - av.o / scale * 100).toFixed(1) + "%", top: "3px", height: "8px", background: "#BBF7D0", borderRadius: "6px" }} />
                          <div style={{ position: "absolute", left: (av.e / scale * 100).toFixed(1) + "%", top: 0, width: "3px", height: "14px", background: "#16A34A", borderRadius: "2px", transform: "translateX(-50%)" }} />
                        </div>
                        <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748B", margin: "0 2px" }}>
                          <span>{fmtMoney(cur, r.avoidedLoss.conservative)} <span style={{ color: "#94A3B8" }}>conservative</span></span>
                          <span><span style={{ color: "#94A3B8" }}>optimistic</span> {fmtMoney(cur, r.avoidedLoss.optimistic)}</span>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "12px" }}>
                        <div style={card}><div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Net impact (expected)</div><div className="mono" style={{ fontSize: "22px", fontWeight: 800, marginTop: "3px", color: netExp >= 0 ? "#166534" : "#B91C1C" }}>{fmtMoney(cur, r.netImpact.expected)}</div><div className="mono" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{fmtMoney(cur, r.netImpact.conservative)} … {fmtMoney(cur, r.netImpact.optimistic)}</div></div>
                        <div style={card}><div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Implementation cost</div><div className="mono" style={{ fontSize: "22px", fontWeight: 800, marginTop: "3px" }}>{fmtMoney(cur, r.implementationCost)}</div><div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{nfmt(r.reviewWorkload)} orders reviewed</div></div>
                        <div style={card}><div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Friction exposure</div><div className="mono" style={{ fontSize: "22px", fontWeight: 800, marginTop: "3px", color: "#D97706" }}>{nfmt(r.legitimateOrdersAffected)}</div><div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>legit orders w/ no dispute</div></div>
                      </div>

                      <div style={card}>
                        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>Segment</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "12px" }}>
                          {([
                            ["Orders affected", nfmt(r.ordersAffected)],
                            ["Disputes in segment", nfmt(r.disputesInSegment)],
                            ["Revenue affected", fmtMoney(cur, r.revenueAffected)],
                            ["Disputed value", fmtMoney(cur, r.disputedValueInSegment)],
                            ["Net loss in segment", fmtMoney(cur, r.netLossInSegment)],
                            ["Legit orders (no dispute)", nfmt(r.legitimateOrdersAffected)],
                          ] as [string, string][]).map(([label, value], i) => (
                            <div key={i} style={inset}><div style={{ fontSize: "11.5px", color: "#64748B", fontWeight: 600 }}>{label}</div><div className="mono" style={{ fontSize: "16px", fontWeight: 700, marginTop: "2px" }}>{value}</div></div>
                          ))}
                        </div>
                      </div>

                      <div style={card}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                          <div><div style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", marginBottom: "5px" }}>Assumptions</div><ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>{r.assumptions.map((l, i) => <li key={i} style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>{l}</li>)}</ul></div>
                          <div><div style={{ fontSize: "11.5px", fontWeight: 700, color: "#92400E", marginBottom: "5px" }}>Limitations</div><ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>{r.limitations.map((l, i) => <li key={i} style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>{l}</li>)}</ul></div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ═══ MODEL ═══ */}
          {section === "model" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Model &amp; feasibility</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B", maxWidth: "74ch" }}>{feasibility?.summary || "No feasibility assessment on this run yet."}</div>
              </div>

              {feasibility && (
                <div style={card}>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>Feasibility verdicts</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {feasibility.verdicts.map((v, i) => {
                      const c = chip("status", v.feasible ? "reliable" : "insufficient"); c.label = v.feasible ? "Feasible" : "Not feasible";
                      const iconStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "8px", flex: "0 0 auto", background: v.feasible ? "#DCFCE7" : "#FEE2E2", color: v.feasible ? "#16A34A" : "#DC2626", fontWeight: 800, fontSize: "16px" };
                      return (
                        <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: "11px", padding: "13px 15px", display: "flex", gap: "13px", alignItems: "flex-start" }}>
                          <span style={iconStyle}>{v.feasible ? "✓" : "✕"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}><span style={{ fontSize: "13.5px", fontWeight: 700 }}>{v.model}</span><ChipView c={c} /></div>
                            <div style={{ fontSize: "12.5px", color: "#475569", marginTop: "4px", lineHeight: 1.5 }}>{v.reason}</div>
                            {v.gateFailures.length > 0 && (
                              <div style={{ marginTop: "7px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {v.gateFailures.map((g, j) => <span key={j} className="mono" style={{ fontSize: "10.5px", background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: "6px", padding: "2px 7px" }}>{g}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {feasibility && !modelReport && (
                <div style={{ ...card, textAlign: "center", padding: "40px 28px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: "24px" }}>⊘</div>
                  <div style={{ fontSize: "17px", fontWeight: 800, marginBottom: "6px" }}>No model built for this merchant</div>
                  <p style={{ margin: "0 auto 4px", fontSize: "13.5px", color: "#64748B", maxWidth: "58ch" }}>Building one on this sample would overfit and mislead. That is the correct, deliberate outcome — not a failure. A response-win model becomes feasible once enough responded-and-adjudicated disputes accrue across at least two years.</p>
                </div>
              )}

              {modelReport && (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <InfoBanner variant="warning" title="Selection bias — read before trusting this model">{modelReport.targetPopulation}</InfoBanner>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px" }}>
                    {([
                      ["Test observations", nfmt(modelReport.overall.testN), "held-out"],
                      ["Brier score", modelReport.overall.brier.toFixed(3), "lower is better"],
                      ["Base rate", p0(modelReport.overall.baseRate), "observed win"],
                      ["Mean predicted", p0(modelReport.overall.meanPredicted), "vs base rate"],
                    ] as [string, string, string][]).map(([label, value, sub], i) => (
                      <div key={i} style={card}><div style={{ fontSize: "11.5px", color: "#64748B", fontWeight: 600 }}>{label}</div><div className="mono" style={{ fontSize: "22px", fontWeight: 800, marginTop: "3px" }}>{value}</div><div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{sub}</div></div>
                    ))}
                  </div>

                  <div style={card}>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "6px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 700 }}>Model summary</div>
                      <ChipView c={chip("grade", modelReport.evidenceGrade)} />
                      <ChipView c={chip("confidence", modelReport.confidence)} />
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#94A3B8", fontWeight: 600, margin: "8px 0 6px" }}>Feature set</div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {modelReport.featureSet.map((f, i) => <span key={i} className="mono" style={{ fontSize: "11px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: "6px", padding: "3px 8px", color: "#334155" }}>{f}</span>)}
                    </div>
                  </div>

                  {/* backtest folds */}
                  <div style={card}>
                    <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>Walk-forward backtest</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                        <thead><tr style={{ textAlign: "right", color: "#94A3B8", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px" }}>Train through</th><th style={{ padding: "6px 8px" }}>Test year</th><th style={{ padding: "6px 8px" }}>Train n</th><th style={{ padding: "6px 8px" }}>Test n</th><th style={{ padding: "6px 8px" }}>Brier</th><th style={{ padding: "6px 8px" }}>Observed win</th><th style={{ padding: "6px 8px" }}>Mean pred.</th>
                        </tr></thead>
                        <tbody>
                          {modelReport.folds.map((f, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }} className="mono">
                              <td style={{ textAlign: "left", padding: "8px", fontWeight: 700 }}>≤ {f.trainThroughYear}</td>
                              <td style={{ textAlign: "right", padding: "8px" }}>{f.testYear}</td>
                              <td style={{ textAlign: "right", padding: "8px", color: "#64748B" }}>{nfmt(f.trainN)}</td>
                              <td style={{ textAlign: "right", padding: "8px", color: "#64748B" }}>{nfmt(f.testN)}</td>
                              <td style={{ textAlign: "right", padding: "8px", fontWeight: 700 }}>{f.brier.toFixed(3)}</td>
                              <td style={{ textAlign: "right", padding: "8px" }}>{p0(f.observedWinRate)}</td>
                              <td style={{ textAlign: "right", padding: "8px" }}>{p0(f.meanPredicted)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* calibration */}
                  <div style={card}>
                    <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>Calibration — predicted vs. observed</div>
                    <div style={{ fontSize: "11.5px", color: "#94A3B8", marginBottom: "14px" }}>Well-calibrated when the ● (observed) sits near the │ (predicted) in each bucket.</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {modelReport.calibration.map((c, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <span className="mono" style={{ fontSize: "11.5px", color: "#64748B", width: "64px" }}>{c.bucket}</span>
                          <div style={{ flex: 1, position: "relative", height: "16px", background: "#F1F5F9", borderRadius: "6px" }}>
                            <div style={{ position: "absolute", top: "1px", bottom: "1px", left: (c.meanPredicted * 100).toFixed(0) + "%", width: "2.5px", background: "#94A3B8", transform: "translateX(-50%)" }} />
                            <div style={{ position: "absolute", top: "50%", left: (c.observedWinRate * 100).toFixed(0) + "%", width: "11px", height: "11px", background: "#4F46E5", border: "2px solid #fff", borderRadius: "999px", transform: "translate(-50%,-50%)", boxShadow: "0 0 0 1px #C7D2FE" }} />
                          </div>
                          <span className="mono" style={{ fontSize: "11px", color: "#94A3B8", width: "46px", textAlign: "right" }}>n={c.n}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={card}>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "9px" }}>Model limitations</div>
                    <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "7px" }}>
                      {modelReport.limitations.map((l, i) => <li key={i} style={{ fontSize: "12.5px", color: "#475569", lineHeight: 1.55 }}>{l}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ METHODOLOGY / EXPORT ═══ */}
          {section === "method" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <h1 style={{ margin: "0 0 5px", fontSize: "22px", fontWeight: 800 }}>Methodology &amp; export</h1>
                <div style={{ fontSize: "13.5px", color: "#64748B", maxWidth: "74ch" }}>How every number on this run was computed, and a self-contained report you can hand off.</div>
              </div>

              <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700 }}>Export this run</div>
                  <div style={{ fontSize: "12.5px", color: "#64748B", marginTop: "2px" }}>Markdown report — audit facts, rates with intervals, opportunities, model card, and every limitation.</div>
                </div>
                <Button variant="primary" onClick={exportRun} disabled={!selectedRunId}>↓ Download report (.md)</Button>
              </div>

              <div style={card}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>Method by quantity</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {METHOD_ROWS.map((m, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "200px 130px 1fr", gap: "14px", padding: "11px 0", borderBottom: "1px solid #F1F5F9", alignItems: "baseline" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700 }}>{m.quantity}</span>
                      <span style={methodTag(m.method === "Wilson" ? "wilson" : "bootstrap")}>{m.method}</span>
                      <span style={{ fontSize: "12.5px", color: "#64748B", lineHeight: 1.5 }}>{m.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>Evidence grades &amp; confidence — the legend, in full</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 28px" }}>
                  {LEGEND.map((lg, i) => (
                    <div key={i}>
                      <div style={{ fontSize: "12.5px", fontWeight: 700, marginBottom: "7px" }}>{lg.title}</div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>{lg.chips.map((c, j) => <ChipView key={j} c={c} />)}</div>
                      <div style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>{lg.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Principles this surface holds to</div>
                <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <li style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>It never acts on a dispute. Every control reads, explains, simulates, exports, or records a human decision.</li>
                  <li style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>Every rate carries its numerator/denominator, 95% interval, method, and per-finding confidence. Binary rates use Wilson; monetary quantities use bootstrap — the two are never mixed.</li>
                  <li style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>Limitations are always shown, never hidden behind a click. Empty and &ldquo;not built&rdquo; states are expected outcomes for small merchants.</li>
                  <li style={{ fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>Explanations are prose over already-validated numbers — they never recalculate anything.</li>
                </ul>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

/* ───────────────────────── helpers that need runtime data ───────────────────────── */

function buildFacts(dq: DataQuality): { label: string; value: string; sub?: string; color: string }[] {
  const o = dq.facts.orders, l = dq.facts.leakage, d = dq.facts.disputes;
  const lagColor = l.median_ingest_lag_hours != null && l.median_ingest_lag_hours > 48 ? "#DC2626" : "#0F172A";
  const orphanColor = d.pct_orphan_no_order > 0 ? "#D97706" : "#0F172A";
  const rcColor = d.pct_network_code_direct_or_derived < 0.5 ? "#DC2626" : "#0F172A";
  return [
    { label: "Orders", value: nfmt(o.count), color: "#0F172A" },
    { label: "Order coverage start", value: o.coverage_start ? o.coverage_start.slice(0, 10) : "—", color: "#0F172A" },
    { label: "Distinct currencies", value: String(o.distinct_currencies), color: "#0F172A" },
    { label: "Median ingest lag", value: l.median_ingest_lag_hours != null ? l.median_ingest_lag_hours.toFixed(1) + "h" : "—", sub: l.pct_ingested_within_48h != null ? `${p0(l.pct_ingested_within_48h)} within 48h` : undefined, color: lagColor },
    { label: "Disputes", value: nfmt(d.count), color: "#0F172A" },
    { label: "Adjudicated", value: nfmt(d.count_adjudicated), sub: `${nfmt(d.count_submitted)} responded`, color: "#0F172A" },
    { label: "Orphan (no order)", value: p1(d.pct_orphan_no_order), color: orphanColor },
    { label: "Reason code coverage", value: p0(d.pct_network_code_direct_or_derived), color: rcColor },
  ];
}

/* ───────────────────────── opportunity card ───────────────────────── */

function OpportunityCard({ o, currency, decision, ex, onExplain, onDecide }: {
  o: Recommendation; currency: string; decision: string;
  ex?: { loading: boolean; text: string | null };
  onExplain: () => void; onDecide: (a: string) => void;
}) {
  const cur = o.currency || currency;
  const lower = o.estimate_lower_minor, point = o.estimate_point_minor, upper = o.estimate_upper_minor;
  const hasEst = !!point;
  const scale = Math.max((upper ? parseFloat(upper) : 0) * 1.1, 1);
  const period = o.estimate_period === "annualized" ? "annualized" : "historical total";

  const decMap: Record<string, [string, string, string, string]> = {
    accepted: ["Accepted", "#DCFCE7", "#166534", "#BBF7D0"],
    rejected: ["Rejected", "#FEE2E2", "#991B1B", "#FECACA"],
    marked_later: ["Marked for later", "#FEF3C7", "#92400E", "#FDE68A"],
  };
  const dm = decision ? decMap[decision] : null;
  const showExplain = !!ex;

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "240px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "7px" }}>
              <ChipView c={chip("category", o.category)} />
              <ChipView c={chip("grade", o.evidence_grade)} />
              <ChipView c={chip("confidence", o.confidence)} />
            </div>
            <div style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.01em" }}>{o.title}</div>
            <p style={{ margin: "6px 0 0", fontSize: "13.5px", color: "#475569", lineHeight: 1.55, maxWidth: "64ch" }}>{o.summary}</p>
          </div>

          {/* estimate range */}
          <div style={{ width: "262px", flex: "0 0 auto", border: "1px solid #E2E8F0", borderRadius: "11px", padding: "13px 14px", background: "#FAFBFE" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#94A3B8" }}>Estimated impact · {period}</div>
            <div className="mono" style={{ fontSize: "23px", fontWeight: 800, margin: "5px 0 2px" }}>{hasEst ? fmtMoney(cur, point!) : "—"}</div>
            <div style={{ position: "relative", height: "8px", background: "#EEF2F7", borderRadius: "6px", margin: "9px 0 6px" }}>
              {hasEst && lower && upper && (
                <>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: (parseFloat(lower) / scale * 100).toFixed(1) + "%", width: ((parseFloat(upper) - parseFloat(lower)) / scale * 100).toFixed(1) + "%", background: "#BBF7D0", borderRadius: "6px" }} />
                  <div style={{ position: "absolute", top: "-3px", left: (parseFloat(point!) / scale * 100).toFixed(1) + "%", width: "3px", height: "14px", background: "#16A34A", borderRadius: "2px", transform: "translateX(-50%)" }} />
                </>
              )}
            </div>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748B" }}>
              <span>{lower ? fmtMoney(cur, lower) : "—"}</span><span>{upper ? fmtMoney(cur, upper) : "—"}</span>
            </div>
            <div style={{ fontSize: "10.5px", color: "#94A3B8", marginTop: "5px" }}>conservative → expected → optimistic · estimate, not a promise</div>
          </div>
        </div>

        {/* action + facts */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "10px", marginTop: "15px" }}>
          <div style={inset}><div style={{ fontSize: "11px", color: "#64748B", fontWeight: 600 }}>Suggested action</div><div style={{ fontSize: "12.5px", color: "#0F172A", marginTop: "3px", lineHeight: 1.4 }}>{o.suggested_action}</div></div>
          <div style={inset}><div style={{ fontSize: "11px", color: "#64748B", fontWeight: 600 }}>Affected</div><div className="mono" style={{ fontSize: "13px", fontWeight: 700, marginTop: "3px" }}>{nfmt(o.affected_dispute_count)} disputes · {nfmt(o.affected_order_count)} orders</div><div style={{ fontSize: "11px", color: "#94A3B8" }}>{o.baseline_metric ? `${o.baseline_metric.name}: ${o.baseline_metric.value}` : ""}</div></div>
          <div style={inset}><div style={{ fontSize: "11px", color: "#64748B", fontWeight: 600 }}>Effort</div><div style={{ marginTop: "5px" }}>{o.implementation_effort ? <ChipView c={chip("risk", o.implementation_effort)} /> : <span style={{ fontSize: "12px", color: "#94A3B8" }}>—</span>}</div></div>
          <div style={inset}><div style={{ fontSize: "11px", color: "#64748B", fontWeight: 600 }}>Customer friction</div><div style={{ marginTop: "5px" }}>{o.customer_friction_risk ? <ChipView c={chip("risk", o.customer_friction_risk)} /> : <span style={{ fontSize: "12px", color: "#94A3B8" }}>—</span>}</div></div>
        </div>

        {/* limitations + assumptions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "15px" }}>
          <div>
            <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#92400E", marginBottom: "5px" }}>Limitations</div>
            <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>{(o.limitations || []).map((l, i) => <li key={i} style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>{l}</li>)}</ul>
          </div>
          <div>
            <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", marginBottom: "5px" }}>Assumptions</div>
            <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>{(o.assumptions || []).map((l, i) => <li key={i} style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>{l}</li>)}</ul>
          </div>
        </div>

        {/* explanation */}
        {showExplain && (
          <div style={{ marginTop: "15px", border: "1px solid #C7D2FE", background: "#EEF2FF", borderRadius: "10px", padding: "13px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "6px" }}>
              <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#3730A3", display: "flex", alignItems: "center", gap: "7px" }}>Plain-English explanation <span style={{ fontWeight: 600, color: "#6366F1" }}>generated · numbers unchanged</span></div>
              <button onClick={onExplain} style={{ background: "none", border: "none", color: "#4F46E5", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", padding: 0 }}>↻ Regenerate</button>
            </div>
            {ex?.loading && <div className="dd-pulse" style={{ fontSize: "13px", color: "#4F46E5" }}>Generating explanation…</div>}
            {ex?.text && <p style={{ margin: 0, fontSize: "13px", color: "#312E81", lineHeight: 1.6 }}>{ex.text}</p>}
          </div>
        )}
      </div>

      {/* action bar */}
      <div style={{ borderTop: "1px solid #E2E8F0", background: "#FAFBFC", padding: "12px 20px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={onExplain}>{ex ? "Re-explain" : "Explain this"}</Button>
        <div style={{ width: "1px", height: "22px", background: "#E2E8F0" }} />
        <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#94A3B8" }}>Record decision</span>
        <Button variant={decision === "accepted" ? "primary" : "secondary"} size="sm" onClick={() => onDecide("accepted")}>Accept</Button>
        <Button variant={decision === "marked_later" ? "primary" : "secondary"} size="sm" onClick={() => onDecide("marked_later")}>Later</Button>
        <Button variant={decision === "rejected" ? "danger" : "secondary"} size="sm" onClick={() => onDecide("rejected")}>Reject</Button>
        <div style={{ flex: 1 }} />
        {dm && <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", background: dm[1], color: dm[2], border: "1px solid " + dm[3] }}>Decision: {dm[0]}</span>}
      </div>
    </div>
  );
}
