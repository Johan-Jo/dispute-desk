/**
 * The dispute account (lib/disputes/disputeAccount.ts, accountPage.ts).
 *
 * Spec: Claude Design project fca59ec9… `DecidedWorkspaceMock.dc.html`. States
 * A, B, C and E are asserted sentence by sentence against the design's `F`
 * (dates and money rendered the way the design renders them), then the
 * consistency guarantee (every use of a fact is the one record's token), the
 * no-contradiction scans, and the states the design does not cover.
 */

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import { buildDisputeAccount, type AccountInputs, type AccountFormat } from "@/lib/disputes/disputeAccount";
import { buildAccountPage, type AccountEvidenceRowInput } from "@/lib/disputes/accountPage";
import type { RefundStatement } from "@/lib/disputes/refundStatement";
import type { ReturnSituation } from "@/lib/disputes/orderSituation";

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(process.cwd(), "messages", `${l}.json`), "utf8"))]),
);
const tr = (locale: (typeof LOCALES)[number]) =>
  createTranslator({ locale, messages: catalogs[locale] }) as never;
const say = (tok: I18nToken, locale: (typeof LOCALES)[number] = "en") => resolveToken(tr(locale), tok) as string;

/** The design's rendering: "4 Nov 2026", "618,00 kr". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt: AccountFormat = {
  date: (iso) => {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  },
  money: (a, _c) => `${a.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`,
};

const base = {
  currency: "SEK",
  dueAt: null,
  filedAt: null,
  sentAt: null,
  deliveryConfirmed: false,
  order: null,
  pack: null,
} as const;

const stmt = (over: Partial<RefundStatement> & { kind: RefundStatement["kind"] }): RefundStatement => ({
  asOf: "2026-11-05T09:00:00Z",
  zeroCurrency: "SEK",
  ...over,
});
const sit = (returns: ReturnSituation, opened: string | null) => ({
  returns,
  refund: "none" as const,
  returnOpenedAt: opened,
  asOf: "2026-11-05T09:00:00Z",
});

const CNP = "CREDIT_NOT_PROCESSED";

/** A — #24612: won, return received, one refund entry with no confirmed amount. */
const A: AccountInputs = {
  ...base,
  reason: CNP,
  lifecycle: "won",
  amount: 618,
  openedAt: "2026-11-04T10:15:00Z",
  closedAt: "2026-11-04T14:38:00Z",
  responder: "none",
  situation: sit("returned", "2026-10-27T09:00:00Z"),
  refund: stmt({ kind: "recorded_no_amount", entryCount: 1 }),
  deliveryConfirmed: true,
  order: { total: 757, currency: "SEK", card: true },
};
/** B — #24599: won, return in progress, no refund. */
const B: AccountInputs = {
  ...base,
  reason: CNP,
  lifecycle: "won",
  amount: 899,
  openedAt: "2026-11-01T08:00:00Z",
  closedAt: "2026-11-04T09:00:00Z",
  responder: "none",
  situation: sit("in_progress", null),
  refund: stmt({ kind: "none" }),
  pack: { built: true, savedAt: null, forwarded: false, hasTracking: true },
};
/** C — #24215: won, NO_RETURN, one refund entry (29 Oct, before the dispute), no amount. */
const C: AccountInputs = {
  ...base,
  reason: CNP,
  lifecycle: "won",
  amount: 1148,
  openedAt: "2026-10-30T08:00:00Z",
  closedAt: "2026-10-30T15:00:00Z",
  responder: "none",
  situation: sit("none", null),
  refund: stmt({ kind: "recorded_no_amount", entryCount: 1, entryAt: "2026-10-29T12:00:00Z" }),
  pack: { built: true, savedAt: null, forwarded: false, hasTracking: false },
};
/** E — #23750: open product-not-received inquiry, no pack yet. */
const E: AccountInputs = {
  ...base,
  reason: "PRODUCT_NOT_RECEIVED",
  lifecycle: "open",
  openStage: "response_needed",
  amount: 618,
  openedAt: "2026-11-02T08:00:00Z",
  dueAt: "2026-11-20T23:00:00Z",
  closedAt: null,
  responder: null,
  situation: null,
  refund: null,
  pack: { built: false, savedAt: null, forwarded: false, hasTracking: null },
};

