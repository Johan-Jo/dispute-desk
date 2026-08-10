/**
 * CP-A — `deadline_only` merchant copy (plan §4.1).
 *
 * The test that matters is the LAST one: `deadline_only` and
 * `withheld_no_safe_argument` must be distinguishable in words, not merely in
 * a badge tone. Both read as "not sent yet" on a status chip, and the
 * difference between them is whether anything will ever reach the issuer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  deadlineFilingCopy,
  resolveDeadlineFilingState,
  type DeadlineFilingState,
} from "../deadlineOnlyCopy";
import { REVIEW_REASON_FALLBACK_TOKEN } from "@/lib/evidence/model/merchantProjection";

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf-8"),
  );
}

function lookup(cat: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = cat;
  for (const part of dotted.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const ALL_STATES: DeadlineFilingState[] = [
  { kind: "normal" },
  { kind: "deadline_only", itemCount: 1 },
  { kind: "deadline_only", itemCount: 3 },
  { kind: "withheld_no_safe_argument" },
];

describe("deadlineFilingCopy — tokens only", () => {
  it("emits no English — lib/** may not resolve copy", () => {
    for (const state of ALL_STATES) {
      const copy = deadlineFilingCopy(state);
      for (const token of [copy.titleToken, copy.bodyToken, copy.actionToken]) {
        if (!token) continue;
        expect(token.key).toMatch(/^disputes\.deadlineOnly\./);
        // A key, not a sentence. The cheapest detector for a literal that
        // slipped in: real copy has spaces, keys do not.
        expect(token.key).not.toMatch(/\s/);
      }
    }
  });

  it("passes itemCount as a PARAM so each locale pluralises in its own grammar", () => {
    // "1 item / 2 items" is an English rule. Interpolating a formatted
    // fragment in `lib/` would export English grammar to five catalogs.
    const copy = deadlineFilingCopy({ kind: "deadline_only", itemCount: 3 });
    expect(copy.bodyToken.params).toEqual({ itemCount: 3 });
    expect(copy.actionToken?.params).toEqual({ itemCount: 3 });
  });
});

describe("deadline_only vs withheld_no_safe_argument — the distinction, in words", () => {
  it("uses DIFFERENT keys for every slot", () => {
    const held = deadlineFilingCopy({ kind: "deadline_only", itemCount: 1 });
    const withheld = deadlineFilingCopy({ kind: "withheld_no_safe_argument" });
    expect(held.titleToken.key).not.toBe(withheld.titleToken.key);
    expect(held.bodyToken.key).not.toBe(withheld.bodyToken.key);
    expect(held.actionToken?.key).not.toBe(withheld.actionToken?.key);
  });

  it("states the filing OUTCOME explicitly so no surface infers it from tone", () => {
    // Inferring "will it file?" from the wording is how the auto-pilot hold
    // came to read as "please review".
    expect(deadlineFilingCopy({ kind: "normal" }).filingOutcome).toBe("adding_now");
    expect(deadlineFilingCopy({ kind: "deadline_only", itemCount: 1 }).filingOutcome).toBe(
      "scheduled_for_deadline",
    );
    expect(deadlineFilingCopy({ kind: "withheld_no_safe_argument" }).filingOutcome).toBe(
      "not_adding",
    );
  });

  it("deadline_only is SCHEDULED, never promised", () => {
    /* The field was `willFile: boolean` and `deadline_only` set it `true`.
     * That is an unconditional promise about the future, and the product
     * cannot make one: at the deadline P-6 is evaluated again from scratch,
     * and a stale plan, a superseded package, a new hard block or an ambiguous
     * pair each still refuses. A boolean cannot express "scheduled", so it
     * expressed "will", and every reader inherited the promise.
     *
     * Pinned three ways: the value is its own member, it is NOT the same
     * member as the ordinary path, and no member is a boolean. */
    const held = deadlineFilingCopy({ kind: "deadline_only", itemCount: 1 });
    expect(held.filingOutcome).not.toBe("adding_now");
    expect(held.filingOutcome).not.toBe("not_adding");
    expect(typeof held.filingOutcome).toBe("string");
    // Guard the guard: a two-member union would let a reader recover the
    // boolean by negation. There are three, and the middle one is the point.
    const outcomes = new Set(
      ALL_STATES.map((st) => deadlineFilingCopy(st).filingOutcome),
    );
    expect(outcomes.size).toBe(3);
  });

  it("the held state names the merchant's lever; the normal state has none to name", () => {
    expect(deadlineFilingCopy({ kind: "deadline_only", itemCount: 2 }).actionToken).not.toBeNull();
    expect(deadlineFilingCopy({ kind: "withheld_no_safe_argument" }).actionToken).not.toBeNull();
    expect(deadlineFilingCopy({ kind: "normal" }).actionToken).toBeNull();
  });
});

