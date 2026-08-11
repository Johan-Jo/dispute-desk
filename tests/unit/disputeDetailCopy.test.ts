/**
 * Render-side copy assertions for the dispute-detail redesign.
 *
 * Reads `messages/en.json` directly so the assertions exercise the
 * canonical strings that will be rendered. Component-render assertions
 * with @testing-library/react can land later — these contract-level
 * tests already pin the most common copy regressions.
 */

import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";

const BANNED_FOR_NON_NETWORK = [
  /submitted to (the )?bank/i,
  /sent to (the )?bank/i,
  /submitted to (the |your )?card network/i,
  /sent to (the |your )?card network/i,
  /shopify auto[- ]submits to (your )?card network/i,
];

const ALWAYS_BANNED = [
  /all evidence included/i,
  /8\/8 collected/i,
  /low-likelihood case submitted/i,
  /strong evidence is included in the defence package sent to the bank/i,
  /disputedesk saved available evidence to your card network/i,
];

interface HeroMessages {
  title: Record<string, Record<string, string>>;
  subtitle: Record<string, string>;
}

const hero = (
  enMessages as { disputes: { overview: { hero: HeroMessages } } }
).disputes.overview.hero;

describe("Hero copy — banned phrases never appear in non-network states", () => {
  // The legacy strength-flavored `hero.title.preSubmit/saved/awaiting`
  // families were DELETED (design-alignment audit — they carried the
  // banned "Strong case saved to Shopify" headlines). The live hero
  // copy is `presentation.hero.*`; pin the same gate on every
  // non-network lifecycle state there. `preSubmit.covered` survives
  // for the Shopify Protect hero.
  const heroV2 = (
    enMessages as unknown as {
      presentation: { hero: Record<string, unknown> };
    }
  ).presentation.hero;
  const NON_NETWORK_STATES = [
    "building_evidence",
    "monitoring",
    "pack_prepared",
    "saved_to_shopify",
  ] as const;
  for (const state of NON_NETWORK_STATES) {
    const entry = heroV2[state] as { title: string; message: string };
    for (const [part, copy] of Object.entries(entry)) {
      it(`presentation.hero.${state}.${part} contains no card-network wording`, () => {
        for (const re of BANNED_FOR_NON_NETWORK) {
          expect(copy).not.toMatch(re);
        }
      });
    }
  }
  it("the covered hero title contains no card-network wording", () => {
    for (const re of BANNED_FOR_NON_NETWORK) {
      expect(hero.title.preSubmit.covered).not.toMatch(re);
    }
  });

  it("subtitle.savedNoDate contains no card-network wording", () => {
    for (const re of BANNED_FOR_NON_NETWORK) {
      expect(hero.subtitle.savedNoDate).not.toMatch(re);
    }
  });
  it("subtitle.awaitingForward contains no card-network wording", () => {
    for (const re of BANNED_FOR_NON_NETWORK) {
      expect(hero.subtitle.awaitingForward).not.toMatch(re);
    }
  });
});

describe("Hero copy — always-banned phrases never appear", () => {
  function walk(value: unknown, path: string, hits: string[]): void {
    if (typeof value === "string") {
      for (const re of ALWAYS_BANNED) {
        if (re.test(value)) hits.push(`${path}: matches ${re}`);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, hits);
    }
  }
  it("disputes.overview.hero never contains the always-banned phrases", () => {
    const hits: string[] = [];
    walk(hero, "disputes.overview.hero", hits);
    expect(hits).toEqual([]);
  });
});

describe("Hero copy — under-review states may use card-network wording", () => {
  it("the under-review hero references the card network", () => {
    // The legacy submitted_to_network title family was deleted; the
    // live under-review hero (presentation.hero.under_review) carries
    // the card-network reference.
    const heroV2 = (
      enMessages as unknown as {
        presentation: { hero: { under_review: { title: string; message: string } } };
      }
    ).presentation.hero;
    const copy = `${heroV2.under_review.title} ${heroV2.under_review.message}`;
    expect(/card network/i.test(copy)).toBe(true);
  });
});