const account = (i: AccountInputs) => buildDisputeAccount(i, fmt);
const paragraph = (i: AccountInputs) => {
  const a = account(i);
  return a.sequence.map((k) => say(a.facts[k] as I18nToken)).join(" ");
};

describe("the account, per design state", () => {
  it("A: transcribes the design sentence for sentence", () => {
    const a = account(A);
    expect(a.sequence).toEqual(["claim", "ret", "refund", "match", "filed", "delivery", "outcome", "noReason"]);
    expect(say(a.facts.claim!)).toBe("The customer told their bank a refund was never processed.");
    expect(say(a.facts.ret!)).toBe("A return on this order was created on 27 Oct 2026 and is marked as received.");
    expect(say(a.facts.refund!)).toBe(
      "Shopify records one refund entry on this order with no confirmed amount. The refunded total is 0,00 kr.",
    );
    expect(say(a.facts.match!)).toBe("These records match the customer's claim.");
    expect(say(a.facts.filed!)).toBe(
      "DisputeDesk filed nothing for this dispute, so no evidence from DisputeDesk was part of the decision.",
    );
    expect(say(a.facts.delivery!)).toBe("The carrier confirmed delivery.");
    expect(say(a.facts.outcome!)).toBe(
      "The bank decided in your favour on 4 Nov 2026, the day the dispute opened. 618,00 kr was recovered.",
    );
    expect(say(a.facts.noReason!)).toBe("No reason was given for the decision.");
    expect(say(a.facts.order!)).toBe("Order total 757,00 kr, placed with card payment.");
    expect(a.filedNothing).toBe(true);
  });

  it("B: return in progress, no refund section; outcome is NOT the same day", () => {
    const a = account(B);
    expect(a.sequence).toEqual(["claim", "ret", "refund", "match", "filed", "outcome", "noReason"]);
    expect(say(a.facts.ret!)).toBe("A return on this order is in progress. It is not yet marked as received.");
    expect(say(a.facts.refund!)).toBe("Shopify records no refund on this order. The refunded total is 0,00 kr.");
    expect(say(a.facts.match!)).toBe("These records match the customer's claim.");
    expect(say(a.facts.outcome!)).toBe("The bank decided in your favour on 4 Nov 2026. 899,00 kr was recovered.");
    expect(a.facts.delivery).toBeUndefined();
  });

  it("C: no return on record means no return text at all; one record matches", () => {
    const a = account(C);
    expect(a.sequence).toEqual(["claim", "refund", "match", "filed", "outcome", "noReason"]);
    expect(a.facts.ret).toBeUndefined();
    expect(say(a.facts.refund!)).toBe(
      "Shopify records one refund entry on this order, made on 29 Oct 2026 before the dispute, with no confirmed amount. The refunded total is 0,00 kr.",
    );
    expect(say(a.facts.match!)).toBe("This record matches the customer's claim.");
    expect(say(a.facts.outcome!)).toBe(
      "The bank decided in your favour on 30 Oct 2026, the day the dispute opened. 1 148,00 kr was recovered.",
    );
    expect(say(a.facts.tracking!)).toBe("Shipping tracking is not in the evidence pack.");
  });

  it("E: open, no pack", () => {
    const a = account(E);
    expect(a.sequence).toEqual(["claim", "opened", "due", "pack"]);
    expect(paragraph(E)).toBe(
      "The customer told their bank the order never arrived. The dispute opened on 2 Nov 2026. A response is due by 20 Nov 2026. No evidence pack has been built yet, and nothing has been saved to Shopify.",
    );
  });
});

