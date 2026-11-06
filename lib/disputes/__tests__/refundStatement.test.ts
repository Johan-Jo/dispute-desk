/**
 * The refund statement (lib/disputes/refundStatement.ts): one contract for what
 * Shopify records about refunds, read by every merchant-facing refund sentence.
 *
 * Pack shapes mirror lib/packs/sources/orderSource.ts: the order section stores
 * `totals.refunded`; the refundHistory section exists only when the order has
 * >= 1 refund entry, and a zero-total entry carries refundStatus "none".
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isZeroAmount,
  refundStatementFromPackSections,
  refundStatementTokens,
  type RefundStatement,
} from "../refundStatement";
import { unavailableReasonToken } from "../unavailableReasonToken";
import { buildRefundPresentation } from "@/lib/argument/refundPresentation";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";

const ROOT = process.cwd();
const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, "messages", `${l}.json`), "utf8"))]),
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

function lookup(locale: (typeof LOCALES)[number], key: string): string {
  const v = key.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], messages[locale]);
  if (typeof v !== "string") throw new Error(`missing ${locale}:${key}`);
  return v;
}
const translator = (locale: (typeof LOCALES)[number]) => (key: string, params?: Record<string, string | number>) =>
  lookup(locale, key).replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? `{${p}}`));
const say = (token: I18nToken, locale: (typeof LOCALES)[number] = "en") =>
  resolveToken(translator(locale), token) as string;

const ASOF = "2026-11-04T10:00:00Z";

function sections(opts: { refunded?: string | null; entries?: unknown[] | "absent-array"; noRefundSection?: boolean }) {
  const totals: Record<string, unknown> = { currency: "SEK", total: "500.0" };
  if (opts.refunded !== undefined && opts.refunded !== null) totals.refunded = opts.refunded;
  const out: unknown[] = [
    { type: "order", labelToken: { key: "packs.section.order" }, data: { orderName: "#1", totals } },
  ];
  if (!opts.noRefundSection && opts.entries !== undefined) {
    out.push({
      type: "order",
      labelToken: { key: "packs.section.refundHistory" },
      data: {
        refundStatus: "none",
        amount: opts.refunded ?? "0.0",
        currency: "SEK",
        ...(opts.entries === "absent-array" ? {} : { refunds: opts.entries }),
      },
    });
  }
  return out;
}
const entry = (amount: string, createdAt = "2026-10-01T09:00:00Z") => ({ id: `r-${amount}-${createdAt}`, createdAt, note: null, amount, currency: "SEK" });

/** The six cases of the plan, as packs. A failed, a pending and an
 *  entry-without-transactions refund all store as the same zero entry. */
const CASES: Array<{ name: string; pack: unknown[]; kind: RefundStatement["kind"] }> = [
  { name: "no entries", pack: sections({ refunded: "0.0" }), kind: "none" },
  { name: "zero entry", pack: sections({ refunded: "0.0", entries: [entry("0.0")] }), kind: "recorded_no_amount" },
  { name: "failed refund (zero entry, same stored shape)", pack: sections({ refunded: "0.00", entries: [entry("0.00")] }), kind: "recorded_no_amount" },
  { name: "later successful (positive total)", pack: sections({ refunded: "120.0", entries: [entry("0.0", "2026-10-02T00:00:00Z"), entry("120.0", "2026-10-01T00:00:00Z")] }), kind: "some" },
  { name: "entry without transactions (zero entry)", pack: sections({ refunded: "0.0", entries: [entry("0.0")] }), kind: "recorded_no_amount" },
  { name: "positive", pack: sections({ refunded: "250.0", entries: [entry("250.0")] }), kind: "some" },
];