interface TimelineMessages {
  defencePackagePrepared: Record<string, string>;
  reviewAndSubmit: Record<string, string>;
  evidenceSavedToShopify: Record<string, string>;
  awaitingShopifyForwarding: Record<string, string>;
  submittedToCardNetwork: Record<string, string>;
  cardNetworkReview: Record<string, string>;
  outcomePosted: Record<string, string>;
}

const timeline = (
  enMessages as { disputes: { overview: { timeline: TimelineMessages } } }
).disputes.overview.timeline;

describe("Timeline copy — banned phrases", () => {
  it("'Shopify auto-submits to your card network' is gone everywhere", () => {
    function walkStrings(value: unknown): string[] {
      if (typeof value === "string") return [value];
      if (value && typeof value === "object") {
        return Object.values(value).flatMap(walkStrings);
      }
      return [];
    }
    const allStrings = walkStrings(timeline);
    for (const s of allStrings) {
      expect(s).not.toMatch(/shopify auto[- ]submits/i);
    }
  });

  it("pre-forwarding steps never claim DisputeDesk submitted to the bank", () => {
    // The forwarding step's title mentions "Awaiting Shopify forwarding
    // to card network" — that's a future-tense description of Shopify's
    // action, not a claim that DisputeDesk submitted. Confirm via shape.
    const awaitingTitle = timeline.awaitingShopifyForwarding.title;
    expect(awaitingTitle).toMatch(/awaiting/i);
    expect(awaitingTitle).toMatch(/shopify/i);
    expect(awaitingTitle).not.toMatch(/disputedesk submitted/i);
  });
});

/* ── Saved-vs-sent vocabulary (design-alignment plan §8) ─────────────── */

describe("Saved-vs-sent vocabulary — plan §8 wording corrections", () => {
  const disputes = (enMessages as unknown as { disputes: Record<string, unknown> })
    .disputes;

  it("window-closed banner says 'Sent to card network', never 'Submitted to bank'", () => {
    const banner = (disputes.evidenceTab as Record<string, Record<string, string>>)
      .windowClosedBanner;
    expect(banner.title).toBe("Sent to card network");
    expect(banner.title).not.toMatch(/bank/i);
    expect(banner.body).toMatch(/card network/i);
    expect(banner.body).not.toMatch(/issuing bank/i);
  });

  it("saved-body fallback never claims transmission it cannot verify", () => {
    const pkg = (disputes.reviewTab as Record<string, Record<string, Record<string, string>>>)
      .package;
    expect(pkg.savedBody.fallback).toMatch(/saved to Shopify/i);
    expect(pkg.savedBody.fallback).not.toMatch(/submitted to (the )?bank/i);
    expect(pkg.savedTitles.forwardedToNetwork).toBe("Sent to card network");
  });

  it("the merchant action is Save (to Shopify), not Submit", () => {
    const pkg = (disputes.reviewTab as Record<string, Record<string, Record<string, string>>>)
      .package;
    expect(pkg.submitToShopify as unknown as string).toBe("Save to Shopify");
    const extra = disputes.overviewExtra as Record<string, string>;
    expect(extra.submitToShopify).toBe("Save to Shopify");
    expect(extra.submitAnyway).toBe("Save anyway");
  });

  it("AVS/CVV and fraud screening are framed as supporting signals, never decisive", () => {
    const why = disputes.whyText as Record<string, string>;
    expect(why.avs_cvv_match).toMatch(/supporting signal/i);
    expect(why.avs_cvv_match).not.toMatch(/weigh this heavily/i);
    // `billing_address_match` had a whyText entry until 2026-08-09 (PR-C4 /
    // C-14). The field is retired, so the copy is gone rather than reworded —
    // asserted here so a future author does not restore it.
    expect(why.billing_address_match).toBeUndefined();
    expect(why.fraud_risk_screening).toMatch(/supporting context/i);
    expect(why.fraud_risk_screening).not.toMatch(/independent backing/i);
  });

  it("Gorgias approved state reads 'Approved for inclusion'", () => {
    const g = disputes.gorgiasComms as Record<string, Record<string, string>>;
    expect(g.message.approvedBadge).toBe("Approved for inclusion");
    expect(g.ticket.reportBadMatch).toBe("Report incorrect match");
  });
});