describe("derived from the record, never hardcoded", () => {
  it("'the day the dispute opened' only on the same calendar day", () => {
    expect(say(account(A).facts.outcome!)).toContain("the day the dispute opened");
    expect(say(account(B).facts.outcome!)).not.toContain("the day the dispute opened");
  });

  it("'DisputeDesk filed nothing' only when nothing was filed by DisputeDesk", () => {
    const filed = account({ ...A, responder: "we", filedAt: "2026-11-02T10:00:00Z" });
    expect(filed.filedNothing).toBe(false);
    expect(say(filed.facts.filed!)).toBe("DisputeDesk filed evidence for this dispute on 2 Nov 2026.");
    expect(paragraph({ ...A, responder: "we", filedAt: "2026-11-02T10:00:00Z" })).not.toMatch(/filed nothing/);
    // Unread filing state: no claim either way.
    const unread = account({ ...A, responder: null });
    expect(unread.facts.filed).toBeUndefined();
    expect(unread.filedNothing).toBe(false);
  });

  it("the only reason statement is 'no reason was given'; the bank's reasoning is never claimed", () => {
    for (const i of [A, B, C]) expect(paragraph(i)).not.toMatch(/because|reason(ed|ing) (was|is) that/i);
    expect(account(E).facts.noReason).toBeUndefined(); // nothing decided, nothing to say
  });

  it("match only when the records truly match the claim", () => {
    expect(account({ ...A, refund: stmt({ kind: "some", amount: "618.0", currency: "SEK" }) }).facts.match).toBeUndefined();
    expect(account({ ...A, refund: stmt({ kind: "unknown" }), situation: null }).facts.match).toBeUndefined();
    // No return and no refund on record: nothing for the claim to match.
    expect(account({ ...C, refund: stmt({ kind: "none" }) }).facts.match).toBeUndefined();
    // Not a credit-not-processed claim: no match sentence.
    expect(account({ ...A, reason: "FRAUDULENT" }).facts.match).toBeUndefined();
  });

  it("an unknown return status is never a confirmed return", () => {
    const a = account({ ...A, situation: sit("unknown", null) });
    expect(a.facts.ret).toBeUndefined();
    expect(a.returns).toBe("unknown");
    // And an unknown refund says nothing at all.
    expect(account({ ...A, refund: stmt({ kind: "unknown" }) }).facts.refund).toBeUndefined();
  });

  it("a refund with an amount reads as the amount, not 'no confirmed amount'", () => {
    const a = account({ ...A, refund: stmt({ kind: "some", amount: "220.0", currency: "SEK", refundedAt: "2026-11-02T10:00:00Z" }) });
    expect(say(a.facts.refund!)).toBe("Shopify records 220,00 kr refunded on this order, most recently on 2 Nov 2026.");
  });
});

describe("states the design does not cover (needs sign-off)", () => {
  it("lost, DisputeDesk filed", () => {
    const i: AccountInputs = {
      ...A,
      reason: "PRODUCT_NOT_RECEIVED",
      lifecycle: "lost",
      responder: "we",
      filedAt: "2026-11-02T10:00:00Z",
      situation: null,
      refund: stmt({ kind: "none" }),
    };
    const a = account(i);
    expect(a.sequence).toEqual(["claim", "refund", "filed", "delivery", "outcome", "noReason"]);
    expect(say(a.facts.outcome!)).toBe(
      "The bank decided against you on 4 Nov 2026, the day the dispute opened. 618,00 kr was not returned.",
    );
    expect(a.filedNothing).toBe(false);
  });

  it("won after DisputeDesk filed", () => {
    const a = account({ ...B, responder: "we", filedAt: "2026-11-02T10:00:00Z" });
    expect(say(a.facts.filed!)).toBe("DisputeDesk filed evidence for this dispute on 2 Nov 2026.");
    expect(a.filedNothing).toBe(false);
    expect(a.sequence).toContain("outcome");
  });

  it("a response sent through Shopify keeps 'filed nothing' true and names the response", () => {
    const a = account({ ...B, responder: "shopify", sentAt: "2026-11-03T10:00:00Z" });
    expect(say(a.facts.filed!)).toBe(
      "DisputeDesk filed nothing for this dispute. A response was sent through Shopify on 3 Nov 2026.",
    );
    expect(a.filedNothing).toBe(true);
  });

  it("open stages: saved to Shopify, passed on to the bank", () => {
    const saved = account({ ...E, openStage: "saved_to_shopify", pack: { built: true, savedAt: "2026-11-03T10:00:00Z", forwarded: false, hasTracking: true } });
    expect(say(saved.facts.pack!)).toBe("Evidence for this dispute was saved to Shopify on 3 Nov 2026.");
    const fwd = account({ ...E, openStage: "under_review", pack: { built: true, savedAt: "2026-11-03T10:00:00Z", forwarded: true, hasTracking: true } });
    expect(say(fwd.facts.pack!)).toBe("Evidence for this dispute was saved to Shopify, which passed it on to the bank.");
    const built = account({ ...E, pack: { built: true, savedAt: null, forwarded: false, hasTracking: true } });
    expect(say(built.facts.pack!)).toBe("An evidence pack has been built, and nothing has been saved to Shopify yet.");
  });

  it("open dispute with a return on record carries the same return and refund sentences", () => {
    const a = account({ ...E, reason: CNP, situation: sit("in_progress", null), refund: stmt({ kind: "none" }) });
    expect(a.sequence).toEqual(["claim", "ret", "refund", "match", "opened", "due", "pack"]);
  });
});

