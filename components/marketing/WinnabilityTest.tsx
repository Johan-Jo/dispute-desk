"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crimson_Pro, Inter, Spline_Sans_Mono } from "next/font/google";

// Matches the prototype's Google Fonts: Crimson Pro (serif), Inter (sans),
// Spline Sans Mono (mono). Loaded via next/font and exposed as CSS variables.
const serif = Crimson_Pro({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-dd-serif",
  display: "swap",
});
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dd-sans",
  display: "swap",
});
const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dd-mono",
  display: "swap",
});

/**
 * The 5-Minute Winnability Test — interactive lead magnet (DP-TEST-01).
 *
 * A merchant answers 6 questions about one real dispute and gets two verdicts:
 * "was this winnable under Visa Compelling Evidence 3.0?" and "how close is my
 * store to the high-risk chargeback-ratio line?". The email gate sits between
 * the answers and the verdict — they've invested 5 minutes, so the ask converts.
 *
 * Faithful React port of the Claude Design prototype (Inbound GTM/Winnability
 * Test.html). All copy is intentionally English-only: this is a GTM funnel page,
 * served standalone at /test like the legal pages, not through next-intl.
 *
 * The single integration point is `submitLead()` → POST /api/winnability-lead.
 */

const LS = "dd_winnability_v1";

// Real destinations (from the DisputeDesk codebase). The install CTA deliberately
// routes to the on-site direct-install / free-trial popup at /#pricing (NOT the
// App Store) — see lib/marketing/shopifyInstallUrl.ts.
const URLS = {
  freeTrial: "/#pricing",
  demo: "/demo",
  contact: "/en/contact",
  playbook: "/en/playbook",
  video: "https://www.youtube.com/watch?v=k7TY52tFr5I",
};

type Tag = "win" | "kill" | "sure" | "other";
type Opt = { v: string; label: string; tag: Tag };
type Question = {
  id: string;
  q: string;
  help: string;
  opts?: Opt[];
  num?: boolean;
  placeholder?: string;
};

// tag: win = supports winnable, kill = disqualifies, sure = "not sure" flag, other = different lane
const QUESTIONS: Question[] = [
  {
    id: "reason",
    q: "What does the dispute say the reason is?",
    help: "This maps to the card-network reason code. Friendly fraud is the winnable lane.",
    opts: [
      { v: "ff", label: '<b>“I don’t recognise this charge”</b> / unauthorised (Visa 10.4)', tag: "win" },
      { v: "inr", label: '“Item not received” (13.1)', tag: "other" },
      { v: "nad", label: '“Not as described” / quality (13.3)', tag: "other" },
      { v: "fraud", label: "Genuine fraud — it really wasn’t the customer", tag: "kill" },
    ],
  },
  {
    id: "returning",
    q: "Has this customer bought from you before — without disputing it?",
    help: "Compelling Evidence 3.0 is built on a prior, undisputed transaction from the same shopper.",
    opts: [
      { v: "yes", label: "<b>Yes</b> — one or more prior clean orders", tag: "win" },
      { v: "no", label: "No — this was their first and only order", tag: "kill" },
      { v: "unsure", label: "Not sure", tag: "sure" },
    ],
  },
  {
    id: "window",
    q: "Was one of those prior orders within the last 120–365 days?",
    help: "CE 3.0 requires a qualifying prior transaction inside that look-back window.",
    opts: [
      { v: "yes", label: "<b>Yes</b> — within that window", tag: "win" },
      { v: "no", label: "No — older than ~12 months", tag: "kill" },
      { v: "unsure", label: "Not sure", tag: "sure" },
    ],
  },
  {
    id: "anchor",
    q: "Do you have an IP or device match between this order and a prior one?",
    help: "The decider. Name, email and address do NOT satisfy CE 3.0 — the anchor must be IP or device fingerprint.",
    opts: [
      { v: "yes", label: "<b>Yes</b> — IP or device matches a prior order", tag: "win" },
      { v: "weak", label: "Only name / email / shipping address match", tag: "kill" },
      { v: "none", label: "We don’t capture IP or device", tag: "kill" },
    ],
  },
  {
    id: "disputes",
    q: "Roughly how many disputes do you get per month?",
    help: "This feeds your chargeback-ratio risk gauge.",
    num: true,
    placeholder: "e.g. 8",
  },
  {
    id: "orders",
    q: "And roughly how many orders per month?",
    help: "Ratio = disputes ÷ orders. The danger line sits around 0.9% (Visa’s Dispute Monitoring Program).",
    num: true,
    placeholder: "e.g. 1200",
  },
];

