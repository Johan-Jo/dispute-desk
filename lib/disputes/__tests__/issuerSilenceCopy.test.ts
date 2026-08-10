/**
 * The merchant is never told that nothing reaches the issuer.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Shopify auto-compiles and files its own scrape of the order at the
 * deadline, whether or not DisputeDesk adds a defence package, and there is
 * no accept/concede mutation that stops it. So "Nothing will be submitted"
 * — which is what the pre-existing "Don't defend" state said, in six
 * languages, across four surfaces — described an outcome the product cannot
 * produce. A merchant who reads it and declines has not bought silence; they
 * have swapped our document for Shopify's scrape without being told.
 *
 * ── WHAT IS PINNED, AND WHAT DELIBERATELY IS NOT ──────────────────────
 *
 * A FIXED list of the keys this correction touched, in all six locales. Not
 * a phrase detector over the catalogs: that shape was tried before, it
 * flags every honest sentence containing "nothing", and its failures get
 * silenced with an allow-list until it detects nothing at all. This asserts
 * three properties over eighteen named keys instead.
 *
 *   1. Every key resolves. Parity already checks presence; this checks that
 *      the key we corrected is the key that ships.
 *   2. Every key that describes DisputeDesk declining, or holding, names
 *      SHOPIFY — the other actor, whose deadline process runs regardless.
 *      A sentence that omits it is the silence promise by implication.
 *   3. No key still carries its locale's silence phrase, or the old
 *      "Don't defend" label that framed the choice as defend-vs-concede
 *      rather than whose document gets filed.
 *
 * Adding a seventh locale, or a new surface for these states, means adding
 * it here. That is the intended cost.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;
type Locale = (typeof LOCALES)[number];

/**
 * Keys that state DisputeDesk will not add a package, or is holding one.
 * Each MUST name Shopify's parallel process — that is the whole correction.
 */
const MUST_NAME_SHOPIFY = [
  "disputes.deadlineOnly.held.body",
  "disputes.deadlineOnly.withheld.body",
  "disputes.overviewExtra.review.concedeHelp",
  "disputes.overviewExtra.review.stateConcededBody",
  "presentation.hero.reviewDecision.conceded.message",
  "help.articles.reviewQueue.body",
  "help.articles.approvingDisputes.body",
  "help.embedded.articles.reviewQueue.body",
  "help.embedded.articles.approvingDisputes.body",
] as const;

/**
 * The rest of the corrected surface: labels, chips and titles. They carry no
 * room for the clarification, so they are held to rules 1 and 3 only.
 */
const LABELS_AND_TITLES = [
  "disputes.deadlineOnly.held.title",
  "disputes.deadlineOnly.held.action",
  "disputes.deadlineOnly.normal.body",
  "disputes.deadlineOnly.withheld.title",
  "disputes.overviewExtra.review.prompt",
  "disputes.overviewExtra.review.concede",
  "disputes.overviewExtra.review.stateConcededTitle",
  "disputes.reviewChip.notDefended",
  "presentation.reviewDecision.conceded",
  "presentation.reviewDecisionSub.conceded",
  "presentation.hero.reviewDecision.conceded.title",
  "rules.modeAutoDesc",
  "rules.modeAutoNote",
  "setup.handling.setupSummaryModeAuto",
] as const;

const AFFECTED_KEYS = [...MUST_NAME_SHOPIFY, ...LABELS_AND_TITLES];

/**
 * The exact promise each locale used to make, and the old label that framed
 * the choice as defend-vs-concede. Written out per locale rather than
 * matched by pattern: a regex over six grammars either misses a form or
 * fires on an honest one.
 */
const BANNED: Record<Locale, string[]> = {
  en: ["Nothing will be submitted", "nothing will be sent", "will not be sent", "Don't defend"],
  de: ["Es wird nichts eingereicht", "wird nichts gesendet", "Nicht verteidigen"],
  es: ["No se enviará nada", "no se enviará nada", "No defender"],
  fr: ["Rien ne sera envoyé", "rien ne sera envoyé", "Ne pas défendre"],
  pt: ["Nada será enviado", "nada será enviado", "Não defender"],
  sv: ["Inget kommer att skickas", "inget kommer att skickas", "Försvara inte"],
};

function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
}

function lookup(cat: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = cat;
  for (const part of dotted.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("no surface promises that nothing reaches the issuer", () => {
  it("guard the guard — the banned phrases really do match the copy they describe", () => {
    // If this ever passes trivially the suite below proves nothing. The
    // check: each locale's first banned phrase must be absent NOW and
    // present in a string built to contain it.
    for (const locale of LOCALES) {
      const phrase = BANNED[locale][0];
      expect(phrase.length, `${locale} has an empty banned phrase`).toBeGreaterThan(4);
      expect(`prefix ${phrase} suffix`.includes(phrase)).toBe(true);
    }
    expect(AFFECTED_KEYS.length).toBe(23);
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      it("every affected key resolves to a non-empty string", () => {
        const cat = catalog(locale);
        for (const key of AFFECTED_KEYS) {
          const value = lookup(cat, key);
          expect(typeof value, `${locale} missing ${key}`).toBe("string");
          expect((value as string).trim().length, `${locale} empty ${key}`).toBeGreaterThan(0);
        }
      });

      it("no affected key still promises silence, or uses the old label", () => {
        const cat = catalog(locale);
        for (const key of AFFECTED_KEYS) {
          const value = lookup(cat, key) as string;
          for (const banned of BANNED[locale]) {
            expect(
              value.includes(banned),
              `${locale} ${key} still contains "${banned}"`,
            ).toBe(false);
          }
        }
      });

      it("every declining or holding key names Shopify's own deadline process", () => {
        const cat = catalog(locale);
        for (const key of MUST_NAME_SHOPIFY) {
          const value = lookup(cat, key) as string;
          expect(value.includes("Shopify"), `${locale} ${key} omits Shopify`).toBe(true);
        }
      });

      it("the two decline surfaces name DisputeDesk as the actor that declines", () => {
        // "We won't send" left it ambiguous whether "we" meant the app or the
        // merchant's store. Both corrected strings say DisputeDesk.
        const cat = catalog(locale);
        for (const key of [
          "disputes.overviewExtra.review.concedeHelp",
          "disputes.deadlineOnly.withheld.body",
        ]) {
          const value = lookup(cat, key) as string;
          expect(value.includes("DisputeDesk"), `${locale} ${key} omits DisputeDesk`).toBe(true);
        }
      });
    });
  }

  it("the conceded state reads the same way on every surface that renders it", () => {
    // Three surfaces render "the merchant declined": the Overview action
    // block, the presentation sub-label and the hero. They were corrected
    // together; a later edit to one of them alone is the divergence this
    // catches.
    for (const locale of LOCALES) {
      const cat = catalog(locale);
      const overview = lookup(cat, "disputes.overviewExtra.review.stateConcededBody") as string;
      const hero = lookup(cat, "presentation.hero.reviewDecision.conceded.message") as string;
      expect(hero, `${locale} hero and overview describe the same state differently`).toBe(
        overview,
      );
    }
  });
});
