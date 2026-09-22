/**
 * A thesis template must survive the rail it lands on.
 *
 * WHAT HAPPENED (2026-09-02). `executiveSummary:any:any` — the LAST entry in
 * `renderThesis`'s fallback chain, and therefore the thesis for every family
 * that has none of its own — opened with "This representment addresses …".
 * `representment` is a card-network term of art and sits in
 * `BNPL_PROHIBITED_CARD_PHRASES`, which `validateComposedDocument` hard-rejects
 * on every non-card rail.
 *
 * So the moment a family without its own thesis landed on PayPal, the composed
 * document was rejected and the dispute filed nothing. On prod that was
 * `product_not_as_described`: 26 packages, a 100% failure rate, every one
 * leaving Shopify to submit its own scrape at the deadline. It had been broken
 * since 2026-08-30 — when PR #621 made packs classify as `paypal` rather than
 * `other` and switched the ban on — and stayed invisible until a batch of
 * rebuilds ran through it.
 *
 * WHY THIS TEST AND NOT A FIX TO ONE STRING. The bug is not that one word was
 * wrong; it is that a template serving every family and every rail was written
 * as though the rail were always card. `validateComposedDocument` catches it at
 * runtime — but runtime here means a failed package and a merchant who files
 * nothing. This moves the catch to build time.
 *
 * Scope note: the card-phrase ban only applies to non-card rails, so a
 * family-specific card template could legitimately say "3-D Secure". None do
 * today, and the families that carry card constructs (`unauthorized_fraud`)
 * gate them behind `requiredTokens` — asserted separately in
 * `thesisCannotClaimWithoutFact.matrix.test.ts`. If a genuinely card-only
 * template is ever added, narrow this test to `familyKey === "any"` rather
 * than deleting it: the fallback chain is the part that must stay neutral.
 */

import { describe, it, expect } from "vitest";

import { THESIS_TEMPLATES } from "@/lib/defence/pdf/thesisTemplates";
import { BNPL_PROHIBITED_CARD_PHRASES } from "@/lib/defence/paymentOverlays";

describe("thesis templates are rail-neutral", () => {
  it("no template contains a phrase hard-banned on non-card rails", () => {
    const offenders: string[] = [];
    for (const t of THESIS_TEMPLATES) {
      for (const pattern of BNPL_PROHIBITED_CARD_PHRASES) {
        const match = t.template.match(pattern);
        if (match) {
          offenders.push(`${t.key} → "${match[0]}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the generic fallback specifically is clean — it serves every family", () => {
    // Singled out because it is the one template that can be reached by a
    // family nobody remembered to write a thesis for, which is exactly how
    // this defect stayed invisible.
    const generic = THESIS_TEMPLATES.filter(
      (t) => t.familyKey === "any" && t.packageMode === "any",
    );
    expect(generic.length).toBeGreaterThan(0);
    for (const t of generic) {
      for (const pattern of BNPL_PROHIBITED_CARD_PHRASES) {
        expect(
          t.template,
          `generic fallback ${t.key} must not assume a card rail`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("still says 'representment' nowhere in the thesis library", () => {
    // The specific word that caused the incident, pinned by name so a
    // well-meaning revert is a red test rather than a silent regression.
    for (const t of THESIS_TEMPLATES) {
      expect(t.template, `${t.key}`).not.toMatch(/\brepresentment\b/i);
    }
  });
});