type Answers = Record<string, string | number>;
type State = { screen: number; answers: Answers; email: string; store: string };

type Reason = ["ok" | "no", string];
type WinResult = {
  state: "win" | "borderline" | "no" | "other";
  headline: string;
  reasons: Reason[];
  lane: "ff" | "fraud" | "other";
};
type RatioBand = "green" | "amber" | "red" | "unknown";

function loadState(): State {
  if (typeof window !== "undefined") {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || "null");
      if (s && s.answers) return s as State;
    } catch {
      /* ignore */
    }
  }
  return { screen: 0, answers: {}, email: "", store: "" };
}

function scoreWinnability(a: Answers): WinResult {
  // Non-friendly-fraud reasons route out of the CE 3.0 lane.
  if (a.reason === "fraud")
    return {
      state: "no",
      headline: "Don’t fight this one.",
      reasons: [
        ["no", "This is genuine fraud — the customer didn’t make the purchase"],
        ["no", "Contesting true fraud hurts your win rate and your standing"],
      ],
      lane: "fraud",
    };
  if (a.reason === "inr" || a.reason === "nad")
    return {
      state: "other",
      headline: "Different rulebook.",
      reasons: [
        ["no", "This isn’t a friendly-fraud / “don’t recognise” dispute"],
        ["ok", "It can still be winnable — but on delivery / description evidence, not CE 3.0"],
      ],
      lane: "other",
    };

  // Friendly-fraud lane.
  const kills: Reason[] = [];
  const wins: Reason[] = [];
  let unsure = false;

  if (a.returning === "yes") wins.push(["ok", "Returning customer with prior clean orders"]);
  else if (a.returning === "no") kills.push(["no", "No prior order — CE 3.0 needs a transaction history"]);
  else unsure = true;

  if (a.window === "yes") wins.push(["ok", "A prior order falls inside the 120–365 day window"]);
  else if (a.window === "no") kills.push(["no", "Prior order is outside the eligible look-back window"]);
  else unsure = true;

  if (a.anchor === "yes") wins.push(["ok", "You have the IP / device anchor — the decisive match"]);
  else if (a.anchor === "weak") kills.push(["no", "Only name/email/address match — not enough for CE 3.0"]);
  else if (a.anchor === "none") kills.push(["no", "No IP / device captured — the anchor is missing"]);

  if (kills.length === 0 && !unsure) {
    return { state: "win", headline: "This one’s winnable.", reasons: wins, lane: "ff" };
  }
  if (kills.length === 0 && unsure) {
    return {
      state: "borderline",
      headline: "Closer than you think.",
      reasons: wins.concat([
        ["no", "A couple of unknowns to confirm — that gap is what loses winnable disputes"],
      ]),
      lane: "ff",
    };
  }
  return { state: "no", headline: "Not this one — here’s why.", reasons: kills.concat(wins), lane: "ff" };
}

function scoreRatio(a: Answers): { pct: number | null; band: RatioBand } {
  const d = Number(a.disputes) || 0;
  const o = Number(a.orders) || 0;
  if (o <= 0) return { pct: null, band: "unknown" };
  const pct = (d / o) * 100;
  let band: RatioBand = "green";
  if (pct >= 0.9) band = "red";
  else if (pct >= 0.65) band = "amber";
  return { pct, band };
}

