/**
 * Every issue the counsel checks and the reviewer can raise has a stable rule
 * id, so the reason a letter was withheld is stored and counted
 * (`validation_errors`, `failure_signature`) instead of going to a log that is
 * kept for a day (2026-10-09: 25 `no_counsel_letter` packages, 13 of them with
 * no recoverable reason).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINT } from "../checks";
import { classifyIssue, issueRecords, LINT_RULE_IDS, signatureRules } from "../issueRules";

/** One real-shaped issue string per producer in checks.ts and generate.ts. */
const SAMPLES: Array<[issue: string, rule: string, section: string]> = [
  ['shape: section "returns" is not in the playbook', "shape.unknown_section", "letter"],
  ['shape: section "shipping" appears twice', "shape.duplicate_section", "letter"],
  ['summary: unknown claim "made_up"', "shape.unknown_claim", "summary"],
  ['conclusion: "fifty" is not a specific of any ledger claim', "grounding.unsupported_specific", "conclusion"],
  ['copy: "#4898" is already printed on the page', "copy.page_identifier", "letter"],
  ["copy: the tracking URL is already printed", "copy.tracking_url", "letter"],
  ["copy: a time of day", "copy.time_of_day", "letter"],
  ['copy: "Hem & Trend" is named 2 times (at most once)', "copy.merchant_named_twice", "letter"],
  ['copy: the carrier\'s name "DHL" appears in the text; write "the carrier"', "copy.carrier_named", "letter"],
  ["summary: 104 words, the limit is 80 — rewrite it to about 65 words. Name the item", "length.summary", "summary"],
  ["length: summary: 92 words, the limit is 90 — rewrite it to about 75 words. Name the item", "length.summary", "summary"],
  ['summary: must end with the request: "The merchant requests that Klarna close this dispute in the merchant\'s favour."', "shape.missing_request", "summary"],
  ['shipping: "chargeback" misnames this proceeding; call it "the dispute" and the person "the customer"', "truth.wrong_proceeding", "shipping"],
  ['summary: english: the product\'s store title ("Solar Wandleuchte") — call it "the item"', "language.store_title", "summary"],
  ["lineItems: english: non-English characters (ä ß)", "language.characters", "lineItems"],
  ['summary: english: non-English word "und"', "language.word", "summary"],
  ["copy: the recorded absence appears 2 times; state it once", "copy.absence_repeated", "letter"],
  ['shipping: the recorded absence shares a sentence with a timing clause — "No return was recorded within 30 days."', "truth.absence_with_timing", "shipping"],
  ['policy: breaks the limit "No statement about authentication" — "3-D Secure"', "truth.brief_limit", "policy"],
  ["summary: returns are written by code in the Delivery and return section; remove every mention of returns from the summary", "copy.returns_in_summary", "summary"],
  ['summary: "the complete order" — the records do not show the whole order in one shipment; say "the order"', "truth.whole_order", "summary"],
  ['copy: "same four digits" is used 3 times; at most twice', "copy.phrase_repeated", "letter"],
  ['copy: "3 july" is used 2 times (summary, conclusion); once only — elsewhere refer to the event ("the delivery", "that order")', "copy.specific_repeated", "letter"],
  ['chronology: "timeline above" — the timeline and the table print BELOW the text; say "the timeline below" or just "the timeline"', "copy.exhibit_position", "chronology"],
  ["truth (executiveSummary): Section claims delivery but no delivery fact is approved.", "truth.validator", "executiveSummary"],
  ['fact-check: "The shipment card records its delivery." — The ledger holds no delivery.', "review.fact_check", "letter"],
  ['unclear: "It was that order." — rewrite it plainly', "review.unclear", "letter"],
];

describe("counsel issue rules", () => {
  it("gives every producer's issue a rule id and the part it names", () => {
    for (const [issue, rule, section] of SAMPLES) {
      expect(classifyIssue(issue), issue).toMatchObject({ rule, section });
    }
  });

  it("classifies every lint rule to its own id", () => {
    expect(new Set(LINT_RULE_IDS).size).toBe(LINT.length);
    LINT.forEach(([, name], i) => {
      const got = classifyIssue(`summary: ${name} — "some matched words"`);
      expect(got.rule, name).toBe(LINT_RULE_IDS[i]);
      expect(got.section).toBe("summary");
    });
  });

  it("stores the rule's description, never the rejected sentence", () => {
    const [r] = issueRecords(['fact-check: "The customer is lying about the parcel." — no ledger claim']);
    expect(r.message).not.toMatch(/lying|parcel/);
    for (const [issue] of SAMPLES) {
      const quoted = issue.match(/"([^"]{12,})"/)?.[1];
      if (quoted) expect(classifyIssue(issue).message).not.toContain(quoted);
    }
  });

  it("classes a reviewer finding as the reviewer's, whatever it quotes", () => {
    expect(classifyIssue('fact-check: "It arrived 14 days later." — "14" is not a specific of any ledger claim').rule).toBe("review.fact_check");
    expect(classifyIssue('unclear: "See the timeline above." — the timeline and the table print BELOW the text').rule).toBe("review.unclear");
  });

  it("counts every style rule as one in the signature", () => {
    const recs = issueRecords(['summary: meta-talk — "notably"', 'conclusion: banned word — "baseless"', 'fact-check: "x" — y']);
    expect(recs).toHaveLength(3);
    expect(signatureRules(recs)).toEqual(["lint", "review.fact_check"]);
  });

  it("keeps one record per rule and part", () => {
    const recs = issueRecords([
      'copy: "3 july" is used 2 times (summary, conclusion); once only — elsewhere refer to the event ("the delivery", "that order")',
      'copy: "22 august" is used 2 times (summary, conclusion); once only — elsewhere refer to the event ("the delivery", "that order")',
      'conclusion: "fifty" is not a specific of any ledger claim',
    ]);
    expect(recs.map((r) => `${r.section}:${r.rule}`)).toEqual(["letter:copy.specific_repeated", "conclusion:grounding.unsupported_specific"]);
  });

  /* A producer added to checks.ts without a rule here would be stored as
   * "unclassified". The count is pinned so that adding one fails this test
   * until SAMPLES (and RULES) cover it. */
  it("pins the number of issue producers in checks.ts", () => {
    const src = readFileSync(join(__dirname, "..", "checks.ts"), "utf8");
    expect(src.match(/issues\.push\(/g)?.length).toBe(26);
    expect(SAMPLES.every(([issue]) => classifyIssue(issue).rule !== "unclassified")).toBe(true);
  });
});
