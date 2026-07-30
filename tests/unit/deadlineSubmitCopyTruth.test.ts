/**
 * The deadline cron and the copy that describes it must not drift apart.
 *
 * WHAT WENT WRONG. The Auto-pilot card said "Everything else waits for your
 * review." It does not. Under auto mode `evaluateAutoSubmitGuards` either
 * `park`s (Moderate) or `block`s (Weak, Insufficient, fatal-loss) — and BOTH
 * leave `defence_packages` at `status='draft'`,
 * `validation_status='ok'` with a `pdf_path`
 * (lib/jobs/handlers/buildDefencePackageJob.ts). At 08:00 UTC on the due date
 * the deadline cron flips exactly that shape to `final` and submits it. So the
 * held case is not waiting for a merchant; it is waiting for a clock.
 *
 * The mirror defect: "Submit on the deadline" (review_state = 'approved') did
 * nothing, because the approve handler never clears `needs_review` and the
 * cron excluded that status. A merchant who reviewed and approved forfeited by
 * default.
 *
 * Neither is detectable by the i18n scripts — `verify-i18n-parity.mjs` checks
 * that a key EXISTS, never that it is true — so the guard has to live here,
 * pinned against the route's own source.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");

const CRON = readFileSync(
  resolve(ROOT, "app/api/cron/defence-package-deadline-submit/route.ts"),
  "utf8",
);

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), "utf8"));
}

function leaf(obj: unknown, path: string): string | undefined {
  const v = path.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
  return typeof v === "string" ? v : undefined;
}

/** Every leaf string in a catalog, keyed by dotted path. */
function allLeaves(obj: unknown, prefix = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[prefix, obj]];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    allLeaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

// ─── A. The cron's escape hatches, pinned ──────────────────────────────────

describe("deadline cron — what can and cannot escape submission", () => {
  it("submits every merchant-actionable status, and those four only", () => {
    // Widening this list widens who gets auto-submitted. It must be a
    // deliberate edit that lands here first.
    const block = CRON.slice(
      CRON.indexOf("const merchantActionableStatuses"),
      CRON.indexOf("const { data: disputes"),
    );
    for (const status of ["new", "in_progress", "ready_to_submit", "action_needed"]) {
      expect(block, `missing status ${status}`).toContain(`"${status}"`);
    }
    // `needs_review` must NOT be in the list: review mode is a hard gate.
    expect(block).not.toContain('"needs_review"');
  });

  it("conceded is the only review_state that stops a submission", () => {
    const exclusions = CRON.match(/review_state\s*===\s*"([a-z_]+)"/g) ?? [];
    expect(exclusions).toEqual(['review_state === "conceded"']);
  });

  it("an approved dispute is INCLUDED, so 'Submit on the deadline' is real", () => {
    // The approve handler (app/api/disputes/[id]/review/route.ts) writes
    // review_state but never clears needs_review, so without this inclusion an
    // approved review-mode dispute is excluded by status and never submitted —
    // the button promises a submission that never happens.
    expect(CRON).toMatch(/review_state\.eq\.approved/);
  });

  it("only a finished, validated package is auto-finalized", () => {
    const branch = CRON.slice(
      CRON.indexOf("// Draft or stale with validation=ok"),
      CRON.indexOf("summary.enqueuedAutoFinalize"),
    );
    expect(branch).toContain('dpkg!.status === "draft"');
    expect(branch).toContain('dpkg!.status === "stale"');
    expect(branch).toContain('dpkg!.validation_status === "ok"');
    expect(branch).toContain("dpkg!.pdf_path");
  });
});

// ─── B. Auto-pilot copy must name the deadline ─────────────────────────────

/**
 * The three strings a merchant reads when CHOOSING auto-pilot. Each must say
 * that held cases still go to Shopify on the due date. Presence of the word is
 * a weak proxy for truthfulness, but it is a strong proxy for "someone thought
 * about the deadline when writing this".
 */
const AUTO_PILOT_KEYS = [
  "rules.modeAutoDesc",
  "rules.explainerBullet2",
  "setup.handling.setupSummaryModeAuto",
];