const rowsA: AccountEvidenceRowInput[] = [
  { field: "refund_policy", title: "Refund policy", positive: true, inPackage: true },
  { field: "shipping_tracking", title: "Shipping tracking", positive: false, inPackage: true },
  { field: "order_confirmation", title: "Order confirmation", positive: false, inPackage: true },
  { field: "refund_record", title: "Refund record", positive: false, inPackage: true },
];

describe("consistency: every use of a fact is the one record's sentence", () => {
  const cases: Array<[string, AccountInputs]> = [["A", A], ["B", B], ["C", C], ["E", E]];
  for (const [name, i] of cases) {
    it(`${name}: all uses read the record's own token`, () => {
      const a = account(i);
      const page = buildAccountPage(a, {
        evidenceRows: rowsA,
        missing: [
          { field: "refund_record", title: "Refund record", whyItMatters: "x" },
          { field: "shipping_tracking", title: "Shipping tracking", whyItMatters: "y" },
        ],
        hasRefundChecklistRow: true,
      });
      // Hero paragraph = the sequence, resolved.
      expect(page.hero.account.map((t) => say(t)).join(" ")).toBe(paragraph(i));
      for (const u of page.reader.uses()) {
        expect(u.token).toBe(a.facts[u.key]);
      }
      for (const s of page.seen) expect(s.token).toBe(a.facts[s.key]);
      for (const s of page.steps) {
        const used = page.reader.uses().filter((u) => u.token === s.line);
        expect(used.length).toBeGreaterThan(0);
      }
      for (const g of [...page.evidence.groups, ...page.review.groups]) {
        for (const r of g.rows) if (r.desc) expect(Object.values(a.facts)).toContain(r.desc);
      }
      for (const m of page.evidence.missing) if (m.kind === "fact") expect(Object.values(a.facts)).toContain(m.fact);
      if (page.evidence.explainer) expect(Object.values(a.facts)).toContain(page.evidence.explainer);
      if (page.review.packLine) expect(Object.values(a.facts)).toContain(page.review.packLine);
      // Evidence and Review are built from the same rows and the same facts.
      expect(page.review.groups).toEqual(page.evidence.groups);
    });
  }

  it("the design's table: A uses refund on the account, What we saw, the pill, the timeline, the rows", () => {
    const page = buildAccountPage(account(A), { evidenceRows: rowsA, missing: [], hasRefundChecklistRow: true });
    const refund = page.reader.uses().find((u) => u.key === "refund")!;
    expect(refund.where.join(" | ")).toMatch(/Account/);
    expect(refund.where.join(" | ")).toMatch(/What we saw/);
    expect(refund.where.join(" | ")).toMatch(/checklist pill/);
  });

  it("nothing filed: one 'In the evidence pack' group, never positive/context", () => {
    const page = buildAccountPage(account(A), { evidenceRows: rowsA, missing: [], hasRefundChecklistRow: true });
    expect(page.evidence.groups.map((g) => g.kind)).toEqual(["pack"]);
    expect(page.evidence.groups[0].rows).toHaveLength(4);
    expect(page.evidence.groups[0].rows.every((r) => r.desc === null)).toBe(true);
  });

  it("filed by DisputeDesk: positive and context groups, rows described by the same facts", () => {
    const i: AccountInputs = { ...A, responder: "we", filedAt: "2026-11-02T10:00:00Z" };
    const acc = account(i);
    const page = buildAccountPage(acc, { evidenceRows: rowsA, missing: [], hasRefundChecklistRow: true });
    expect(page.evidence.groups.map((g) => g.kind)).toEqual(["positive", "context"]);
    const ctx = page.evidence.groups[1].rows;
    expect(ctx.find((r) => r.field === "refund_record")!.desc).toBe(acc.facts.refund);
    expect(ctx.find((r) => r.field === "shipping_tracking")!.desc).toBe(acc.facts.delivery);
    expect(ctx.find((r) => r.field === "order_confirmation")!.desc).toBe(acc.facts.order);
  });

  it("refund pill reads the refund kind, in step with the sentence", () => {
    const pill = (i: AccountInputs) =>
      buildAccountPage(account(i), { evidenceRows: [], missing: [], hasRefundChecklistRow: true }).refundPill;
    expect(say(pill(A)!.label)).toBe("No confirmed amount");
    expect(say(pill(B)!.label)).toBe("No refund recorded");
  });

  it("state E timeline: opened, now, due — each line the record's sentence", () => {
    const page = buildAccountPage(account(E), { evidenceRows: [], missing: [], hasRefundChecklistRow: false });
    expect(page.steps.map((s) => say(s.title))).toEqual(["Dispute opened", "Evidence pack", "Response due"]);
    expect(say(page.stepsTitle)).toBe("What happens now");
    expect(page.steps[1].at).toBeNull();
  });

  it("state A timeline: return created, dispute opened, decided", () => {
    const page = buildAccountPage(account(A), { evidenceRows: [], missing: [], hasRefundChecklistRow: true });
    expect(page.steps.map((s) => say(s.title))).toEqual(["Return created", "Dispute opened", "Decided in your favour"]);
  });
});

