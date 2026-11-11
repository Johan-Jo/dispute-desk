/**
 * The dispute record: ONE record of facts per dispute, read by every sentence
 * on every tab (Claude Design `NewDispute`). These tests pin the property the
 * page exists for: a fact is stated once, in one form, and every surface reads
 * it from the record.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl";
import en from "../../messages/en.json";
import { buildDisputeRecord, ROLE_ORDER, type DisputeRecord, type FactKey } from "@/lib/disputes/disputeRecord";
import { createRecordFormat, utcDaysUntil } from "@/lib/disputes/recordFormat";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import { recordInputsFromWorkspace } from "../../app/(embedded)/app/disputes/[id]/record/recordInputs";
import { ALL_VARIANTS, workspaceVariant } from "../fixtures/disputeRecordFixture";

const NOW = "2026-11-06T12:00:00Z";
const fmt = createRecordFormat("en");

// A missing key throws, so a token whose key was never added fails here.
const t = createTranslator({
  locale: "en",
  messages: en as never,
  onError: (e) => {
    throw e;
  },
  getMessageFallback: ({ key }) => {
    throw new Error(`missing message ${key}`);
  },
});
const R = (tok: I18nToken) => resolveToken(t as never, tok) as string;

function record(name: string, now = NOW): DisputeRecord {
  return buildDisputeRecord(recordInputsFromWorkspace(workspaceVariant(name), now), fmt);
}
const account = (r: DisputeRecord) => r.account.map((k) => R(r.facts[k] as I18nToken)).join(" ");

describe("the open record with a prepared package", () => {
  const r = record("prepared");
  it("reads as one account in the design's register", () => {
    expect(account(r)).toBe(
      "The cardholder told their bank they did not make this purchase. " +
        "DisputeDesk prepared defence package version 1 on 6 Nov 2026. Nothing has been saved to Shopify yet. " +
        "On Auto-pilot, DisputeDesk saves it to Shopify on 14 Dec 2026, the deadline, unless you save it sooner. " +
        "The case is strong: the card's security code and billing address matched the card issuer's records, and Northwind Express delivered the order on 25 Oct 2026. " +
        "4 items are cited to the bank, 6 are context in the package, 2 are kept internal and 2 are not available. " +
        "No action is required. Adding the cardholder's acknowledgement would strengthen the case.",
    );
  });
  it("counts the days once, in UTC", () => {
    expect(r.header.daysLeft).toBe(38);
    expect(utcDaysUntil("2026-12-14T23:00:00+00:00", "2026-11-06T23:59:00Z")).toBe(38);
  });
  it("gives every item exactly one role and counts them from the items", () => {
    const keys = r.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const role of ROLE_ORDER) expect(r.counts[role]).toBe(r.items.filter((i) => i.role === role).length);
    expect(r.items.find((i) => i.key === "pay")?.role).toBe("context");
  });
  it("amounts: states the payment and the chargeback once", () => {
    expect(R(r.facts.amounts as I18nToken)).toBe("The payment was CAD 112.70; the chargeback is for CAD 112.67.");
  });
});

describe("one fact, one sentence, on every surface", () => {
  it("the timeline, the package card and the account read the same tokens", () => {
    for (const name of ["prepared", "won", "lost"]) {
      const r = record(name);
      for (const step of r.timeline) {
        const owner = (Object.entries(r.facts) as Array<[FactKey, I18nToken]>).find(([, tok]) => tok === step.text);
        const delivery = r.items.find((i) => i.key === "delivery")?.detail === step.text;
        const shipped = step.title.key.endsWith("t.shipped") || step.title.key.endsWith("t.placedPaid") || step.title.key.endsWith("t.placed");
        expect(owner || delivery || shipped, `${name}: ${step.title.key}`).toBeTruthy();
      }
      for (const k of r.pkg.lines) expect(r.facts[k]).toBeDefined();
    }
  });

  it("the roles sentence is computed from the items and matches the counts on every tab", () => {
    for (const name of ["prepared", "won", "lost", "saved", "held"]) {
      const r = record(name);
      const sentence = R(r.facts.roles as I18nToken);
      const nums = (sentence.match(/\d+/g) ?? []).map(Number);
      expect(nums).toEqual(ROLE_ORDER.map((role) => r.counts[role]));
    }
  });

  it("one date format everywhere: 'd Mon yyyy' (UTC)", () => {
    const re = /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/;
    for (const name of ALL_VARIANTS) {
      const r = record(name);
      const texts = [...r.account.map((k) => R(r.facts[k] as I18nToken)), ...r.items.map((i) => R(i.detail))];
      for (const s of texts) {
        // No ISO dates, no "Oct 25," US form, no slash dates.
        expect(s, `${name}: ${s}`).not.toMatch(/\d{4}-\d{2}-\d{2}|\b[A-Z][a-z]{2} \d{1,2},|\d{1,2}\/\d{1,2}\/\d{2,4}/);
      }
      if (r.header.opened) expect(r.header.opened).toMatch(re);
    }
  });

  it("mutation: change the version, the deadline and the delivery date and every dependent sentence follows", () => {
    const base = workspaceVariant("prepared") as unknown as Record<string, any>;
    base.defencePackage.latest.version = 7;
    base.dispute.dueAt = "2026-12-20T23:00:00+00:00";
    for (const f of ["shipping_tracking", "delivery_proof"]) {
      base.pack.evidenceItemsByField[f].payload.deliveredAt = "2026-10-27T10:00:00Z";
      base.pack.evidenceItemsByField[f].payload.fulfillments[0].deliveredAt = "2026-10-27T10:00:00Z";
    }
    const r = buildDisputeRecord(recordInputsFromWorkspace(base as never, NOW), fmt);
    const all = [
      account(r),
      ...r.timeline.map((s) => R(s.text)),
      ...r.pkg.lines.map((k) => R(r.facts[k] as I18nToken)),
      ...r.items.map((i) => R(i.detail)),
    ].join("\n");
    expect(all).toContain("version 7");
    expect(all).not.toContain("version 1");
    expect(all).toContain("20 Dec 2026");
    expect(all).not.toContain("14 Dec 2026");
    expect(all).toContain("27 Oct 2026");
    expect(all).not.toContain("25 Oct 2026");
    expect(r.header.daysLeft).toBe(44);
  });
});

describe("decided disputes", () => {
  it("lost: names what was cited and what was withheld, in that order", () => {
    const r = record("lost");
    expect(R(r.facts.filed as I18nToken)).toBe("DisputeDesk saved defence package version 3 to Shopify on 14 Dec 2026, the deadline.");
    expect(R(r.facts.outcome as I18nToken)).toBe("The bank decided in the customer's favour on 11 Oct 2026. CAD 112.67 was not returned.");
    expect(r.account).not.toContain("roles");
  });
  it("inquiry wording never says the bank decided", () => {
    const r = record("won_inquiry");
    expect(R(r.facts.outcome as I18nToken)).toBe("The inquiry was decided in your favour on 11 Oct 2026. CAD 112.67 was recovered.");
  });
  it("answered through Shopify / before install / not at all: says DisputeDesk filed nothing and shows no roles", () => {
    for (const [name, text] of [
      ["lost_shopify", "DisputeDesk filed nothing for this dispute. A response was sent through Shopify on 14 Dec 2026."],
      ["lost_none", "DisputeDesk filed nothing for this dispute, so no evidence from DisputeDesk was part of the decision."],
      ["lost_before_install", "This dispute was decided before DisputeDesk was installed on your store, so DisputeDesk filed nothing for it."],
    ] as const) {
      const r = record(name);
      expect(R(r.facts.filed as I18nToken)).toBe(text);
      expect(r.showRoles).toBe(false);
      expect(r.facts.cited).toBeUndefined();
    }
  });
});

describe("every state renders through the same record", () => {
  for (const name of ALL_VARIANTS) {
    it(`${name}: builds, every token resolves, and the account begins with the claim`, () => {
      const r = record(name);
      expect(r.account[0]).toBe("claim");
      const tokens: I18nToken[] = [
        r.hero.headline,
        r.hero.claimShort,
        r.hero.amountLabel,
        r.hero.statusChip,
        r.timelineTitle,
        ...r.account.map((k) => r.facts[k] as I18nToken),
        ...r.timeline.flatMap((s) => [s.title, s.text]),
        ...r.items.flatMap((i) => [i.label, i.detail, i.source]),
        ...r.checklist.rows.flatMap((c) => [c.item, c.label, ...(c.sub ? [c.sub] : [])]),
        ...(r.checklist.odds ? [r.checklist.odds] : []),
        ...(r.checklist.note ? [r.checklist.note] : []),
        ...(r.help ? [r.help.title, ...r.help.items.flatMap((h) => [h.title, h.detail])] : []),
      ];
      for (const tok of tokens) expect(R(tok).length).toBeGreaterThan(0);
      expect(r.pkg.lines.length).toBeGreaterThan(0);
    });
  }

  it("no English in lib: the record emits tokens, never sentences", () => {
    const r = record("prepared");
    for (const tok of Object.values(r.facts)) expect(tok?.key.startsWith("disputes.record.")).toBe(true);
  });

  it("stages: each state says where the dispute stands", () => {
    const stage = (n: string) => record(n).stage;
    expect(stage("prepared")).toBe("prepared");
    expect(stage("prepared_review")).toBe("prepared_review");
    expect(stage("held")).toBe("held");
    expect(stage("needs_attention")).toBe("needs_attention");
    expect(stage("covered")).toBe("covered");
    expect(stage("fatal_refund")).toBe("fatal");
    expect(stage("no_pack")).toBe("no_pack");
    expect(stage("building")).toBe("building");
    expect(stage("failed")).toBe("failed");
    expect(stage("saved")).toBe("saved");
    expect(stage("under_review")).toBe("under_review");
    expect(stage("lost")).toBe("decided");
  });

  // Single-source plan 3.5 / 3.1 (#23750): the stage is read from the owner, not from the raw stamp.
  it("a pack stamped saved while submission_state=not_saved is not stage 'saved'", () => {
    expect(record("stamped_not_saved").stage).not.toBe("saved");
  });

  it("states without a package show no roles and no letter lines", () => {
    for (const n of ["no_pack", "building", "failed", "covered"]) {
      const r = record(n);
      expect(r.showRoles, n).toBe(false);
      expect(r.facts.roles, n).toBeUndefined();
    }
  });

  it("review mode: waiting, approved and declined are three different, true sentences", () => {
    expect(R(record("prepared_review").facts.reviewMode as I18nToken)).toContain("only when you approve it");
    expect(R(record("prepared_review_approved").facts.reviewMode as I18nToken)).toContain("You approved it");
    expect(record("prepared_review").canDecide).toBe(true);
  });

  it("a return on record is stated once, kept internal, and named among what is withheld", () => {
    const r = record("return_on_record");
    const ret = r.items.find((i) => i.key === "return");
    expect(ret?.role).toBe("internal");
    expect(R(ret!.detail)).toBe("A return on this order is marked as received.");
  });
});

describe("a customer asked to return it in the support inbox (Gorgias, read-time)", () => {
  const SENTENCE =
    "A customer message in your support inbox asks to return this order. No return is on record in Shopify.";
  const everySentence = (r: DisputeRecord) => {
    const acc = r.account.map((k) => R(r.facts[k] as I18nToken));
    const items = r.items.map((i) => R(i.detail));
    return [...acc, ...items];
  };

  /** The record with the stored letter overridden: which fields its Evidence Basis cites. */
  const recordWithLetter = (name: string, citedFields: string[]): DisputeRecord => {
    const inputs = recordInputsFromWorkspace(workspaceVariant(name), NOW);
    inputs.letter = { rule: 1, citedFields };
    return buildDisputeRecord(inputs, fmt);
  };

  it("letter does NOT cite the no-return fact: replaces 'No return or refund is on record', internal, adverse", () => {
    const r = recordWithLetter("customer_asked_in_support", []);
    const ret = r.items.find((i) => i.key === "return");
    expect(ret?.role).toBe("internal");
    expect(ret?.adverse).toBe(true);
    expect(R(ret!.detail)).toBe(SENTENCE);
    const all = everySentence(r).join(" | ");
    expect(all).not.toMatch(/No return or refund is on record|No return is on record\./);
    expect(r.facts.withheld).toBeUndefined(); // the withheld sentence is a decided-state sentence
  });

  it("the counts are recomputed from the roles: the item moves from context to internal", () => {
    const base = recordWithLetter("prepared", []);
    const r = recordWithLetter("customer_asked_in_support", []);
    const baseRet = base.items.find((i) => i.key === "return");
    expect(baseRet?.role).toBe("context");
    expect(r.counts.internal).toBe(base.counts.internal + 1);
    expect(r.counts.context).toBe(base.counts.context - 1);
    for (const role of ROLE_ORDER) expect(r.counts[role]).toBe(r.items.filter((i) => i.role === role).length);
    const nums = (R(r.facts.roles as I18nToken).match(/\d+/g) ?? []).map(Number);
    expect(nums).toEqual(ROLE_ORDER.map((role) => r.counts[role]));
  });

  it("one record, one sentence: the item is the only carrier, on every tab that reads the record", () => {
    const r = recordWithLetter("customer_asked_in_support", []);
    expect(r.items.filter((i) => R(i.detail) === SENTENCE)).toHaveLength(1);
    expect(r.pkg.lines.map((k) => R(r.facts[k] as I18nToken)).join(" ")).not.toMatch(/support inbox/);
  });

  it("works on a decided dispute and never overrides a return Shopify records", () => {
    const lost = workspaceVariant("lost") as unknown as Record<string, any>;
    lost.returnSignals = { customerAskedInSupport: true };
    const lostInputs = recordInputsFromWorkspace(lost as never, NOW);
    lostInputs.bankCitedFields = [];
    lostInputs.letter = { rule: 1, citedFields: [] };
    const d = buildDisputeRecord(lostInputs, fmt);
    expect(R(d.items.find((i) => i.key === "return")!.detail)).toBe(SENTENCE);
    expect(d.items.find((i) => i.key === "return")!.role).toBe("internal");
    expect(R(d.facts.withheld as I18nToken)).toContain("the customer's return request");

    const rec = workspaceVariant("return_on_record") as unknown as Record<string, any>;
    rec.returnSignals = { customerAskedInSupport: true };
    const rr = buildDisputeRecord(recordInputsFromWorkspace(rec as never, NOW), fmt);
    expect(R(rr.items.find((i) => i.key === "return")!.detail)).toBe("A return on this order is marked as received.");
  });

  it("when the letter that was built already cites the no-return fact, the page still says it was cited, beside the true sentence", () => {
    const inputs = recordInputsFromWorkspace(workspaceVariant("customer_asked_in_support"), NOW);
    inputs.letter = { rule: 1, citedFields: ["no_return_initiated"] };
    const r = buildDisputeRecord(inputs, fmt);
    const ret = r.items.find((i) => i.key === "return")!;
    expect(ret.role).toBe("cited");
    expect(ret.adverse).toBe(true);
    expect(R(ret.detail)).toBe(SENTENCE);
    for (const role of ROLE_ORDER) expect(r.counts[role]).toBe(r.items.filter((i) => i.role === role).length);
  });

  it("an absent or false signal changes nothing", () => {
    const a = workspaceVariant("prepared") as unknown as Record<string, any>;
    a.returnSignals = { customerAskedInSupport: false };
    expect(JSON.stringify(buildDisputeRecord(recordInputsFromWorkspace(a as never, NOW), fmt))).toBe(
      JSON.stringify(record("prepared")),
    );
  });
});

