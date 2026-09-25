/**
 * Counsel v2 orchestration (plan 4 §1):
 *   ledger → STRATEGIST → WRITER ×N → CHECKS + FACT-CHECK
 *   (+ up to two surgical correction rounds each) → JUDGE → best passing
 *   draft, or null (the caller falls back to the record-built template, so a
 *   safe letter always files).
 *
 * The model call is injected, so the same code runs in the pipeline
 * (Anthropic client), the eval harness and the staging pilot.
 */

import { checkDraft, type CheckContext } from "./checks";
import { factCheckPrompt, judgePrompt, strategistPrompt, writerPrompt } from "./prompts";
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

/** The first complete JSON object in a model reply (models sometimes add a
 *  second block or commentary after it). String-aware brace matching. */
export function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in model output: ${raw.slice(0, 200)}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(raw.slice(start, i + 1)) as T;
  }
  throw new Error(`unterminated JSON object in model output: ${raw.slice(0, 200)}`);
}

/** The letter as the analyst sees it, for the fact-checker and the judge. */
export function letterForJudge(d: CounselDraft, pageContext: string): string {
  const titles: Record<string, string> = {
    shipping: "Shipping & Delivery (next to a shipment card: carrier, tracking number, shipped and delivered dates, tracking link)",
    lineItems: "Order Line Items (under the table of items and total)",
    chronology: "Chronology of Events (above a dated timeline of order events)",
  };
  return [
    `PAGE HEADER AND CASE DETAILS (printed above the letter):\n${pageContext}`,
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

const CORRECTION_ROUNDS = 2;

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
  const n = args.candidates ?? 5;

  const sp = strategistPrompt(args.ledger, args.playbook, args.pageContext, args.merchantName);
  const plan = parseJson<StrategyPlan>(await args.call({ ...sp, temperature: 0.3, maxTokens: 3000 }));
  log(`strategist: ${plan.theoryChosen} — ${plan.theoryOfTheCase}`);

  const wp = writerPrompt(args.ledger, args.playbook, plan, args.pageContext, args.merchantName);

  // Code checks first; when they pass, the model fact-check (relations,
  // sequence, intent) — a true number on the wrong interval passes code.
  // Sections the playbook does not carry are dropped, not failed.
  const allowed = new Set(args.playbook.sections.map((s) => s.key));
  const normalize = (d: CounselDraft): CounselDraft => ({
    ...d,
    evidenceSections: (d.evidenceSections ?? []).filter((s) => allowed.has(s.key)),
    conclusion: { paragraphs: [], claimIds: [] },
  });

  const allIssues = async (d: CounselDraft): Promise<string[]> => {
    const code = checkDraft(d, args.check);
    if (code.length) return code;
    const fc = factCheckPrompt(args.ledger, letterForJudge(d, args.pageContext));
    const res = parseJson<{ errors?: Array<{ sentence: string; problem: string }> }>(
      await args.call({ ...fc, temperature: 0, maxTokens: 1500 }),
    );
    return (res.errors ?? []).map((e) => `fact-check: "${e.sentence}" — ${e.problem}`);
  };

  const candidates = await Promise.all(
    Array.from({ length: n }, async (_, i): Promise<CounselCandidate> => {
      let draft = normalize(parseJson<CounselDraft>(await args.call({ ...wp, temperature: 0.7, maxTokens: 3000 })));
      const firstIssues = await allIssues(draft);
      let issues = firstIssues;
      let retried = false;
      // Surgical corrections: change only what was flagged, keep the rest.
      for (let round = 0; round < CORRECTION_ROUNDS && issues.length; round++) {
        retried = true;
        const user = [
          wp.user,
          `YOUR PREVIOUS DRAFT FAILED THESE CHECKS:\n- ${issues.join("\n- ")}`,
          "Return the previous draft UNCHANGED except for the smallest edits that fix these problems. " +
            "Copy every sentence that was not flagged word for word. Do not add new sentences, dates or numbers.",
          `PREVIOUS DRAFT:\n${JSON.stringify(draft, null, 2)}`,
        ].join("\n\n");
        draft = normalize(parseJson<CounselDraft>(await args.call({ system: wp.system, user, temperature: 0.2, maxTokens: 3000 })));
        issues = await allIssues(draft);
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
  // A sentence the analyst had to read twice disqualifies the draft.
  const clear = passing.filter((c) => (c.verdict?.unclearSentences ?? []).length === 0);
  const best = clear.sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return { plan, candidates, best };
}