describe("refundStatementFromPackSections", () => {
  for (const c of CASES) {
    it(`${c.name} -> ${c.kind}`, () => {
      expect(refundStatementFromPackSections(c.pack, ASOF)?.kind).toBe(c.kind);
    });
  }

  it("a pre-stamp pack that never stored totals.refunded is unknown, not none", () => {
    expect(refundStatementFromPackSections(sections({}), ASOF)?.kind).toBe("unknown");
    expect(refundStatementFromPackSections(sections({ refunded: null, entries: [] }), ASOF)?.kind).toBe("unknown");
  });

  it("an empty refunds[] reads like no entries", () => {
    expect(refundStatementFromPackSections(sections({ refunded: "0.0", entries: [] }), ASOF)?.kind).toBe("none");
  });

  it("a refund section without a refunds[] array is unknown", () => {
    expect(refundStatementFromPackSections(sections({ refunded: "0.0", entries: "absent-array" }), ASOF)?.kind).toBe("unknown");
  });

  it("zero comparison is numeric: '0', '0.0' and '0.00' are the same zero", () => {
    for (const z of ["0", "0.0", "0.00", "0.000"]) {
      expect(refundStatementFromPackSections(sections({ refunded: z }), ASOF)?.kind, z).toBe("none");
      expect(refundStatementFromPackSections(sections({ refunded: z, entries: [entry(z)] }), ASOF)?.kind, z).toBe("recorded_no_amount");
      expect(isZeroAmount(z)).toBe(true);
    }
    expect(isZeroAmount("0.01")).toBe(false);
    expect(isZeroAmount(null)).toBe(false);
    expect(isZeroAmount("abc")).toBe(false);
  });

  it("some: amount, currency, and refundedAt from positive entries only (not a later failed 0.0 entry)", () => {
    const s = refundStatementFromPackSections(
      sections({ refunded: "120.0", entries: [entry("0.0", "2026-10-09T00:00:00Z"), entry("120.0", "2026-10-01T00:00:00Z")] }),
      ASOF,
    );
    expect(s).toMatchObject({ kind: "some", amount: "120.0", currency: "SEK", refundedAt: "2026-10-01T00:00:00Z", asOf: ASOF });
  });

  it("is null-safe on malformed sections", () => {
    expect(refundStatementFromPackSections(null)).toBeNull();
    expect(refundStatementFromPackSections([])).toBeNull();
    expect(refundStatementFromPackSections([null, undefined, 3, { data: null }])).toBeNull();
    const s = refundStatementFromPackSections(
      [
        null,
        { labelToken: { key: "packs.section.order" }, data: { totals: null } },
        { labelToken: { key: "packs.section.refundHistory" }, data: { refunds: [null, undefined, "x", { amount: null }, entry("0.0")] } },
      ],
      ASOF,
    );
    expect(s?.kind).toBe("unknown");
  });
});