function gaugeSVG(pct: number | null, band: RatioBand) {
  const size = 150,
    cx = size / 2,
    cy = size / 2,
    r = size * 0.4,
    start = 150,
    sweep = 240,
    max = 1.5;
  const danger = 0.9;
  const toXY = (deg: number, rad: number): [number, number] => {
    const ang = (deg * Math.PI) / 180;
    return [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  };
  const arc = (f: number, t: number, rad: number) => {
    const [x1, y1] = toXY(f, rad),
      [x2, y2] = toXY(t, rad);
    const lg = t - f > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${rad} ${rad} 0 ${lg} 1 ${x2} ${y2}`;
  };
  const v = pct == null ? 0 : Math.min(pct, max);
  const valDeg = start + (v / max) * sweep,
    dDeg = start + (danger / max) * sweep;
  const [nx, ny] = toXY(valDeg, r - 14);
  const [a1, b1] = toXY(dDeg, r - 20),
    [a2, b2] = toXY(dDeg, r + 18);
  const needleCol = band === "red" ? "#8a2a1f" : band === "amber" ? "#b06d12" : "#1f7a4d";
  return (
    <svg width={size} height={size * 0.8} viewBox={`0 0 ${size} ${size * 0.8}`} fill="none">
      <path d={arc(start, dDeg, r)} stroke="rgba(31,122,77,0.5)" strokeWidth={11} strokeLinecap="round" />
      <path d={arc(dDeg, start + sweep, r)} stroke="#8a2a1f" strokeWidth={11} strokeLinecap="round" />
      <line x1={a1} y1={b1} x2={a2} y2={b2} stroke="#0b1220" strokeWidth={2} />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleCol} strokeWidth={4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={8} fill={needleCol} />
    </svg>
  );
}

const Shield = () => (
  // Solid filled shield + white check — the brand app-icon treatment. Reads
  // clearly at small sizes (the thin blue outline was nearly invisible on the
  // cream topbar).
  <svg className="shield-sm" width="28" height="29" viewBox="0 0 100 104" fill="none" aria-label="DisputeDesk">
    <path
      d="M50 5 L88 19 C88 19 88 52 88 56 C88 80 71 95 50 101 C29 95 12 80 12 56 C12 52 12 19 12 19 Z"
      fill="#1d4ed8"
      stroke="#1d4ed8"
      strokeWidth="6"
      strokeLinejoin="round"
    />
    <path
      d="M34 53 L45 65 L68 39"
      stroke="#ffffff"
      strokeWidth="9"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function WinnabilityTest() {
  const [state, setState] = useState<State>(() => ({ screen: 0, answers: {}, email: "", store: "" }));
  const [hydrated, setHydrated] = useState(false);
  const numRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Restore any in-progress run after mount (avoids SSR/client hydration mismatch).
  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  const N = QUESTIONS.length;

  const { barPct, stepLabel } = useMemo(() => {
    let pct: number;
    let label: string;
    if (state.screen === 0) {
      pct = 4;
      label = "5-min test";
    } else if (state.screen <= N) {
      pct = (state.screen / (N + 1)) * 100;
      label = "Question " + state.screen + " / " + N;
    } else if (state.screen === N + 1) {
      pct = 100;
      label = "Last step";
    } else {
      pct = 100;
      label = "Your result";
    }
    return { barPct: Math.min(100, pct), stepLabel: label };
  }, [state.screen, N]);

  const go = useCallback((screen: number) => setState((s) => ({ ...s, screen })), []);

  const submitLead = useCallback((s: State) => {
    const payload = {
      email: s.email,
      store: s.store,
      answers: s.answers,
      winnability: scoreWinnability(s.answers).state,
      ratio: scoreRatio(s.answers).pct,
      ts: new Date().toISOString(),
    };
    try {
      localStorage.setItem("dd_last_lead", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    // Fire-and-forget — never block the verdict on the network.
    void fetch("/api/winnability-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, []);

  // Auto-focus the active input when entering number/email screens.
  useEffect(() => {
    if (state.screen >= 1 && state.screen <= N && QUESTIONS[state.screen - 1].num) {
      numRef.current?.focus();
    } else if (state.screen === N + 1) {
      emailRef.current?.focus();
    }
  }, [state.screen, N]);

  function renderIntro() {
    return (
      <div className="pane">
        <div className="kicker">Free · no account needed</div>
        <h1 className="big">
          Was that chargeback actually <em>winnable?</em>
        </h1>
        <p className="intro-p">
          Most Shopify merchants write off disputes they could have won — and have no idea how close they are
          to being flagged “high-risk” by Shopify Payments.
        </p>
        <p className="intro-p">
          Answer 6 quick questions about <b>one recent dispute</b>. We’ll tell you whether it was winnable
          under Visa’s Compelling Evidence 3.0 — and show you where your chargeback ratio really sits.
        </p>
        <div className="intro-meta">
          <div>
            <b>~5 min</b>6 questions
          </div>
          <div>
            <b>Instant</b>verdict + risk gauge
          </div>
          <div>
            <b>Free</b>no card, no account
          </div>
        </div>
        <button className="btn btn-primary btn-big" onClick={() => go(1)}>
          Start the test →
        </button>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <a
            href={URLS.video}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              letterSpacing: "0.04em",
              color: "var(--ink-4)",
              textDecoration: "none",
            }}
          >
            ▶ New here? Watch the 2-min intro
          </a>
        </div>
        <p className="disclaimer">
          Educational tool, not legal or financial advice. Thresholds reflect Visa’s published Dispute
          Monitoring Program.
        </p>
      </div>
    );
  }

  function renderQuestion(i: number) {
    const Q = QUESTIONS[i];
    const cur = state.answers[Q.id];

    if (Q.num) {
      const val = cur != null ? String(cur) : "";
      const ok = val !== "" && Number(val) >= 0;
      const commit = () => {
        const next = { ...state, answers: { ...state.answers, [Q.id]: val === "" ? 0 : Number(val) }, screen: state.screen + 1 };
        setState(next);
      };
      return (
        <div className="pane">
          <div className="qnum">
            Question {i + 1} of {N}
          </div>
          <div className="qtext">{Q.q}</div>
          <div className="qhelp">{Q.help}</div>
          <div className="numrow">
            <div className="numfield">
              <input
                ref={numRef}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder={Q.placeholder || ""}
                value={val}
                onChange={(e) =>
                  setState((s) => ({ ...s, answers: { ...s.answers, [Q.id]: e.target.value } }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ok) commit();
                }}
              />
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => go(state.screen - 1)}>
              ← Back
            </button>
            <button className="btn btn-primary" disabled={!ok} onClick={commit}>
              Continue →
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="pane">
        <div className="qnum">
          Question {i + 1} of {N}
        </div>
        <div className="qtext">{Q.q}</div>
        <div className="qhelp">{Q.help}</div>
        <div className="opts">
          {Q.opts!.map((o) => (
            <button
              key={o.v}
              className={"opt" + (cur === o.v ? " sel" : "")}
              onClick={() => {
                setState((s) => ({ ...s, answers: { ...s.answers, [Q.id]: o.v } }));
                setTimeout(() => go(state.screen + 1), 220);
              }}
            >
              <span className="tick" />
              <span dangerouslySetInnerHTML={{ __html: o.label }} />
            </button>
          ))}
        </div>
        <div className="actions">
          {i === 0 ? (
            <span />
          ) : (
            <button className="btn btn-ghost" onClick={() => go(state.screen - 1)}>
              ← Back
            </button>
          )}
          <span />
        </div>
      </div>
    );
  }

  function renderEmail() {
    const valid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    const reveal = () => {
      const next = { ...state, screen: state.screen + 1 };
      submitLead(next);
      setState(next);
    };
    return (
      <div className="pane">
        <div className="kicker">One last step</div>
        <h1 className="big" style={{ fontSize: 32 }}>
          Where should we send your <em>result?</em>
        </h1>
        <p className="intro-p" style={{ fontSize: 15 }}>
          We’ll show your verdict on the next screen and email you a copy — plus the exact checklist to make
          your next dispute winnable.
        </p>
        <div className="emailfield" style={{ marginTop: 18 }}>
          <input
            ref={emailRef}
            type="email"
            placeholder="you@yourstore.com"
            value={state.email}
            onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid(state.email)) reveal();
            }}
          />
        </div>
        <div className="emailfield" style={{ marginTop: 10 }}>
          <input
            type="text"
            placeholder="yourstore.com (optional)"
            value={state.store}
            onChange={(e) => setState((s) => ({ ...s, store: e.target.value }))}
          />
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => go(state.screen - 1)}>
            ← Back
          </button>
          <button className="btn btn-primary" disabled={!valid(state.email)} onClick={reveal}>
            See my result →
          </button>
        </div>
        <p className="consent">
          We’ll email your result and occasional chargeback tips. Unsubscribe anytime. No spam, no sharing.
        </p>
      </div>
    );
  }

  function renderResult() {
    const w = scoreWinnability(state.answers);
    const ratio = scoreRatio(state.answers);
    const bandColor = { green: "#1f7a4d", amber: "#b06d12", red: "#8a2a1f", unknown: "#64748b" }[ratio.band];
    const bandText = {
      green: "Safe — for now",
      amber: "Approaching the line",
      red: "In the danger zone",
      unknown: "Add numbers to see",
    }[ratio.band];
    const bandDesc = {
      green: "Comfortably under the ~0.9% threshold. Keep winning the winnable ones.",
      amber: "This is where most merchants sit — and don’t realise it. Worth acting before it climbs.",
      red: "At or over the line. You may already be on a monitoring program. Act now.",
      unknown: "We couldn’t compute a ratio from your numbers.",
    }[ratio.band];

    const verdictStyle = {
      win: ["rgba(31,122,77,0.16)", "#1f7a4d", "Winnable"],
      borderline: ["rgba(176,109,18,0.18)", "#b06d12", "Borderline"],
      no: ["rgba(138,42,31,0.18)", "#8a2a1f", "Not winnable"],
      other: ["rgba(37,99,235,0.14)", "#1d4ed8", "Different lane"],
    }[w.state];

    // CTA per state — each points at a real page that delivers on the promise.
    type Cta = { h: string; p: string; primary: { label: string; href: string }; secondary?: { label: string; href: string } };
    let cta: Cta;
    if (w.state === "win")
      cta = {
        h: "Let’s win it.",
        p: "You’ve got the anchor. DisputeDesk builds the evidence pack and files it for you — start free, no card.",
        primary: { label: "Start free — fight this dispute →", href: URLS.freeTrial },
        secondary: { label: "Or have us review it with you", href: URLS.contact },
      };
    else if (w.state === "borderline")
      cta = {
        h: "Let’s confirm it.",
        p: "A couple of unknowns to nail down. Send us the details — chat, email, or a quick call — and we’ll tell you definitively.",
        primary: { label: "Get it checked →", href: URLS.contact },
        secondary: { label: "Or see how DisputeDesk works", href: URLS.demo },
      };
    else if (w.state === "other")
      cta = {
        h: "Still worth a look.",
        p: "Item-not-received and quality disputes win on different evidence — and DisputeDesk builds those packs too. See it, or send us this one.",
        primary: { label: "Watch the 2-min demo →", href: URLS.demo },
        secondary: { label: "Or send us this dispute", href: URLS.contact },
      };
    else if (w.lane === "fraud")
      cta = {
        h: "This one’s not yours to fight.",
        p: "Genuine fraud should be refunded — contesting it hurts your standing. But strong checkout data helps you spot and stop the next one.",
        primary: { label: "See how DisputeDesk helps →", href: URLS.demo },
        secondary: { label: "Talk it through with us", href: URLS.contact },
      };
    else
      cta = {
        h: "Make the next one winnable.",
        p: "The fix is upstream: DisputeDesk captures IP + device on every order automatically, so your next dispute has the anchor this one was missing.",
        primary: { label: "Start free — start capturing →", href: URLS.freeTrial },
        secondary: { label: "Or read the 2-minute setup", href: URLS.playbook },
      };

    return (
      <div className="pane">
        <div className="verdict-band" style={{ background: verdictStyle[0], color: verdictStyle[1] }}>
          ● {verdictStyle[2]}
        </div>
        <h1 className="big" style={{ fontSize: 34 }}>
          {w.headline}
        </h1>
        <ul className="reasons">
          {w.reasons.map((r, idx) => (
            <li key={idx}>
              <span className={"mk " + r[0]}>{r[0] === "ok" ? "✓" : "✕"}</span>
              {r[1]}
            </li>
          ))}
        </ul>

        <div className="gauge-wrap">
          <div>{gaugeSVG(ratio.pct, ratio.band)}</div>
          <div className="read">
            <div className="lab">Your chargeback ratio</div>
            <div className="big" style={{ color: bandColor }}>
              {ratio.pct == null ? "—" : ratio.pct.toFixed(2) + "%"}
            </div>
            <div className="desc">
              <b style={{ color: bandColor }}>{bandText}.</b> {bandDesc}
            </div>
          </div>
        </div>

        <div className="cta-box">
          <h3>{cta.h}</h3>
          <p>{cta.p}</p>
          <a className="btn btn-primary btn-big" href={cta.primary.href} target="_blank" rel="noopener noreferrer">
            {cta.primary.label}
          </a>
          {cta.secondary ? (
            <a className="cta-sec" href={cta.secondary.href} target="_blank" rel="noopener noreferrer">
              {cta.secondary.label} →
            </a>
          ) : null}
        </div>
        <div className="restart">
          <button onClick={() => setState((s) => ({ screen: 0, answers: {}, email: s.email, store: s.store }))}>
            ↻ Test another dispute
          </button>
        </div>
        <p className="disclaimer">
          Indicative only, based on your answers. A real dispute review may surface evidence this quick test
          can’t. Thresholds reflect Visa’s published Dispute Monitoring Program; Shopify Payments operates
          under the card-network rules.
        </p>
      </div>
    );
  }

  let pane: React.ReactNode;
  if (state.screen === 0) pane = renderIntro();
  else if (state.screen <= N) pane = renderQuestion(state.screen - 1);
  else if (state.screen === N + 1) pane = renderEmail();
  else pane = renderResult();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={`dd-wt ${serif.variable} ${sans.variable} ${mono.variable}`}>
        <div className="wrap">
          <div className="shell">
            <div className="topbar">
              <div className="brand">
                <Shield />
                <span className="name">DISPUTEDESK</span>
              </div>
              <span className="step-count">{stepLabel}</span>
            </div>
            <div className="progress">
              <i style={{ width: barPct + "%" }} />
            </div>
            {pane}
          </div>
        </div>
      </div>
    </>
  );
}

// Verbatim port of the prototype's CSS, scoped under `.dd-wt` so the immersive
// page styles never leak into the rest of the site.
const CSS = `
.dd-wt {
  --bg-start: #0f172a; --bg-mid: #1e293b; --bg-end: #334155;
  --cream: #f4eee2; --paper: #fbf7ee; --paper-2: #f4ecdd;
  --ink: #0b1220; --ink-2: #233045; --ink-3: #475569; --ink-4: #64748b;
  --line-ink: rgba(11,18,32,0.12); --line-on-blue: rgba(244,238,226,0.20);
  --blue-400: #60a5fa; --blue-600: #2563eb; --blue-700: #1d4ed8;
  --wax: #8a2a1f; --success: #1f7a4d; --amber: #b06d12;
  --serif: var(--font-dd-serif), "Crimson Pro", Georgia, serif; --sans: var(--font-dd-sans), "Inter", system-ui, sans-serif; --mono: var(--font-dd-mono), "Spline Sans Mono", ui-monospace, monospace;
  font-family: var(--sans); color: var(--ink);
  background: linear-gradient(160deg, var(--bg-start) 0%, var(--bg-mid) 48%, var(--bg-end) 100%);
  background-color: var(--bg-start); min-height: 100vh;
  -webkit-font-smoothing: antialiased; line-height: 1.5;
  display: flex; align-items: center; justify-content: center; padding: 28px 18px;
}
.dd-wt * { box-sizing: border-box; }
.dd-wt .wrap { width: 100%; max-width: 620px; }
.dd-wt .shell { background-color: var(--paper); border: 1px solid var(--ink); border-radius: 4px;
  background-image: radial-gradient(rgba(27,20,16,0.022) 1px, transparent 1px); background-size: 20px 20px;
  overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,0.4); }
.dd-wt .topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 22px; border-bottom: 1px solid var(--line-ink); }
.dd-wt .brand { display: flex; align-items: center; gap: 11px; }
.dd-wt .brand .name { font-family: var(--mono); font-size: 13px; font-weight: 600; letter-spacing: 0.14em; color: var(--ink); }
.dd-wt .step-count { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; color: var(--ink-4); }
.dd-wt .progress { height: 3px; background: rgba(11,18,32,0.08); }
.dd-wt .progress > i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--blue-600), var(--blue-400));
  transition: width 0.4s cubic-bezier(.4,0,.2,1); }