describe("no contradictions in any locale", () => {
  const FORBIDDEN_WITH_RECORD = [/no return initiated/i, /no refund issued/i, /automatic response/i];
  const NOT_FOR_NO_AMOUNT = /pending|started|failed|issued|successful/i;

  it("English account text never contradicts the record", () => {
    for (const i of [A, B, C]) {
      const text = paragraph(i);
      for (const re of FORBIDDEN_WITH_RECORD) expect(text).not.toMatch(re);
    }
    // recorded_no_amount stays neutral (A and C).
    expect(say(account(A).facts.refund!)).not.toMatch(NOT_FOR_NO_AMOUNT);
    expect(say(account(C).facts.refund!)).not.toMatch(NOT_FOR_NO_AMOUNT);
  });

  it("C has no return text anywhere on the account", () => {
    expect(paragraph(C)).not.toMatch(/return/i);
  });

  it("every locale resolves every token the states produce, with no leftover placeholders", () => {
    for (const loc of LOCALES) {
      for (const i of [A, B, C, E, { ...A, lifecycle: "lost" as const, responder: "we" as const, filedAt: "2026-11-02T10:00:00Z" }]) {
        const a = account(i);
        for (const k of a.sequence) {
          const s = say(a.facts[k]!, loc);
          expect(s, `${loc}:${k}`).not.toMatch(/\{|\}|disputes\.account/);
        }
      }
    }
  });

  it("no bare gateway codes in any account sentence", () => {
    for (const loc of LOCALES) {
      const a = account({ ...A });
      for (const k of a.sequence) expect(say(a.facts[k]!, loc)).not.toMatch(/\b(AVS|CVV)\b/);
    }
  });

  it("recorded_no_amount copy is neutral in every locale (reuses the pending/failed vocabulary check)", () => {
    const bad: Record<string, RegExp> = {
      en: /pending|started|failed|issued|successful/i,
      de: /ausstehend|gestartet|fehlgeschlagen|ausgestellt|erfolgreich/i,
      es: /pendiente|iniciado|fallid|emitid|exitos/i,
      fr: /en attente|démarré|échou|émis|réussi/i,
      pt: /pendente|iniciad|malsucedid|emitid|bem-sucedid/i,
      sv: /väntande|påbörjad|misslyck|utfärdad|lyckad/i,
    };
    for (const loc of LOCALES) {
      const a = account(C);
      expect(say(a.facts.refund!, loc), loc).not.toMatch(bad[loc]);
    }
  });
});