describe("resolveDeadlineFilingState", () => {
  it("no-safe-argument OUTRANKS deadline_only", () => {
    // A plan can be both: the review_required exclusion is what removed the
    // last supporting fact. Telling the merchant it will be sent at the
    // deadline would be false.
    expect(
      resolveDeadlineFilingState({
        deadlineOnly: true,
        noSafeArgument: "all_support_excluded",
        reviewItemCount: 1,
      }),
    ).toEqual({ kind: "withheld_no_safe_argument" });
  });

  it("carries the review item count through", () => {
    expect(
      resolveDeadlineFilingState({ deadlineOnly: true, noSafeArgument: null, reviewItemCount: 2 }),
    ).toEqual({ kind: "deadline_only", itemCount: 2 });
  });

  it("is `normal` when nothing is held", () => {
    expect(
      resolveDeadlineFilingState({ deadlineOnly: false, noSafeArgument: null, reviewItemCount: 0 }),
    ).toEqual({ kind: "normal" });
  });

  it("reads the PLAN only — no strength or completeness input exists to read", () => {
    // A weak-but-safe case still files; a strong case whose only support was
    // excluded does not. Deriving filing from a band would invert both.
    expect(resolveDeadlineFilingState.length).toBe(1);
  });
});

describe("locale coverage — all six", () => {
  const keys = [
    ...new Set(
      ALL_STATES.flatMap((state) => {
        const copy = deadlineFilingCopy(state);
        return [copy.titleToken.key, copy.bodyToken.key, copy.actionToken?.key].filter(
          (k): k is string => typeof k === "string",
        );
      }),
    ),
    REVIEW_REASON_FALLBACK_TOKEN,
  ];

  it("guard the guard — the key list is non-trivial", () => {
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });

  for (const locale of LOCALES) {
    it(`${locale}: every key resolves to a non-empty string`, () => {
      const cat = catalog(locale);
      for (const key of keys) {
        const value = lookup(cat, key);
        expect(typeof value, `${locale} missing ${key}`).toBe("string");
        expect((value as string).length, `${locale} empty ${key}`).toBeGreaterThan(0);
      }
    });

    it(`${locale}: the plural body actually declares plural forms`, () => {
      // A locale that dropped the ICU plural would render "3 item needs your
      // confirmation" — the kind of miss a parity check (key exists) cannot
      // catch.
      const body = lookup(catalog(locale), "disputes.deadlineOnly.held.body") as string;
      expect(body).toContain("{itemCount, plural,");
      expect(body).toContain("other {");
    });
  }

  it("no locale reuses one string for both filing outcomes", () => {
    for (const locale of LOCALES) {
      const cat = catalog(locale);
      expect(
        lookup(cat, "disputes.deadlineOnly.held.title"),
        `${locale} renders "will send" and "will not send" identically`,
      ).not.toBe(lookup(cat, "disputes.deadlineOnly.withheld.title"));
      expect(lookup(cat, "disputes.deadlineOnly.held.body")).not.toBe(
        lookup(cat, "disputes.deadlineOnly.withheld.body"),
      );
    }
  });
});