.dd-wt .pane { padding: 40px 40px 36px; }
@media (max-width: 540px) { .dd-wt .pane { padding: 30px 24px; } }
.dd-wt .kicker { font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--blue-700); margin-bottom: 16px; }
.dd-wt .qnum { font-family: var(--mono); font-size: 12px; color: var(--blue-700); letter-spacing: 0.06em; margin-bottom: 12px; }
.dd-wt h1.big { font-family: var(--serif); font-weight: 700; font-size: 40px; line-height: 1.12; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 18px; }
.dd-wt h1.big em { font-style: italic; color: var(--wax); }
.dd-wt .qtext { font-family: var(--serif); font-weight: 600; font-size: 27px; line-height: 1.16; letter-spacing: -0.01em; color: var(--ink); margin: 0 0 6px; }
.dd-wt .qhelp { font-size: 14px; line-height: 1.5; color: var(--ink-3); margin: 0 0 22px; }
.dd-wt .intro-p { font-size: 16px; line-height: 1.6; color: var(--ink-2); margin: 0 0 14px; }
.dd-wt .intro-meta { display: flex; gap: 30px; margin: 24px 0 30px; flex-wrap: wrap; }
.dd-wt .intro-meta div { font-size: 13px; color: var(--ink-3); line-height: 1.4; }
.dd-wt .intro-meta b { display: block; font-family: var(--serif); font-size: 22px; color: var(--ink); font-weight: 600; white-space: nowrap; margin-bottom: 3px; }
.dd-wt .opts { display: flex; flex-direction: column; gap: 10px; }
.dd-wt .opt { text-align: left; width: 100%; background: #fff; border: 1px solid rgba(11,18,32,0.18); border-radius: 6px;
  padding: 16px 18px; font-size: 15.5px; color: var(--ink-2); cursor: pointer; font-family: var(--sans);
  display: flex; align-items: center; gap: 14px; transition: all 0.14s; line-height: 1.35; }
