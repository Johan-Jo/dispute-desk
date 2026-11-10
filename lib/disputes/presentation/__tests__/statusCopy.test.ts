/**
 * The action-first status block (docs/plans/dispute-status-copy.plan.md section 10).
 *
 * A table over every state x {inquiry, chargeback}: a headline, a sub-line, and
 * labelled parts none of which is empty. Then the same matrix resolved through
 * all six locale catalogs: no string carries a package version number, one of
 * the four role-count labels, an unresolved placeholder or a raw key.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";
import { composeStatusCopy, type StatusCopyInput, type StatusState } from "../statusCopy";
import type { Ask } from "@/lib/disputes/merchantAsks";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import pt from "@/messages/pt.json";
import sv from "@/messages/sv.json";

const CATALOGS = { en, de, es, fr, pt, sv } as const;

const ask = (id: Ask["id"], priority: Ask["priority"] = "required", pending = true): Ask => ({
  id,
  priority,
  offered: true,
  pending,
});
const claim: I18nToken = { key: "disputes.record.claim.PRODUCT_NOT_RECEIVED" };
const list = { type: "i18n-key" as const, key: "disputes.record.list.and.n2", params: {
  a: { type: "i18n-key" as const, key: "disputes.record.phrase.cited.pay" },
  b: { type: "i18n-key" as const, key: "disputes.record.phrase.cited.delivery" },
} };

function base(phase: "inquiry" | "chargeback", patch: Partial<StatusCopyInput> = {}): StatusCopyInput {
  return {
    status: "open",
    stage: "prepared",
    phase,
    amount: "EUR 64.95",
    hasAmount: true,
    dueDay: "13 Nov 2026",
    deadlineToday: false,
    decidedDay: null,
    lifecycle: "pack_prepared",
    save: "none",
    submissionState: "not_saved",
    automationMode: "auto",
    decision: null,
    build: { state: "succeeded", cause: null, packageWritten: true },
    blockingReason: null,
    fatalReason: null,
    asks: [],
    ackFits: true,
    recordSituation: null,
    claim,
    caseFact: { key: "disputes.record.item.delivery.dateOnly", params: { date: "22 Oct 2026" } },
    citedList: list,
    dates: { saveAttempt: "10 Nov 2026", buildAttempt: "10 Nov 2026", filed: "10 Nov 2026", queued: "10 Nov 2026" },
    responder: null,
    decided: { outcome: { key: "disputes.record.outcome.won.chargeback", params: { date: "1 Dec 2026", amount: "EUR 64.95" } }, filedElsewhere: null },
    stateToken: { key: "disputes.record.state.building" },
    attentionToken: { key: "disputes.record.attention.plain" },
    hasPackage: true,
    ...patch,
  };
}

const CASES: Array<{ name: string; expect: StatusState; patch: Partial<StatusCopyInput> }> = [
  { name: "A parcel outcome", expect: "ask", patch: { stage: "needs_attention", asks: [ask("parcel_outcome")] } },
  { name: "A parcel outcome, deadline today", expect: "ask", patch: { stage: "needs_attention", deadlineToday: true, asks: [ask("parcel_outcome")], build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
  { name: "A return request", expect: "ask", patch: { asks: [ask("return_request")] } },
  { name: "A bank claim", expect: "ask", patch: { asks: [ask("bank_claim")] } },
  { name: "B review awaiting approval", expect: "approval", patch: { stage: "prepared_review", automationMode: "review", asks: [ask("review_decision")] } },
  { name: "C scheduled, auto", expect: "scheduled", patch: { stage: "held" } },
  { name: "C scheduled, optional evidence", expect: "scheduled", patch: { asks: [ask("missing_evidence", "optional")] } },
  { name: "C scheduled, optional acknowledgement", expect: "scheduled", patch: { asks: [ask("cardholder_ack", "optional")] } },
  { name: "C scheduled, no deadline", expect: "scheduled", patch: { dueDay: null } },
  { name: "C approved in review mode", expect: "scheduled", patch: { stage: "prepared_review", automationMode: "review", decision: "approved" } },
  { name: "conceded", expect: "conceded", patch: { stage: "prepared_review", automationMode: "review", decision: "conceded" } },
  { name: "D being filed", expect: "filing", patch: { lifecycle: "save_queued", save: "queued" } },
  { name: "E filed, accepted", expect: "filed", patch: { stage: "saved", lifecycle: "saved_to_shopify", submissionState: "saved_to_shopify" } },
  { name: "E filed, passed to the bank", expect: "filed", patch: { stage: "under_review", lifecycle: "under_review", submissionState: "submitted_confirmed" } },
  { name: "E sent through Shopify, not by us", expect: "sent_by_shopify", patch: { stage: "under_review", lifecycle: "under_review", submissionState: "responded_via_shopify" } },
  { name: "F could not be filed", expect: "save_failed", patch: { lifecycle: "save_failed", save: "failed" } },
  { name: "F could not be filed, no date", expect: "save_failed", patch: { lifecycle: "save_failed", save: "failed", dates: { saveAttempt: null, buildAttempt: null, filed: null, queued: null } } },
  { name: "stamped saved, never confirmed", expect: "unconfirmed", patch: { stage: "saved", lifecycle: "monitoring", save: "stamped_unconfirmed" } },
  { name: "G response could not be written", expect: "build_failed", patch: { stage: "held", build: { state: "failed", cause: "no_counsel_letter", packageWritten: false } } },
  { name: "G response could not be written, review mode", expect: "build_failed", patch: { stage: "held", automationMode: "review", build: { state: "failed", cause: "x", packageWritten: false } } },
  { name: "G build paused by the daily limit", expect: "build_paused", patch: { build: { state: "capped", cause: "daily_cap_reached", packageWritten: false } } },
  { name: "H skipped: no bank-eligible facts", expect: "nothing_to_argue", patch: { build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
  { name: "H skipped: return on record", expect: "nothing_to_argue", patch: { recordSituation: "return", build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
  { name: "H skipped: refund on record", expect: "nothing_to_argue", patch: { recordSituation: "refund", build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
  { name: "H fatal: refund issued", expect: "nothing_to_argue", patch: { stage: "fatal", fatalReason: "refund_issued" } },
  { name: "H fatal: never fulfilled", expect: "nothing_to_argue", patch: { stage: "fatal", fatalReason: "inr_no_fulfillment" } },
  { name: "I covered by Shopify Protect", expect: "covered", patch: { stage: "covered" } },
  { name: "J plan limit reached", expect: "plan_limit", patch: { stage: "needs_attention", blockingReason: "quota_exceeded", build: null, hasPackage: false } },
  { name: "preparing: no pack", expect: "preparing", patch: { stage: "no_pack", build: null, hasPackage: false } },
  { name: "preparing: building", expect: "preparing", patch: { stage: "building", build: null, hasPackage: false } },
  { name: "other blocking reason", expect: "attention", patch: { stage: "needs_attention", blockingReason: "auto_build_off" } },
  { name: "K won, we filed", expect: "won", patch: { status: "won", stage: "decided", decidedDay: "1 Dec 2026", responder: "we" } },
  { name: "K lost, we filed", expect: "lost", patch: { status: "lost", stage: "decided", decidedDay: "1 Dec 2026", responder: "we" } },
  { name: "K won, Shopify answered", expect: "won", patch: { status: "won", stage: "decided", decidedDay: "1 Dec 2026", responder: "shopify", decided: { outcome: { key: "disputes.record.outcome.won.chargeback", params: { date: "1 Dec 2026", amount: "EUR 64.95" } }, filedElsewhere: { key: "disputes.record.filed.shopifyNoDate" } } } },
  { name: "K won, no amount", expect: "won", patch: { status: "won", stage: "decided", hasAmount: false, decidedDay: null, responder: "we" } },
  { name: "K closed", expect: "closed", patch: { status: "closed", stage: "decided", decidedDay: "1 Dec 2026", responder: "none" } },
];

const PHASES = ["inquiry", "chargeback"] as const;

describe("composeStatusCopy: every state x phase", () => {
  for (const c of CASES) {
    for (const phase of PHASES) {
      it(`${c.name} (${phase}) -> ${c.expect}, headline + sub-line + no empty labelled part`, () => {
        const out = composeStatusCopy(base(phase, c.patch));
        expect(out.state).toBe(c.expect);
        expect(out.headline.key).toMatch(/^disputes\.record\./);
        expect(out.subline.key).toMatch(/^disputes\.record\.status\.subline\./);
        expect(out.parts.length).toBeGreaterThan(0);
        const kinds = out.parts.map((p) => p.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
        for (const p of out.parts) {
          expect(p.lines.length + p.actions.length, `part ${p.kind} is empty`).toBeGreaterThan(0);
        }
      });
    }
  }

  it("the inquiry explanation appears only for open inquiries that were filed", () => {
    const filed = (phase: "inquiry" | "chargeback") =>
      composeStatusCopy(base(phase, { stage: "saved", lifecycle: "saved_to_shopify", submissionState: "saved_to_shopify" }));
    const text = (o: ReturnType<typeof filed>) => o.parts.flatMap((p) => p.lines.map((l) => l.key));
    expect(text(filed("inquiry"))).toContain("disputes.record.status.next.inquiry");
    expect(text(filed("chargeback"))).not.toContain("disputes.record.status.next.inquiry");
    expect(text(filed("chargeback"))).toContain("disputes.record.status.next.chargeback");
  });

  it("'today' is in the ask headline only when the deadline is today", () => {
    const h = (today: boolean) =>
      composeStatusCopy(base("inquiry", { asks: [ask("parcel_outcome")], deadlineToday: today })).headline.key;
    expect(h(true)).toBe("disputes.record.status.headline.askParcelToday");
    expect(h(false)).toBe("disputes.record.status.headline.askParcel");
  });

  it("a required ask never reads 'Nothing to do'", () => {
    for (const id of ["parcel_outcome", "return_request", "bank_claim"] as const) {
      const out = composeStatusCopy(base("chargeback", { asks: [ask(id)] }));
      expect(out.state).toBe("ask");
      expect(out.headline.key).toMatch(/headline\.ask/);
    }
  });

  it("the cardholder acknowledgement is not offered where it does not fit", () => {
    const out = composeStatusCopy(base("inquiry", { asks: [ask("cardholder_ack", "optional")], ackFits: false }));
    expect(out.parts.flatMap((p) => p.actions.map((a) => a.id))).not.toContain("ack");
  });

  it("a review decision with no response written is not 'the response is ready'", () => {
    const out = composeStatusCopy(
      base("inquiry", {
        stage: "needs_attention",
        automationMode: "review",
        asks: [ask("review_decision")],
        build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false },
      }),
    );
    expect(out.state).toBe("nothing_to_argue");
  });

  it("an unapproved review-mode dispute is not promised the deadline email", () => {
    const keys = (decision: "approved" | null) =>
      composeStatusCopy(
        base("inquiry", { stage: "held", automationMode: "review", decision, build: { state: "failed", cause: "x", packageWritten: false } }),
      ).parts.flatMap((p) => p.lines.map((l) => l.key));
    expect(keys(null)).toContain("disputes.record.status.next.buildNoFileQuiet");
    expect(keys("approved")).toContain("disputes.record.status.next.buildNoFile");
  });
});

/** The four role-count labels, per locale, exactly as the old hero chips printed them. */
function roleLabels(catalog: typeof en): string[] {
  const r = catalog.disputes.record.role;
  return [r.cited, r.context, r.internal, r.unavailable];
}

