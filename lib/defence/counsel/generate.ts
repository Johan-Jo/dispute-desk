/**
 * Counsel v2 orchestration (plan 4 §1):
 *   ledger → STRATEGIST → WRITER ×N → CHECKS (+1 corrective retry each)
 *   → JUDGE → best passing draft, or null (the caller falls back to the
 *   record-built template, so a safe letter always files).
 *
 * The model call is injected, so the same code runs in the pipeline
 * (Anthropic client), the eval harness and the staging pilot.
 */

import { checkDraft, type CheckContext } from "./checks";
import { judgePrompt, strategistPrompt, writerPrompt } from "./prompts";
import type { CounselDraft, JudgeVerdict, LedgerClaim, Playbook, StrategyPlan } from "./types";

export type ModelCall = (req: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}) => Promise<string>;

export interface CounselCandidate {
  draft: CounselDraft;
  firstIssues: string[];
  issues: string[];
  retried: boolean;
  verdict: JudgeVerdict | null;
}

export interface CounselResult {
  plan: StrategyPlan;
  candidates: CounselCandidate[];
  best: CounselCandidate | null;
}

export function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON object in model output: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/** The letter as the analyst sees it, for the judge. */
export function letterForJudge(d: CounselDraft, pageContext: string): string {
  const titles: Record<string, string> = {
    shipping: "Shipping & Delivery (next to a shipment card: carrier, tracking number, shipped and delivered dates, tracking link)",
    lineItems: "Order Line Items (under the table of items and total)",
    chronology: "Chronology of Events (above a dated timeline of order events)",
  };
  return [
    `PAGE HEADER AND CASE DETAILS (printed above the letter):\n${pageContext}`,
    `HEADLINE (pull-quote): ${d.headline}`,
    `SUMMARY:\n${d.summary.paragraphs.join("\n\n")}`,
    ...d.evidenceSections.map((s) => `${titles[s.key] ?? s.key}:\n${s.paragraphs.join("\n\n")}`),
    `CONCLUSION:\n${d.conclusion.paragraphs.join("\n\n")}\n[fixed request line follows: "The merchant respectfully requests reversal of the chargeback."]`,
  ].join("\n\n");
}

function rank(c: CounselCandidate): number {
  const v = c.verdict;
  if (!v) return -1;
  const s = v.scores;
  return (
    (v.decisionAfterSummaryOnly === "merchant" ? 100 : 0) +
    (v.decisionAfterFullLetter === "merchant" ? 50 : 0) +
    (s.punchline + s.clarity + s.evidenceUse + s.noRepetition + s.credibility) * 2 -
    v.redFlags.length * 3
  );
}

export async function writeCounselLetter(args: {
  ledger: readonly LedgerClaim[];
  playbook: Playbook;
  merchantName: string;
  pageContext: string;
  check: CheckContext;
  call: ModelCall;
  candidates?: number;
  log?: (msg: string) => void;
}): Promise<CounselResult> {
  const log = args.log ?? (() => {});
  const n = args.candidates ?? 3;

  const sp = strategistPrompt(args.ledger, args.playbook, args.pageContext, args.merchantName);
  const plan = parseJson<StrategyPlan>(await args.call({ ...sp, temperature: 0.3, maxTokens: 3000 }));
  log(`strategist: ${plan.theoryChosen} — ${plan.theoryOfTheCase}`);

  const wp = writerPrompt(args.ledger, args.playbook, plan, args.pageContext, args.merchantName);
  const candidates = await Promise.all(
    Array.from({ length: n }, async (_, i): Promise<CounselCandidate> => {
      let raw = await args.call({ ...wp, temperature: 0.7, maxTokens: 3000 });
      let draft = parseJson<CounselDraft>(raw);
      const firstIssues = checkDraft(draft, args.check);
      let issues = firstIssues;
      let retried = false;
      if (issues.length) {
        retried = true;
        raw = await args.call({
          system: wp.system,
          user: `${wp.user}\n\nYOUR PREVIOUS DRAFT FAILED THESE CHECKS. Fix every one; keep everything that was not flagged.\n- ${issues.join("\n- ")}\n\nPREVIOUS DRAFT:\n${raw}`,
          temperature: 0.4,
          maxTokens: 3000,
        });
        draft = parseJson<CounselDraft>(raw);
        issues = checkDraft(draft, args.check);
      }
      log(`candidate ${i + 1}: first ${firstIssues.length} issue(s), final ${issues.length}`);
      return { draft, firstIssues, issues, retried, verdict: null };
    }),
  );

  const passing = candidates.filter((c) => c.issues.length === 0);
  await Promise.all(
    passing.map(async (c) => {
      const jp = judgePrompt(letterForJudge(c.draft, args.pageContext));
      c.verdict = parseJson<JudgeVerdict>(await args.call({ ...jp, temperature: 0, maxTokens: 1500 }));
    }),
  );
  const best = passing.sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return { plan, candidates, best };
}