.dd-wt .opt:hover { border-color: var(--blue-600); background: #fff; transform: translateX(3px); box-shadow: -3px 0 0 var(--blue-600); }
.dd-wt .opt .tick { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid rgba(11,18,32,0.25); flex-shrink: 0; position: relative; transition: all 0.14s; }
.dd-wt .opt:hover .tick { border-color: var(--blue-600); }
.dd-wt .opt.sel { border-color: var(--blue-700); background: rgba(96,165,250,0.08); }
.dd-wt .opt.sel .tick { border-color: var(--blue-700); background: var(--blue-700); }
.dd-wt .opt.sel .tick::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; }
.dd-wt .opt b { color: var(--ink); font-weight: 600; }
.dd-wt .numrow { display: flex; flex-direction: column; gap: 14px; }
.dd-wt .numfield label { font-size: 13px; color: var(--ink-3); display: block; margin-bottom: 7px; }
.dd-wt .numfield input { width: 100%; font-family: var(--mono); font-size: 20px; color: var(--ink); background: #fff;
  border: 1px solid rgba(11,18,32,0.22); border-radius: 6px; padding: 14px 16px; outline: none; }
.dd-wt .numfield input:focus { border-color: var(--blue-600); box-shadow: 0 0 0 3px rgba(96,165,250,0.18); }
.dd-wt .emailfield input { width: 100%; font-family: var(--sans); font-size: 17px; color: var(--ink); background: #fff;
  border: 1px solid rgba(11,18,32,0.22); border-radius: 6px; padding: 15px 16px; outline: none; }
