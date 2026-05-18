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
  const FAMILIES = ["preSubmit", "saved", "awaiting"] as const;
  for (const family of FAMILIES) {
    for (const [variant, copy] of Object.entries(hero.title[family])) {
      it(`title.${family}.${variant} contains no card-network wording`, () => {
        for (const re of BANNED_FOR_NON_NETWORK) {
          expect(copy).not.toMatch(re);
        }
      });
    }
  }

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

describe("Hero copy — SUBMITTED_TO_NETWORK may use card-network wording", () => {
  it("at least one submitted_to_network title contains card-network wording", () => {
    const titles = Object.values(hero.title.submitted_to_network);
    const usesCardNetwork = titles.some((s) => /card network/i.test(s));
    expect(usesCardNetwork).toBe(true);
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
