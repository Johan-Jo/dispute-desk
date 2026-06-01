"use client";

import { useState } from "react";
import {
  buildNurtureSequence,
  type NurtureEmail,
} from "@/lib/marketing/playbook/nurtureSequence";

/**
 * Internal reference UI for the CE 3.0 Email Course — an expandable view of all
 * five nurture emails, ported from the GTM design bundle's `nurture-app.jsx`.
 * noindex; for the team to review copy. Reads from the same `nurtureSequence`
 * module the cron uses, so this can't drift from what's actually sent.
 */

// Placeholder links here are illustrative (this is a preview, not a live send).
const SEQUENCE: NurtureEmail[] = buildNurtureSequence({
  playbookUrl: "disputedesk.app/playbook/read",
  calUrl: "cal.com/disputedesk",
  installUrl: "disputedesk.app",
});

function SignBlock({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div
          key={i}
          style={
            i === 0
              ? { color: "#233045" }
              : { fontSize: 14, fontStyle: "italic", marginTop: 10, color: "#64748b" }
          }
        >
          {line}
        </div>
      ))}
    </>
  );
}

function EmailCard({
  email,
  open,
  onToggle,
}: {
  email: NurtureEmail;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={"nm-email" + (open ? " nm-open" : "")}>
      <div className="nm-rail">
        <div className="nm-rail-num">{String(email.step).padStart(2, "0")}</div>
        <div className="nm-rail-line" />
      </div>
      <div className="nm-main">
        <div
          className="nm-head"
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <div className="nm-left">
            <div className="nm-meta">
              <span className="nm-send">{email.send}</span>
              {email.trigger !== "—" && <span className="nm-trig">· {email.trigger}</span>}
              <span className="nm-teach">{email.teaches}</span>
            </div>
            <div className="nm-subject">{email.subject}</div>
            <div className="nm-preview">{email.preview}</div>
          </div>
          <div className="nm-toggle">{open ? "–" : "+"}</div>
        </div>
        {open && (
          <div className="nm-body">
            <div className="nm-goal">
              <span>Goal</span>
              {email.goal}
            </div>
            <div className="nm-mail">
              <div className="nm-field">
                <span className="nm-fl">Subject</span>
                <span className="nm-fv">{email.subject}</span>
              </div>
              <div className="nm-field">
                <span className="nm-fl">Preview</span>
                <span className="nm-fv nm-pv">{email.preview}</span>
              </div>
              <div className="nm-divider" />
              <div className="nm-copy">
                {email.body.map((b, i) =>
                  b.t === "sign" ? (
                    <div className="nm-sign" key={i}>
                      <SignBlock text={b.c} />
                    </div>
                  ) : (
                    <p key={i}>{b.c}</p>
                  ),
                )}
                <div className="nm-cta">{email.cta.label} →</div>
                <div className="nm-cta-url">{email.cta.href}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NurtureSequenceViewer() {
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true });
  const allOpen = SEQUENCE.every((e) => open[e.step]);
  const toggle = (n: number) => setOpen((o) => ({ ...o, [n]: !o[n] }));
  const toggleAll = () => {
    if (allOpen) setOpen({});
    else setOpen(Object.fromEntries(SEQUENCE.map((e) => [e.step, true])));
  };

  return (
    <div className="nm-root">
      <header className="nm-masthead">
        <div className="nm-mh-top">
          <div className="nm-mh-eyebrow">
            <span>§</span> Nurture Sequence · Automated
          </div>
          <div className="nm-mh-code">DP-EM-01 · 5 emails · 14 days</div>
        </div>
        <h1 className="nm-mh-title">
          The CE 3.0 <em>email course</em>
        </h1>
        <p className="nm-mh-lede">
          Five emails that turn a Playbook download into a booked teardown. Each one
          teaches a single liability-shift concept and ties it to a DisputeDesk
          capability — education <em>is</em> the funnel. Click any email to read the
          full draft copy. This is an internal reference; the live sends come from the
          nurture cron.
        </p>
        <div className="nm-mh-actions">
          <button onClick={toggleAll}>{allOpen ? "Collapse all" : "Expand all"}</button>
          <div className="nm-cadence">
            {SEQUENCE.map((e) => (
              <div className="nm-node" key={e.step} onClick={() => toggle(e.step)}>
                <div className={"nm-dot" + (open[e.step] ? " nm-on" : "")}>{e.step}</div>
                <div className="nm-day">
                  {e.send
                    .replace("Immediately on signup", "Day 0")
                    .replace("Day ", "D")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="nm-emails">
        {SEQUENCE.map((e) => (
          <EmailCard
            key={e.step}
            email={e}
            open={!!open[e.step]}
            onToggle={() => toggle(e.step)}
          />
        ))}
      </div>

      <p className="nm-footnote">
        Copy is the single source of truth for the nurture cron. Editing it changes
        what real leads receive — keep the Cal and Playbook links current.
        § DisputeDesk · DP-EM-01.
      </p>
    </div>
  );
}