const DEADLINE_TERM: Record<string, RegExp> = {
  en: /due date|deadline/i,
  de: /Frist|Fälligkeit/i,
  es: /fecha límite|plazo/i,
  fr: /date limite|échéance/i,
  pt: /prazo|data limite/i,
  sv: /förfallodag|sista dag|deadline/i,
};

describe("auto-pilot copy tells the merchant about the deadline", () => {
  for (const locale of LOCALES) {
    for (const key of AUTO_PILOT_KEYS) {
      it(`${locale}: ${key} names the due date and Shopify`, () => {
        const value = leaf(messages(locale), key);
        expect(value, `${locale}: ${key} missing`).toBeTruthy();
        // The deadline is the whole point: without it the sentence implies a
        // human decision that is never actually required.
        expect(value).toMatch(DEADLINE_TERM[locale]);
        // "submit" without a destination reads as the card network, which
        // DisputeDesk never does. See CLAUDE.md.
        expect(value).toMatch(/Shopify/);
      });
    }
  }
});

// ─── C. Absolute promises are allow-listed ─────────────────────────────────

/**
 * Only three contexts can honestly promise that nothing is ever sent:
 *   - Shopify Protect — lib/defence/enqueue.ts returns a `skipped` row with no
 *     pdf_path, so the cron's finalize branch can never match it.
 *   - A conceded dispute — the cron's one explicit escape.
 *   - Review mode / the high-value safeguard — needs_review keeps it out of the
 *     cron's status filter entirely.
 * Anywhere else, "never submits" is a promise the deadline breaks.
 */
const ABSOLUTE_PROMISE =
  /never submit|never sent|nothing is (sent|submitted|saved)|these never/i;

/**
 * A qualifier that makes the promise true. "Nothing is saved unless you
 * approve it" is false on its own and true when scoped to review mode, so the
 * guard looks at the SENTENCE, not the whole string — a long help article may
 * legitimately contain both a scoped absolute and unrelated prose.
 */
/**
 * `Review everything` is the mode's actual UI label, and the one merchant copy
 * naturally reaches for. The list carried only the internal phrasing "review
 * mode", so a correctly-scoped absolute written in the merchant's vocabulary
 * tripped the guard (2026-07-30, the approving-disputes article). Naming the
 * label is the fix — not loosening the pattern.
 */
const QUALIFIER =
  /review mode|Review everything|Shopify Protect|don't defend|conceded?|approve it/i;

const ALLOWED_ABSOLUTE = new Set([
  "rules.alwaysReviewedCovered",
  "rules.modeReviewDesc",
  "setup.handling.setupSummaryModeReview",
  // A DIFFERENT promise, and it holds: negative pre-authorization screening
  // facts are never included in the bank-facing evidence. That is evidence
  // inclusion, not dispute submission — enforced at both the payload and the
  // prompt layer. Its table-row formatting defeats sentence splitting.
  "help.articles.fraudRiskScreening.body",
  "help.embedded.articles.fraudRiskScreening.body",
]);

/** The sentences of `value` that make an absolute promise without qualifying it. */
function unqualifiedAbsolutes(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => ABSOLUTE_PROMISE.test(sentence) && !QUALIFIER.test(sentence));
}

