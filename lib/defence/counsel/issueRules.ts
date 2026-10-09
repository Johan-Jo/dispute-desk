/**
 * A stable rule id for every issue the counsel checks and the reviewer raise.
 *
 * The issues themselves stay strings: they are what the correction prompt is
 * given, word for word, and that text does not change here. This file reads
 * a rule id, the part of the letter and a fixed description off each string,
 * so the reason a letter was withheld can be STORED and COUNTED
 * (`defence_packages.validation_errors`, `failure_signature`). Before this the
 * reason went to `console.warn` only and was gone with the day's logs.
 *
 * The stored message is the rule's description, never the issue text: an
 * issue quotes the rejected draft, and `validation_errors` is returned to the
 * merchant's browser.
 *
 * A new `issues.push` in checks.ts must be given a rule here; the test
 * (`issueRules.test.ts`) pins the number of producers and classifies a sample
 * of each, so one added without a rule fails the build.
 */

import { LINT } from "./checks";

export interface CounselIssueRecord {
  rule: string;
  section: string;
  message: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

/** `lint.<name>` for each LINT entry, in LINT's order. */
export const LINT_RULE_IDS: readonly string[] = LINT.map(([, name]) => `lint.${slug(name.split(/[:(]/)[0])}`);

const LINT_BY_NAME = new Map(LINT.map(([, name], i) => [name, LINT_RULE_IDS[i]]));

/** The part of the letter an issue names, with the prefix removed. */
function splitSection(issue: string): { section: string; body: string } {
  const truth = issue.match(/^truth \(([^)]*)\): /);
  if (truth) return { section: truth[1], body: issue };
  const soft = issue.startsWith("length: ") ? issue.slice("length: ".length) : issue;
  const m = soft.match(/^(summary|conclusion|shipping|lineItems|chronology|policy): ([\s\S]*)$/);
  if (m) return { section: m[1], body: m[2] };
  return { section: "letter", body: soft };
}

/** [test on the issue body, rule id, description]. First match wins. */
const RULES: ReadonlyArray<[RegExp, string, string]> = [
  // First: a reviewer finding quotes the letter and may contain any phrase below.
  [/^fact-check: /, "review.fact_check", "The reviewer found a sentence the ledger does not support."],
  [/^unclear: /, "review.unclear", "The reviewer found a sentence unclear."],
  [/^shape: section ".*" is not in the playbook/, "shape.unknown_section", "A section the brief does not have."],
  [/^shape: section ".*" appears twice/, "shape.duplicate_section", "A section written twice."],
  [/^unknown claim "/, "shape.unknown_claim", "A claim id that is not in the ledger."],
  [/is not a specific of any ledger claim$/, "grounding.unsupported_specific", "A date or number no ledger claim holds."],
  [/^copy: ".*" is already printed on the page/, "copy.page_identifier", "An identifier the page already prints."],
  [/^copy: the tracking URL is already printed/, "copy.tracking_url", "The tracking URL repeated in the text."],
  [/^copy: a time of day/, "copy.time_of_day", "A time of day."],
  [/^copy: ".*" is named \d+ times \(at most once\)/, "copy.merchant_named_twice", "The merchant named more than once."],
  [/^copy: the carrier's name /, "copy.carrier_named", "The carrier named in the text."],
  [/^\d+ words, the limit is \d+/, "length.summary", "The summary is over its word limit."],
  [/^must end with the request: /, "shape.missing_request", "The summary does not end with the request."],
  [/misnames this proceeding/, "truth.wrong_proceeding", "The proceeding is called by the wrong name."],
  [/^english: the product's store title/, "language.store_title", "The product's store title in the text."],
  [/^english: non-English characters/, "language.characters", "Non-English characters."],
  [/^english: non-English word/, "language.word", "A non-English word."],
  [/^copy: the recorded absence appears \d+ times/, "copy.absence_repeated", "The recorded absence stated more than once."],
  [/^the recorded absence shares a sentence with a timing clause/, "truth.absence_with_timing", "The recorded absence beside a timing clause."],
  [/^breaks the limit "/, "truth.brief_limit", "A sentence outside the brief's limits."],
  [/^returns are written by code/, "copy.returns_in_summary", "Returns mentioned in the summary."],
  [/the records do not show the whole order in one shipment/, "truth.whole_order", "The whole order claimed without the record for it."],
  [/^copy: ".*" is used \d+ times; at most twice/, "copy.phrase_repeated", "A distinctive phrase used more than twice."],
  [/^copy: ".*" is used \d+ times \(.*\); once only/, "copy.specific_repeated", "A date or number stated more than once."],
  [/the timeline and the table print BELOW the text/, "copy.exhibit_position", "An exhibit placed above the text."],
];

/** The rule, part and fixed description for one issue string. */
export function classifyIssue(issue: string): CounselIssueRecord {
  const { section, body } = splitSection(issue);
  if (/^(?:fact-check|unclear): /.test(body)) {
    const [, rule, message] = RULES.find(([re]) => re.test(body))!;
    return { rule, section, message };
  }
  if (issue.startsWith("truth (")) {
    return { rule: "truth.validator", section, message: "The production validator rejected a section." };
  }
  for (const [name, id] of LINT_BY_NAME) {
    if (body.startsWith(`${name} — "`)) return { rule: id, section, message: `Style rule: ${name.split(/[:(]/)[0].trim()}.` };
  }
  for (const [re, rule, message] of RULES) {
    if (re.test(body)) return { rule, section, message };
  }
  return { rule: "unclassified", section, message: "An issue with no rule id (add it to issueRules.ts)." };
}

/** Rule ids as the signature counts them: every style rule is one "lint",
 *  so two letters withheld for the same cause do not land in different groups
 *  because of which adjective each one used. `validation_errors` keeps the
 *  exact rules. */
export function signatureRules(records: readonly CounselIssueRecord[]): string[] {
  return [...new Set(records.map((r) => (r.rule.startsWith("lint.") ? "lint" : r.rule)))];
}

/** Issues as stored records: one per rule and part, in first-seen order. */
export function issueRecords(issues: readonly string[]): CounselIssueRecord[] {
  const seen = new Set<string>();
  const out: CounselIssueRecord[] = [];
  for (const i of issues) {
    const r = classifyIssue(i);
    const k = `${r.rule}|${r.section}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
