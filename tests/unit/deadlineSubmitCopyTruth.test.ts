/**
 * The deadline cron and the copy that describes it must not drift apart.
 *
 * WHAT WENT WRONG. The Auto-pilot card said "Everything else waits for your
 * review." It does not. Under auto mode `evaluateAutoSubmitGuards` either
 * `park`s (Moderate, product-family Strong) or `block`s (Weak, Insufficient,
 * fatal-loss) — and BOTH leave `defence_packages` at `status='draft'`,
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
const QUALIFIER = /review mode|Shopify Protect|don't defend|conceded?|approve it/i;

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