.dd-wt .emailfield input:focus { border-color: var(--blue-600); box-shadow: 0 0 0 3px rgba(96,165,250,0.18); }
.dd-wt .consent { font-size: 12px; color: var(--ink-4); margin-top: 14px; line-height: 1.5; }
.dd-wt .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 28px; }
.dd-wt .btn { font-family: var(--sans); font-size: 15px; font-weight: 600; padding: 13px 24px; border-radius: 6px; cursor: pointer; border: none; transition: all 0.15s; display: inline-flex; align-items: center; gap: 9px; }
.dd-wt .btn-primary { background: var(--blue-700); color: #fff; }
.dd-wt .btn-primary:hover { background: var(--blue-600); }
.dd-wt .btn-primary:disabled { background: rgba(11,18,32,0.16); color: rgba(11,18,32,0.4); cursor: not-allowed; }
.dd-wt .btn-ghost { background: transparent; color: var(--ink-3); padding: 13px 8px; }
.dd-wt .btn-ghost:hover { color: var(--ink); }
.dd-wt .btn-big { width: 100%; justify-content: center; font-size: 16px; padding: 16px; }
.dd-wt a.btn-big { text-decoration: none; }
.dd-wt .verdict-band { display: inline-flex; align-items: center; gap: 9px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 13px; border-radius: 4px; margin-bottom: 18px; }
.dd-wt .gauge-wrap { display: flex; align-items: center; gap: 22px; margin: 22px 0; padding: 20px; background: #fff; border: 1px solid var(--line-ink); border-radius: 8px; }
@media (max-width: 540px) { .dd-wt .gauge-wrap { flex-direction: column; text-align: center; } }
.dd-wt .gauge-wrap .read { flex: 1; }
.dd-wt .gauge-wrap .read .lab { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-4); }
.dd-wt .gauge-wrap .read .big { font-family: var(--serif); font-size: 34px; font-weight: 700; line-height: 1.05; margin: 4px 0; }
.dd-wt .gauge-wrap .read .desc { font-size: 13px; color: var(--ink-3); line-height: 1.45; }
.dd-wt .reasons { list-style: none; padding: 0; margin: 16px 0; }
.dd-wt .reasons li { font-size: 14.5px; line-height: 1.5; color: var(--ink-2); padding: 9px 0 9px 28px; position: relative; border-top: 1px solid var(--line-ink); }
.dd-wt .reasons li:first-child { border-top: none; }
.dd-wt .reasons li .mk { position: absolute; left: 0; top: 9px; font-family: var(--mono); font-weight: 700; }
.dd-wt .reasons li .mk.ok { color: var(--success); }
.dd-wt .reasons li .mk.no { color: var(--wax); }
.dd-wt .cta-box { margin-top: 22px; padding: 22px; border-radius: 8px; background: linear-gradient(135deg, #0f172a, #1e293b); color: var(--cream); }
.dd-wt .cta-box h3 { font-family: var(--serif); font-size: 22px; font-weight: 600; margin: 0 0 8px; color: var(--cream); }
.dd-wt .cta-box p { font-size: 14px; line-height: 1.55; color: rgba(244,238,226,0.78); margin: 0 0 16px; }
.dd-wt .cta-box .btn-primary { background: var(--blue-600); }
.dd-wt .cta-box .btn-primary:hover { background: var(--blue-400); color: var(--ink); }
.dd-wt .cta-sec { display: block; text-align: center; margin-top: 13px; font-size: 13px; color: rgba(244,238,226,0.7); text-decoration: none; font-weight: 500; }
.dd-wt .cta-sec:hover { color: var(--cream); text-decoration: underline; }
.dd-wt .restart { text-align: center; margin-top: 18px; }
.dd-wt .restart button { background: none; border: none; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(244,238,226,0.5); cursor: pointer; }
.dd-wt .restart button:hover { color: var(--cream); }
.dd-wt .disclaimer { margin-top: 16px; font-size: 11.5px; color: var(--ink-4); line-height: 1.5; font-style: italic; font-family: var(--serif); }
.dd-wt .shield-sm { flex-shrink: 0; }
`;