describe("refundStatementTokens", () => {
  it("uses the disputes.refundStatement keys, and a no-date variant when there is no date", () => {
    expect(refundStatementTokens({ kind: "none", asOf: ASOF })).toEqual({
      title: { key: "disputes.refundStatement.none.title" },
      detail: { key: "disputes.refundStatement.none.detail", params: { date: "Nov 4" } },
    });
    expect(refundStatementTokens({ kind: "recorded_no_amount", asOf: null }).detail).toEqual({
      key: "disputes.refundStatement.recordedNoAmount.detailNoDate",
    });
    expect(refundStatementTokens({ kind: "unknown", asOf: ASOF }).detail).toEqual({
      key: "disputes.refundStatement.unknown.detail",
    });
    expect(
      refundStatementTokens({ kind: "some", amount: "120.0", currency: "SEK", refundedAt: "2026-10-01T00:00:00Z", asOf: ASOF }).detail,
    ).toEqual({ key: "disputes.refundStatement.some.detail", params: { amount: "120.0 SEK", date: "Oct 1" } });
  });

  it("every token key exists in all six locales", () => {
    for (const locale of LOCALES) {
      for (const kind of ["none", "recorded_no_amount", "some", "unknown"] as const) {
        const stmt: RefundStatement = { kind, amount: "1.0", currency: "SEK", refundedAt: "2026-10-01T00:00:00Z", asOf: ASOF };
        const { title, detail } = refundStatementTokens(stmt);
        expect(say(title, locale).length, `${locale} ${kind} title`).toBeGreaterThan(3);
        expect(say(detail, locale), `${locale} ${kind}`).not.toMatch(/\{\w+\}/);
      }
      for (const kind of ["none", "recorded_no_amount", "some"] as const) {
        const { detail } = refundStatementTokens({ kind, amount: "1.0", asOf: null });
        expect(say(detail, locale), `${locale} ${kind} no date`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("recorded_no_amount copy never says pending/started/issued/failed/successful, in any locale", () => {
    const forbidden: Record<(typeof LOCALES)[number], RegExp> = {
      en: /pending|started|issued|failed|successful/i,
      de: /ausstehend|gestartet|ausgestellt|veranlasst|fehlgeschlagen|erfolgreich/i,
      es: /pendiente|iniciad|emitid|fallid|exitos/i,
      fr: /en attente|lancé|émis|effectué|échoué|réussi/i,
      pt: /pendente|iniciad|emitid|falh|sucesso|bem-sucedid/i,
      sv: /väntande|påbörjad|utfärdad|genomförd|misslyck|lyckad/i,
    };
    for (const locale of LOCALES) {
      const ns = (messages[locale] as { disputes: { refundStatement: { recordedNoAmount: Record<string, string> } } }).disputes.refundStatement.recordedNoAmount;
      for (const [k, v] of Object.entries(ns)) expect(v, `${locale}.${k}`).not.toMatch(forbidden[locale]);
    }
  });
});

describe("every consumer agrees on the same pack", () => {
  for (const c of CASES) {
    it(`${c.name}: NO_RETURN card, unavailable reason, banner and note state one thing`, () => {
      const stmt = refundStatementFromPackSections(c.pack, ASOF)!;
      const sentence = say(refundStatementTokens(stmt).detail);

      // checklist row reason (stored English, read-time)
      const reasonTok = unavailableReasonToken("No refund was issued on this order", stmt)!;
      expect(say(reasonTok)).toBe(sentence);

      // NO_RETURN card: a refund clause only for `none`, and then it is the same sentence
      const card = buildRefundPresentation({ returnStatus: "NO_RETURN" }, stmt)!;
      const clauses = card.factsTokens.slice(1).map((t) => say(t));
      expect(clauses).toEqual(c.kind === "none" ? [sentence] : []);
      expect(say(card.titleToken)).toBe("No return initiated");

      // the card never says a zero-amount entry means "no refund"
      const all = [sentence, ...card.factsTokens.map((t) => say(t)), say(reasonTok)].join(" ");
      if (c.kind !== "none") expect(all).not.toMatch(/no refund/i);
      if (c.kind === "recorded_no_amount") expect(all).toMatch(/refund entry/i);
    });
  }

  it("an unknown or absent statement never produces 'no refund' wording", () => {
    const tok = unavailableReasonToken("No refund was issued on this order", null)!;
    expect(say(tok)).not.toMatch(/no refund/i);
    expect(tok.key).toBe("disputes.refundStatement.unknown.detail");
  });
});

describe("unavailableReasonToken", () => {
  it("maps every known stored English reason and reason code to a localized key (never the English string)", () => {
    const inputs = [
      "Order is unfulfilled",
      "No card payment on this order",
      "AVS/CVV not returned by payment gateway",
      "No parcel on this order was returned to sender",
      "Awaiting delivery confirmation",
      "return_on_record",
      "refund_on_record",
      "merchant_says_request_received",
      "returned_to_sender",
    ];
    for (const r of inputs) {
      const tok = unavailableReasonToken(r)!;
      expect(tok.key, r).toMatch(/^disputes\.unavailableReason\./);
      expect(tok.key, r).not.toBe("disputes.unavailableReason.generic");
      for (const locale of LOCALES) {
        const text = say(tok, locale);
        expect(text, `${locale} ${r}`).not.toBe(r);
        // no bare gateway codes in merchant copy
        expect(text, `${locale} ${r}`).not.toMatch(/\bAVS\b|\bCVV\b/);
      }
    }
  });

  it("falls back to a neutral generic reason for unknown strings, and null for empty", () => {
    expect(unavailableReasonToken("Something English we never wrote")).toEqual({ key: "disputes.unavailableReason.generic" });
    expect(unavailableReasonToken("")).toBeNull();
    expect(unavailableReasonToken(undefined)).toBeNull();
    for (const locale of LOCALES) {
      expect(say({ key: "disputes.unavailableReason.generic" }, locale).length).toBeGreaterThan(5);
    }
  });
});

describe("copy and wiring invariants", () => {
  /** Keys outside disputes.refundStatement that already say "no refund" in
   *  en.json, with why each is not a statement of the order's refund state.
   *  Anything NOT listed here fails: new refund copy must go through
   *  disputes.refundStatement. */
  const BASELINE: Record<string, string> = {
    "disputes.strengthReason.refund.insufficient": "evidence-availability sentence ('no refund evidence'), not a statement about the order",
    "disputes.decidedView.checklist.item.refundRecord": "checklist label naming a document ('why no refund was due'), not a claim",
    "disputes.whyText.no_return_initiated": "explains what the evidence field is for ('no refund was owed' argument), not a claim",
    "disputes.evidenceTab.parcelOutcome.disposition.restocked_not_refunded": "merchant's own chosen parcel outcome, not Shopify's record",
    "disputes.signalLabelValue.noRefundOwed": "names the argument the evidence supports ('no refund was owed'), not a record of the order",
  };

  it("no sentence outside disputes.refundStatement says 'no refund' (existing offenders are a reasoned baseline)", () => {
    const hits: string[] = [];
    (function walk(node: unknown, path: string) {
      if (typeof node === "string") {
        if (/\bno refund\b/i.test(node)) hits.push(path);
        return;
      }
      if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    })(messages.en, "");
    const outside = hits.filter((p) => !p.startsWith("disputes.refundStatement."));
    expect(outside.sort()).toEqual(Object.keys(BASELINE).sort());
  });

  it("merchant-facing renderers never show the stored English reason and read refunds only via the statement", () => {
    const overview = readFileSync(join(ROOT, "app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx"), "utf8");
    const builder = readFileSync(join(ROOT, "components/packs/detail/EvidenceBuilderSection.tsx"), "utf8");
    expect(overview).toContain("unavailableReasonToken(");
    expect(builder).toContain("unavailableReasonToken(");
    expect(overview).not.toMatch(/\?\s*item\.unavailableReason\b/);
    expect(builder).not.toMatch(/\{item\.unavailableReason\}/);
    const note = readFileSync(join(ROOT, "app/(embedded)/app/disputes/[id]/tabs/sections/OrderSituationNote.tsx"), "utf8");
    expect(note).toContain("refundStatementTokens(");
    expect(note).not.toMatch(/situation\.refund/);
    const viewer = readFileSync(join(ROOT, "components/packs/detail/EvidenceContentViewer.tsx"), "utf8");
    expect(viewer).not.toMatch(/refunded !== "0\.00"/);
    expect(viewer).toContain("isZeroAmount(payload.totals.refunded)");
  });

  it("bank-facing modules do not read the refund statement", () => {
    const bankFacing = [
      "lib/packs/sources/orderSource.ts",
      "lib/automation/fatalLoss.ts",
      "lib/packs/buildPack.ts",
      "lib/evidence/canonicalEvidence.ts",
      "lib/automation/planForCase.ts",
    ];
    for (const f of bankFacing) {
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      expect(readFileSync(p, "utf8"), f).not.toMatch(/refundStatement|unavailableReasonToken/);
    }
  });
});