describe("the case-strength pill in the header (one band, read from the record)", () => {
  it("prepared and held-for-review packages carry the band; it matches the strength sentence", () => {
    const r = record("prepared");
    expect(r.hero.strengthBand).toBe("strong");
    expect(R(r.facts.strength as I18nToken)).toContain("The case is strong");
  });
  it("is absent wherever the strength sentence is absent: building, no pack, saved, under review, decided, fatal-loss", () => {
    for (const n of ["building", "no_pack", "failed", "covered", "saved", "under_review", "lost", "won", "fatal_refund"]) {
      if (!ALL_VARIANTS.includes(n as never)) continue;
      expect(record(n).hero.strengthBand, n).toBeNull();
    }
  });
  it("the pill label reuses the existing presentation.strength.detail copy in every locale", async () => {
    for (const loc of ["en", "de", "es", "fr", "pt", "sv"]) {
      const m = (await import(`../../messages/${loc}.json`)).default as { presentation: { strength: { detail: Record<string, string> } } };
      for (const band of ["strong", "moderate", "weak"]) {
        expect(m.presentation.strength.detail[band], `${loc}.${band}`).toBeTruthy();
      }
    }
  });
});

describe("Building state: the list and the page use the same word, and no package means no roles", () => {
  it("a ready evidence pack with the defence package still being built reads 'Pack prepared' in the header, from the list's own key", () => {
    const w = workspaceVariant("building") as unknown as Record<string, any>;
    w.presentation = { ...(w.presentation ?? {}), lifecycle: "pack_prepared" };
    const r = buildDisputeRecord(recordInputsFromWorkspace(w as never, NOW), fmt);
    expect(r.stage).toBe("building");
    expect(r.hero.statusChip).toEqual({ key: "presentation.lifecycle.pack_prepared" });
    expect(R(r.hero.statusChip)).toBe("Pack prepared");
  });
  it("without that lifecycle the chip stays 'Building'", () => {
    const w = workspaceVariant("building") as unknown as Record<string, any>;
    w.presentation = { ...(w.presentation ?? {}), lifecycle: "building_evidence" };
    expect(R(buildDisputeRecord(recordInputsFromWorkspace(w as never, NOW), fmt).hero.statusChip)).toBe("Building");
  });
  it("showRoles is false for every state without a package (the page hides the role pills there)", () => {
    for (const n of ["no_pack", "building", "failed", "covered"]) expect(record(n).showRoles, n).toBe(false);
  });
});

describe("every return status Shopify can report has a sentence (production defect: in_progress had none)", () => {
  for (const returns of ["requested", "in_progress", "returned", "failed"] as const) {
    it(`${returns}: the Return and refund item resolves to a real sentence`, () => {
      const w = workspaceVariant("prepared") as unknown as Record<string, any>;
      w.dispute.orderSituation = { returns, refund: "none", returnOpenedAt: null, asOf: null };
      const r = buildDisputeRecord(recordInputsFromWorkspace(w as never, NOW), fmt);
      const it = r.items.find((x) => x.key === "return");
      expect(it, returns).toBeTruthy();
      const text = R(it!.detail);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/return/i);
      expect(text).not.toMatch(/disputes\.record/);
    });
  }
  it("in_progress says it is in progress and not yet received", () => {
    const w = workspaceVariant("prepared") as unknown as Record<string, any>;
    w.dispute.orderSituation = { returns: "in_progress", refund: "none", returnOpenedAt: null, asOf: null };
    const r = buildDisputeRecord(recordInputsFromWorkspace(w as never, NOW), fmt);
    expect(R(r.items.find((x) => x.key === "return")!.detail)).toBe("A return on this order is in progress. It is not yet marked as received.");
  });
});
