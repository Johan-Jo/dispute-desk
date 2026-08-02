/**
 * A held Auto-pilot case is not waiting for the merchant — and no surface may
 * say it is.
 *
 * `deadlineSubmitCopyTruth.test.ts` pins the deadline cron's contract and the
 * "what stops a filing" wording. This is its sibling for the OTHER half of the
 * sentence: who the case is waiting for. Under `auto`, the guards park
 * (Moderate) or block (Weak / Insufficient), the package stays a validated
 * draft, and the 08:00 UTC cron files it on the due date. The merchant is not
 * the gate — the clock is — and the dispute page offers them no approve / hold
 * / concede control, because that block renders only for a review-mode
 * approval gate.
 *
 * The copy nevertheless said "held for your review" on the Automation cards,
 * the onboarding summary, the dispute hero and in the new-dispute email. This
 * file fails the build if that framing comes back, and pins the replacement:
 * held + monitored, saved to Shopify on the due date, with the one contribution
 * a held case can genuinely take named as an option rather than a task.
 *
 * Review mode is deliberately NOT covered here — there the merchant really is
 * the gate, and `rules.modeReview*` should keep saying so.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");
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

/** The framing this change removed: the hold described as the merchant's to
 *  resolve. Written per locale because a translated euphemism is the easiest
 *  way for it to come back unnoticed. */
const HELD_FOR_YOU: Record<string, RegExp> = {
  en: /held for (your|you)\b/i,
  de: /für (Ihre Prüfung|Sie) zurückgehalten/i,
  es: /retenid[oa]s? para (tu|su) revisión/i,
  fr: /(retenus?|mis en attente) pour votre examen/i,
  pt: /retid[oa]s? para (a sua|sua) revisão/i,
  sv: /hålls för din granskning/i,
};

/** Naming the deadline is what turns "held" from a cliffhanger into a fact. */
const DEADLINE_TERM: Record<string, RegExp> = {
  en: /due date|deadline/i,
  de: /Frist|Fälligkeit/i,
  es: /fecha límite|plazo/i,
  fr: /date limite|échéance/i,
  pt: /prazo|data limite/i,
  sv: /förfallodag|sista dag|deadline/i,
};

// ─── A. Auto-pilot copy no longer hands the hold to the merchant ───────────

/** Every string that describes what Auto-pilot does with a non-strong case. */
const AUTO_HOLD_KEYS = [
  "rules.modeAutoLead",
  "rules.modeAutoNote",
  "rules.modeAutoDesc",
  "rules.modeSectionSubtitle",
  "rules.explainerBullet2",
  "rules.alwaysReviewedTitle",
  "rules.alwaysReviewedHeadingTail",
  "setup.handling.setupSummaryModeAuto",
  "setup.handling.alwaysHeldSubtitle",
];

describe("auto-pilot copy does not describe the hold as the merchant's to resolve", () => {
  for (const locale of LOCALES) {
    for (const key of AUTO_HOLD_KEYS) {
      it(`${locale}: ${key} does not say the case is held for the merchant`, () => {
        const value = leaf(messages(locale), key);
        expect(value, `${locale}: ${key} missing`).toBeTruthy();
        expect(
          value,
          `${locale}: ${key} still frames the hold as awaiting the merchant. ` +
            `In auto mode nothing waits for them: the deadline cron files the ` +
            `draft, and the page shows no approve/hold/concede control.`,
        ).not.toMatch(HELD_FOR_YOU[locale]);
      });
    }
  }
});

// ─── B. The hero's held line is a fact, with a date and a destination ──────

describe("the dispute hero's held milestone names Shopify and the deadline", () => {
  for (const locale of LOCALES) {
    it(`${locale}: nextHeldWithDate interpolates the date and names Shopify`, () => {
      const value = leaf(messages(locale), "presentation.hero.nextHeldWithDate");
      expect(value, `${locale}: presentation.hero.nextHeldWithDate missing`).toBeTruthy();
      expect(value).toContain("{date}");
      expect(value).toMatch(/Shopify/);
    });

    it(`${locale}: nextHeldNoDate still names Shopify and the deadline`, () => {
      // The no-date fallback is the one a merchant sees when Shopify gave us
      // no `evidenceDueBy`. It must not degrade into "held" with no horizon.
      const value = leaf(messages(locale), "presentation.hero.nextHeldNoDate");
      expect(value, `${locale}: presentation.hero.nextHeldNoDate missing`).toBeTruthy();
      expect(value).toMatch(/Shopify/);
      expect(value).toMatch(DEADLINE_TERM[locale]);
    });

    it(`${locale}: the auto-mode rule caption does not claim a submission`, () => {
      // `appliedMode.automaticHelp` says the pack was prepared AND saved
      // automatically. On a held dispute that is false, and a held dispute is
      // exactly the one a merchant opens and reads it on.
      const value = leaf(messages(locale), "disputes.overviewExtra.appliedMode.automaticHeldHelp");
      expect(value, `${locale}: automaticHeldHelp missing`).toBeTruthy();
      expect(value).toMatch(/Shopify/);
      expect(value).toMatch(DEADLINE_TERM[locale]);
    });
  }
});