describe("absolute 'never submits' promises are confined to where they hold", () => {
  it("no English string claims a submission never happens without qualifying it", () => {
    const offenders = allLeaves(messages("en"))
      .filter(([path]) => !ALLOWED_ABSOLUTE.has(path))
      .flatMap(([path, value]) =>
        unqualifiedAbsolutes(value).map((s) => `${path}: ${s.slice(0, 110)}`),
      );
    expect(offenders, `unqualified absolute promise:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ─── D. The escape must be NAMED, not gestured at ──────────────────────────

/**
 * The auto-pilot copy used to end "…saved to Shopify on the due date if you
 * haven't decided." That names the wrong escape.
 *
 * A held dispute sits in one of four `review_state`s, and THREE of them end in
 * submission: null (never opened), `in_review` (Hold & watch), `approved`
 * (Submit on the deadline). Only `conceded` is excluded — see
 * `blocksAutoSubmit` in lib/disputes/reviewState.ts and the cron's `:122`
 * guard. So deciding does not stop the filing; exactly one decision does.
 *
 * A merchant who clicks Hold & watch has decided, and still gets a submission.
 *
 * The guard asserts the copy contains the concede button's OWN label, read
 * from the same catalog. That ties the sentence to a control the merchant can
 * see on screen, and means renaming the button fails this test until the
 * explanatory copy follows it.
 */
const CONCEDE_LABEL_KEY = "disputes.overviewExtra.review.concede";
const NAMES_ESCAPE_KEYS = ["rules.modeAutoDesc", "setup.handling.setupSummaryModeAuto"];

describe("auto-pilot copy names the one decision that stops a filing", () => {
  for (const locale of LOCALES) {
    const label = leaf(messages(locale), CONCEDE_LABEL_KEY);

    it(`${locale}: the concede label exists to be referenced`, () => {
      expect(label, `${locale}: ${CONCEDE_LABEL_KEY} missing`).toBeTruthy();
    });

    for (const key of NAMES_ESCAPE_KEYS) {
      it(`${locale}: ${key} names "${label}" rather than a vague decision`, () => {
        const value = leaf(messages(locale), key);
        expect(value, `${locale}: ${key} missing`).toBeTruthy();
        expect(
          value,
          `${locale}: ${key} must name the concede action ("${label}"), ` +
            `because approving and holding are also decisions and BOTH still submit`,
        ).toContain(label!);
      });
    }
  }
});

// ─── E. Conceding withholds OUR package, not the filing ────────────────────

/**
 * `concedeHelp` said "We won't submit anything. The dispute closes
 * undefended." DisputeDesk cannot produce that state.
 *
 * When no evidence is submitted by the due date, Shopify auto-compiles the
 * order data it holds and files that itself, and the Admin GraphQL API exposes
 * no accept/concede mutation to stop it (`ShopifyPaymentsDispute` has only
 * `disputeEvidenceUpdate`). Accepting a chargeback exists solely as a manual
 * button in Shopify Admin. So conceding withholds our defence package; it does
 * not withhold the filing.
 *
 * Naming Shopify is the load-bearing assertion — a sentence that says what we
 * won't do without saying what Shopify still does is the false version.
 */
describe("concede copy does not promise a filing that cannot be stopped", () => {
  const NOTHING_AT_ALL: Record<string, RegExp> = {
    en: /submit anything|send anything|nothing (is|will be) (sent|submitted)/i,
    de: /nichts ein|nichts gesendet|nichts übermittelt/i,
    es: /no enviaremos nada|nada se envía/i,
    fr: /n'envoyons rien|n'enverrons rien|rien ne sera envoyé/i,
    pt: /não enviaremos nada|nada será enviado/i,
    sv: /inte in något|inget skickas/i,
  };

  for (const locale of LOCALES) {
    it(`${locale}: concedeHelp scopes the promise to our package and names Shopify`, () => {
      const value = leaf(messages(locale), "disputes.overviewExtra.review.concedeHelp");
      expect(value, `${locale}: concedeHelp missing`).toBeTruthy();
      expect(
        value,
        `${locale}: concedeHelp claims nothing at all is filed. Shopify files ` +
          `its own scraped order data when we file none, and no API can stop it`,
      ).not.toMatch(NOTHING_AT_ALL[locale]);
      expect(
        value,
        `${locale}: concedeHelp must say what Shopify still does`,
      ).toMatch(/Shopify/);
    });
  }
});

// ─── F. The split mode copy cannot drift from the full string ──────────────

/**
 * `Onboarding Handling Step.dc.html` renders each mode card as a LEAD sentence
 * plus a footnote below a dashed rule, so the wizard reads `modeAutoLead` +
 * `modeAutoNote`. /app/rules still renders the single `modeAutoDesc`.
 *
 * Two renderings of one sentence is a drift factory: someone corrects the card
 * and leaves the Automation page saying the old thing, or vice versa — exactly
 * how "if you haven't decided" survived in two places at once. These assert the
 * lead is literally the opening of the full description, and that the note
 * carries the concede escape (section D's requirement, for the surface that
 * actually shows the note).
 */
describe("wizard mode copy stays in lockstep with the Automation page copy", () => {
  for (const locale of LOCALES) {
    it(`${locale}: modeAutoLead is the opening of modeAutoDesc`, () => {
      const lead = leaf(messages(locale), "rules.modeAutoLead");
      const desc = leaf(messages(locale), "rules.modeAutoDesc");
      expect(lead, `${locale}: rules.modeAutoLead missing`).toBeTruthy();
      expect(desc, `${locale}: rules.modeAutoDesc missing`).toBeTruthy();
      expect(
        desc!.startsWith(lead!),
        `${locale}: the wizard card and the Automation page would open differently`,
      ).toBe(true);
    });

    it(`${locale}: modeReviewLead equals modeReviewDesc`, () => {
      expect(leaf(messages(locale), "rules.modeReviewLead")).toBe(
        leaf(messages(locale), "rules.modeReviewDesc"),
      );
    });

    it(`${locale}: modeAutoNote names the concede escape and the deadline`, () => {
      const note = leaf(messages(locale), "rules.modeAutoNote");
      const label = leaf(messages(locale), CONCEDE_LABEL_KEY);
      expect(note, `${locale}: rules.modeAutoNote missing`).toBeTruthy();
      // The wizard shows ONLY the note under the dashed rule, so it — not just
      // the combined string — has to carry both facts.
      expect(note).toContain(label!);
      expect(note).toMatch(DEADLINE_TERM[locale]);
      expect(note).toMatch(/Shopify/);
    });
  }
});

// ─── G. Inaction has a consequence, and every surface must name it ─────────

/**
 * The last three surfaces that told a merchant a decision was needed without
 * saying what happens when they don't make one.
 *
 * In REVIEW mode `disputeEffectsDispatcher` sets `needs_review=true`, which
 * puts the dispute outside the deadline cron's status filter permanently — so
 * DisputeDesk submits nothing, ever. Shopify then files the order data it
 * scraped when the deadline passes. "Still requires your decision" describes
 * that as an open question; it is actually a countdown to a filing the
 * merchant never sees.
 *
 * Each assertion is anchored on naming Shopify, because a sentence about what
 * WE won't do, without what Shopify still does, is the version that misleads.
 */
describe("copy about not-deciding names what happens anyway", () => {
  it("the review-mode new-dispute callout names Shopify in every locale", () => {
    const source = readFileSync(
      resolve(ROOT, "lib/email/sendNewDisputeAlert.ts"),
      "utf8",
    );
    // The `review` variant's callout is the one that used to stop at "requires
    // your decision". Six locales, so six occurrences of the corrected shape.
    const stale = source.match(
      /requires your decision|requiere tu decisión|requer sua decisão|nécessite toujours votre décision|erfordert weiterhin Ihre Entscheidung|kräver fortfarande ditt beslut/g,
    );
    expect(
      stale,
      "a review-mode callout still says a decision is required without saying what inaction costs",
    ).toBeNull();
  });

  it("the deadline-fallback alert scopes 'filed nothing' to DisputeDesk", () => {
    const source = readFileSync(
      resolve(ROOT, "lib/email/sendDefenceDeadlineFallbackAlert.ts"),
      "utf8",
    );
    // It may say WE filed nothing; it may not say nothing was filed at all,
    // because Shopify files its scrape.
    expect(source).not.toMatch(/nothing has been filed(?! nothing)/i);
    expect(source).toMatch(/DisputeDesk has filed nothing/i);
    // And it must tell the merchant what Shopify does instead.
    expect(source).toMatch(/Shopify will pass on the basic order details/i);
  });

  it("the approving-disputes help article says what never approving costs", () => {
    for (const locale of LOCALES) {
      const body = leaf(
        messages(locale),
        "help.embedded.articles.approvingDisputes.body",
      );
      expect(body, `${locale}: approvingDisputes.body missing`).toBeTruthy();
      expect(
        body,
        `${locale}: the approval guide never says what happens if you don't approve`,
      ).toMatch(/Shopify/);
    }
  });
});