describe("composeStatusCopy: all six locales", () => {
  const snapshot: Record<string, string[]> = {};
  for (const [locale, messages] of Object.entries(CATALOGS)) {
    const t = createTranslator({ locale, messages: messages as never }) as never;
    const labels = roleLabels(messages as typeof en);
    const texts: string[] = [];
    for (const c of CASES) {
      for (const phase of PHASES) {
        const out = composeStatusCopy(base(phase, c.patch));
        const toks: I18nToken[] = [out.headline, out.subline, ...out.parts.flatMap((p) => [p.label, ...p.lines, ...p.actions.flatMap((a) => (a.meta ? [a.label, a.meta] : [a.label]))])];
        for (const tok of toks) texts.push(resolveToken(t, tok) as string);
      }
    }
    snapshot[locale] = [...new Set(texts)];

    it(`${locale}: no hero string has a version number, a role-count label, a placeholder or a raw key`, () => {
      for (const s of texts) {
        expect(s, s).not.toMatch(/\b(version|versión|versão)\s*\d/i);
        expect(s, s).not.toMatch(/\{|\}/);
        expect(s, s).not.toMatch(/disputes\.|record\.status/);
        for (const label of labels) expect(s, `${s} contains "${label}"`).not.toContain(label);
      }
    });

    it(`${locale}: never the phrase "Shopify automatic response"`, () => {
      for (const s of texts) expect(s.toLowerCase()).not.toMatch(/automatic response|automatische antwort|respuesta autom|réponse automatique|resposta autom|automatiskt svar/);
    });
  }

  it("every string of every locale, as a reviewable snapshot", () => {
    expect(snapshot).toMatchSnapshot();
  });
});