// ─── C. The ask is an option, and only where it is real ────────────────────

/**
 * A held case has exactly one merchant contribution: a cardholder
 * acknowledgement, which writes `customerConfirmsOrder: true` and elevates
 * `customer_communication` supporting → strong. Both ask strings must describe
 * that, and only the `askFlipsToStrong` variant may promise the resulting
 * save — a Weak case gains a strong signal but still has only one, so it does
 * not reach the auto-save bar.
 */
describe("the held ask describes the acknowledgement, and promises only what it delivers", () => {
  for (const locale of LOCALES) {
    it(`${locale}: both ask variants exist and name the cardholder`, () => {
      const ask = leaf(messages(locale), "disputes.overviewExtra.held.ask");
      const flips = leaf(messages(locale), "disputes.overviewExtra.held.askFlipsToStrong");
      const cta = leaf(messages(locale), "disputes.overviewExtra.held.addAcknowledgement");
      for (const [name, value] of [["ask", ask], ["askFlipsToStrong", flips], ["addAcknowledgement", cta]] as const) {
        expect(value, `${locale}: held.${name} missing`).toBeTruthy();
      }
      const cardholder: Record<string, RegExp> = {
        en: /cardholder/i,
        de: /Karteninhaber/i,
        es: /titular/i,
        fr: /titulaire/i,
        pt: /titular/i,
        sv: /kortinnehavar/i,
      };
      expect(ask).toMatch(cardholder[locale]);
      expect(flips).toMatch(cardholder[locale]);
      expect(cta).toMatch(cardholder[locale]);
    });

    it(`${locale}: only the flips variant promises the save to Shopify`, () => {
      const ask = leaf(messages(locale), "disputes.overviewExtra.held.ask");
      const flips = leaf(messages(locale), "disputes.overviewExtra.held.askFlipsToStrong");
      expect(flips).toMatch(/Shopify/);
      expect(
        ask,
        `${locale}: the weak-case ask promises a save it cannot deliver — one ` +
          `acknowledgement makes strongCount 1, and auto-save needs 2`,
      ).not.toMatch(/Shopify/);
    });
  }
});

// ─── D. The gate that decides whether the ask is shown is shared ───────────

describe("one gate decides whether the acknowledgement is offered", () => {
  const CARD = readFileSync(
    resolve(
      ROOT,
      "app/(embedded)/app/disputes/[id]/tabs/sections/CardholderAcknowledgementCard.tsx",
    ),
    "utf8",
  );
  const EMAIL = readFileSync(resolve(ROOT, "lib/email/sendNewDisputeAlert.ts"), "utf8");
  const WORKSPACE_ROUTE = readFileSync(
    resolve(ROOT, "app/api/disputes/[id]/workspace/route.ts"),
    "utf8",
  );

  it("the card asks lib/disputes/heldState rather than re-deriving its own gate", () => {
    // A local copy is how the email and the page start disagreeing: one
    // invites an acknowledgement the other hides.
    expect(CARD).toContain("canOfferCardholderAcknowledgement");
    expect(CARD).toContain("@/lib/disputes/heldState");
  });

  it("nothing gates the offer on the checklist row having evidence", () => {
    // The row goes `available` on an auto-collected Shopify order note that
    // contributes nothing to strength. Gating on it hid the CTA on 11 of 17
    // open weak disputes — the ones with zero strong signals.
    for (const [name, src] of [["card", CARD], ["email", EMAIL], ["workspace", WORKSPACE_ROUTE]] as const) {
      expect(src, `${name} re-introduced the row-based gate`).not.toMatch(
        /communicationHasEvidence/,
      );
    }
    expect(CARD).toContain("merchantSuppliedAcknowledgementFromItems");
    expect(EMAIL).toContain("merchantSuppliedAcknowledgementFromItems");
    expect(WORKSPACE_ROUTE).toContain("merchantSuppliedAcknowledgementFromItems");
  });

  it("the email prints its ask only from the resolved offer", () => {
    expect(EMAIL).toContain("resolveHeldState");
    expect(EMAIL).toMatch(/ctx\.held\?\.offer === "cardholder_acknowledgement"/);
  });

  it("the workspace API resolves the held state server-side", () => {
    expect(WORKSPACE_ROUTE).toContain("resolveHeldState");
  });
});
