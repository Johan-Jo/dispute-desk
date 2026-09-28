/**
 * Counsel v2 orchestration (cost refactor, docs/plans/counsel-v2-cost-refactor.plan.md):
 *
 *   ledger → theory (code) + sections and conclusion (code, recordSections.ts)
 *          → SUMMARY (model) → checks (code) → REVIEW (model, one call)
 *          → at most ONE correction of the summary, checked and reviewed again
 *          → the letter, or `ok: false` (the caller falls back to the
 *            record-built template, so a safe letter always files).
 *
 * 2 calls when the first summary passes, 3–4 when it needs the correction.
 * The model call is injected, so the same code runs in the pipeline
 * (Anthropic client) and the offline eval harness.
 */

import { checkDraft, type CheckContext } from "./checks";
import { correctionUserPrompt, REVIEW_SYSTEM, reviewUserPrompt, SUMMARY_SYSTEM, summaryUserPrompt } from "./prompts";
import { buildRecordSections, pickTheory, recordSectionsText, type Theory } from "./recordSections";
import type { CounselDraft, LedgerClaim, Playbook } from "./types";

export type CounselStage = "write" | "review" | "correction";

export type ModelCall = (req: {
  stage: CounselStage;
  /** Static across cases for "write" and "correction" (sent as a cached block). */
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}) => Promise<string>;

export interface CounselResult {
  theory: Theory;
  draft: CounselDraft;
  /** Issues on the first summary (code checks, then review). */
  firstIssues: string[];
  /** Issues on the letter returned; empty when ok. */
  issues: string[];
  corrected: boolean;
  ok: boolean;
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

/** The letter as the analyst sees it, for the offline judge. */
export function letterForJudge(d: CounselDraft, pageContext: string, withRequestLine = true): string {
  const titles: Record<string, string> = {
    shipping: "Shipping & Delivery (next to a shipment card: carrier, tracking number, shipped and delivered dates, tracking link)",
    lineItems: "Order Line Items (under the table of items and total)",
    chronology: "Chronology of Events (above a dated timeline of order events)",
  };
  return [
    `PAGE HEADER AND CASE DETAILS (printed above the letter):\n${pageContext}`,
    `SUMMARY:\n${d.summary.paragraphs.join("\n\n")}`,
    ...d.evidenceSections.map((s) => `${titles[s.key] ?? s.key}:\n${s.paragraphs.join("\n\n")}`),
    `CONCLUSION:\n${d.conclusion.paragraphs.join("\n\n")}` +
      (withRequestLine ? `\n[fixed request line follows: "The merchant respectfully requests reversal of the chargeback."]` : ""),
  ].join("\n\n");
}

/** A summary paragraph list from the model's reply, whatever its shape. */
function summaryFrom(raw: string): { paragraphs: string[]; claimIds: string[] } {
  const r = parseJson<{ summary?: unknown; claimIds?: unknown }>(raw);
  const s = r.summary;
  const paragraphs = (Array.isArray(s) ? s : typeof s === "string" ? [s] : [])
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
  const claimIds = Array.isArray(r.claimIds) ? r.claimIds.filter((x): x is string => typeof x === "string") : [];
  return { paragraphs, claimIds };
}

/** The letter from a summary and the code-written parts. */
export function composeDraft(
  summary: { paragraphs: string[]; claimIds: string[] },
  record: ReturnType<typeof buildRecordSections>,
): CounselDraft {
  return { summary, evidenceSections: record.evidenceSections, conclusion: record.conclusion };
}

export async function writeCounselLetter(args: {
  ledger: readonly LedgerClaim[];
  playbook: Playbook;
  merchantName: string;
  pageContext: string;
  check: CheckContext;
  call: ModelCall;
  log?: (msg: string) => void;
}): Promise<CounselResult> {
  const log = args.log ?? (() => {});
  const theory = pickTheory(args.ledger, args.playbook);
  const record = buildRecordSections(args.ledger);
  const recordText = recordSectionsText(record);
  const caseUser = summaryUserPrompt({
    ledger: args.ledger,
    theory,
    recordText,
    pageContext: args.pageContext,
    merchantName: args.merchantName,
  });
  log(`theory: ${theory.name}`);

  // Code checks first; only a draft that passes them is worth a review call.
  const issuesOf = async (draft: CounselDraft): Promise<string[]> => {
    const code = checkDraft(draft, args.check);
    if (code.length) return code;
    const res = parseJson<{
      errors?: Array<{ sentence?: string; problem?: string }>;
      unclear?: Array<{ sentence?: string; problem?: string }>;
    }>(
      await args.call({
        stage: "review",
        system: REVIEW_SYSTEM,
        user: reviewUserPrompt(args.ledger, draft.summary.paragraphs, recordText),
        temperature: 0,
        maxTokens: 800,
      }),
    );
    return [
      ...(res.errors ?? []).map((e) => `fact-check: "${e.sentence ?? ""}" — ${e.problem ?? ""}`),
      ...(res.unclear ?? []).map((e) => `unclear: "${e.sentence ?? ""}" — ${e.problem ?? "rewrite it plainly"}`),
    ];
  };

  const first = summaryFrom(
    await args.call({ stage: "write", system: SUMMARY_SYSTEM, user: caseUser, temperature: 0.4, maxTokens: 600 }),
  );
  let draft = composeDraft(first, record);
  const firstIssues = await issuesOf(draft);
  let issues = firstIssues;
  let corrected = false;

  if (issues.length) {
    // One surgical correction; if it fails too, the template writer files.
    corrected = true;
    const fixed = summaryFrom(
      await args.call({
        stage: "correction",
        system: SUMMARY_SYSTEM,
        user: correctionUserPrompt(caseUser, first.paragraphs, issues),
        temperature: 0.2,
        maxTokens: 800,
      }),
    );
    draft = composeDraft(fixed, record);
    issues = await issuesOf(draft);
  }
  log(`first ${firstIssues.length} issue(s)${corrected ? `, after correction ${issues.length}` : ""}`);
  return { theory, draft, firstIssues, issues, corrected, ok: issues.length === 0 };
}
