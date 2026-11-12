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
import { composeStatusCopy, type StatusCopy, type StatusCopyInput, type StatusState } from "../statusCopy";
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
  consumedBy: null,
});
const NO_REFUND = { kind: "none" as const, amount: null, day: null, stalled: false };
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
    returnedToSender: false,
    recordSituation: null,
    returns: "none",
    refundLive: null,
    claim,
    caseFact: { key: "disputes.record.item.delivery.dateOnly", params: { date: "22 Oct 2026" } },
    citedList: list,
    dates: { saveAttempt: "10 Nov 2026", buildAttempt: "10 Nov 2026", filed: "10 Nov 2026", queued: "10 Nov 2026" },
    responder: null,
    decided: { outcome: { key: "disputes.record.outcome.won.chargeback", params: { date: "1 Dec 2026", amount: "EUR 64.95" } }, filedElsewhere: null },
    stateToken: { key: "disputes.record.state.building" },
    attentionToken: { key: "disputes.record.attention.plain" },
    hasPackage: true,
    unconfirmedStamp: false,
    ...patch,
  };
}

const CASES: Array<{ name: string; expect: StatusState; patch: Partial<StatusCopyInput> }> = [
  { name: "A return request, deadline today", expect: "ask", patch: { stage: "needs_attention", deadlineToday: true, asks: [ask("return_request")], build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
  { name: "A returned parcel, nothing to argue", expect: "nothing_to_argue", patch: { stage: "needs_attention", returnedToSender: true, build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false } } },
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
        expect(out.chip.key, "chip and headline come from the same state").toBe(`disputes.record.status.chip.${out.state}`);
        if (out.state === "approval") expect(out.parts.flatMap((p) => p.actions.map((a) => a.id))).toEqual(["decide:approved", "decide:conceded"]);
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
      composeStatusCopy(base("inquiry", { asks: [ask("return_request")], deadlineToday: today })).headline.key;
    expect(h(true)).toBe("disputes.record.status.headline.askReturnToday");
    expect(h(false)).toBe("disputes.record.status.headline.askReturn");
  });

  it("the sub-line says 'today' under the same condition as the headline", () => {
    const sub = (today: boolean) =>
      composeStatusCopy(base("inquiry", { asks: [ask("return_request")], deadlineToday: today })).subline.key;
    expect(sub(true)).toBe("disputes.record.status.subline.openToday");
    expect(sub(false)).toBe("disputes.record.status.subline.open");
  });

  it("a required ask never reads 'Nothing to do'", () => {
    for (const id of ["return_request", "bank_claim"] as const) {
      const out = composeStatusCopy(base("chargeback", { asks: [ask(id)] }));
      expect(out.state).toBe("ask");
      expect(out.headline.key).toMatch(/headline\.ask/);
    }
  });

  it("a returned parcel with no response to file names the parcel, asks for nothing and does not suggest evidence", () => {
    const out = composeStatusCopy(
      base("inquiry", {
        stage: "needs_attention",
        returnedToSender: true,
        refundLive: NO_REFUND,
        caseFact: { key: "disputes.record.status.fact.returnedToSender" },
        build: { state: "declined", cause: "no_bank_eligible_facts", packageWritten: false },
      }),
    );
    expect(out.state).toBe("nothing_to_argue");
    expect(out.headline.key).toBe("disputes.record.status.headline.nothingToArgue");
    const keys = out.parts.flatMap((p) => p.lines.map((l) => l.key));
    expect(keys).toContain("disputes.record.status.fact.returnedToSender");
    expect(keys).toContain("disputes.record.status.next.recheck");
    expect(keys).not.toContain("disputes.record.status.next.shopifySends");
    expect(keys).not.toContain("disputes.record.status.next.expectLoss");
    expect(out.parts.map((p) => p.kind)).not.toContain("need");
    expect(keys).not.toContain("disputes.record.status.can.evidence");
    // The only thing offered is the refund, and only because this is an inquiry.
    expect(keys).toContain("disputes.record.status.can.refundInquiry");
  });

  describe("refund advice (inquiries only)", () => {
    const returned = { returnedToSender: true, refundLive: NO_REFUND, caseFact: { key: "disputes.record.status.fact.returnedToSender" } };
    const refundKey = "disputes.record.status.can.refundInquiry";
    const keysOf = (c: StatusCopy) => c.parts.flatMap((p) => p.lines.map((l) => l.key));
    const open = [
      { stage: "held" as const },
      { stage: "needs_attention" as const, build: { state: "declined" as const, cause: "no_bank_eligible_facts", packageWritten: false } },
    ];

    it("is shown on an open inquiry whose parcel came back, in every state that is still open", () => {
      for (const patch of open) expect(keysOf(composeStatusCopy(base("inquiry", { ...returned, ...patch })))).toContain(refundKey);
    });

    it("is never shown on a chargeback: the money is already gone and Shopify blocks the refund", () => {
      for (const patch of open) expect(keysOf(composeStatusCopy(base("chargeback", { ...returned, ...patch })))).not.toContain(refundKey);
    });

    it("is not shown when the parcel did not come back, when a refund already covers it, or once decided", () => {
      expect(keysOf(composeStatusCopy(base("inquiry", { stage: "held" })))).not.toContain(refundKey);
      expect(keysOf(composeStatusCopy(base("inquiry", { ...returned, stage: "fatal", fatalReason: "refund_issued" })))).not.toContain(refundKey);
      expect(keysOf(composeStatusCopy(base("inquiry", { ...returned, status: "won", stage: "decided" })))).not.toContain(refundKey);
    });

    describe("a return the store has in Shopify (credit not processed, no refund)", () => {
      const evidenceKey = "disputes.record.status.can.evidence";
      const nothing = {
        stage: "needs_attention" as const,
        build: { state: "declined" as const, cause: "no_bank_eligible_facts", packageWritten: false },
        recordSituation: "return" as const,
        refundLive: NO_REFUND,
      };

      it.each(["in_progress", "returned"] as const)("advises the refund and asks for no evidence when the return is %s", (returns) => {
        const out = composeStatusCopy(base("inquiry", { ...nothing, returns }));
        expect(out.state).toBe("nothing_to_argue");
        expect(keysOf(out)).toContain(refundKey);
        expect(keysOf(out)).not.toContain(evidenceKey);
        expect(out.parts.flatMap((p) => p.actions.map((a) => a.id))).not.toContain("tab:evidence");
      });

      it("never advises it on a chargeback", () => {
        expect(keysOf(composeStatusCopy(base("chargeback", { ...nothing, returns: "returned" })))).not.toContain(refundKey);
      });

      it("does not advise it for a requested or failed return, or when a full refund is already issued", () => {
        for (const returns of ["requested", "failed", "none", "unknown"] as const) {
          expect(keysOf(composeStatusCopy(base("inquiry", { ...nothing, returns })))).not.toContain(refundKey);
        }
        const refunded = base("inquiry", { ...nothing, returns: "returned", stage: "fatal", fatalReason: "refund_issued" });
        expect(keysOf(composeStatusCopy(refunded))).not.toContain(refundKey);
      });

      it("with no return on record the evidence ask is unchanged", () => {
        const out = composeStatusCopy(base("inquiry", { ...nothing, recordSituation: null, returns: "none" }));
        expect(keysOf(out)).toContain(evidenceKey);
      });
    });

    describe("what the LIVE refund state says (the pack cannot: a pending refund reads 0.0 there)", () => {
      const nothing = {
        stage: "needs_attention" as const,
        build: { state: "declined" as const, cause: "no_bank_eligible_facts", packageWritten: false },
        recordSituation: "return" as const,
        returns: "in_progress" as const,
      };
      const live = (kind: "none" | "pending" | "settled" | "failed" | "mixed" | "unknown", patch: Partial<NonNullable<StatusCopyInput["refundLive"]>> = {}) => ({
        refundLive: { kind, amount: kind === "none" || kind === "unknown" ? null : "SEK 599", day: kind === "none" || kind === "unknown" ? null : "11 Nov 2026", stalled: false, ...patch },
      });
      const advice = "disputes.record.status.can.refundInquiry";
      const keys = (patch: Partial<StatusCopyInput>) => keysOf(composeStatusCopy(base("inquiry", { ...nothing, ...patch })));

      it("never advises a refund without a live read, nor when it is unknown", () => {
        expect(keys({ refundLive: null })).not.toContain(advice);
        expect(keys(live("unknown"))).not.toContain(advice);
      });

      it("advises it only when the live state says none, and passes the disputed amount", () => {
        const out = composeStatusCopy(base("inquiry", { ...nothing, ...live("none") }));
        const line = out.parts.flatMap((p) => p.lines).find((l) => l.key === advice);
        expect(line?.params).toEqual({ amount: "EUR 64.95" });
      });

      it("a refund already pending is stated, never advised, and no evidence is asked for", () => {
        const k = keys(live("pending"));
        expect(k).toContain("disputes.record.status.refund.pending");
        expect(k).not.toContain(advice);
        expect(k).not.toContain("disputes.record.status.can.evidence");
      });

      it("a refund pending beyond 72 h is not described as on its way, and not advised either", () => {
        const k = keys(live("pending", { stalled: true }));
        expect(k).not.toContain("disputes.record.status.refund.pending");
        expect(k).not.toContain(advice);
      });

      it("a failed refund says so; a settled one is stated and the inquiry is not told to refund again", () => {
        expect(keys(live("failed"))).toContain("disputes.record.status.refund.failed");
        const settled = keys(live("settled"));
        expect(settled).toContain("disputes.record.status.refund.settledOpen");
        expect(settled).not.toContain(advice);
        expect(keys(live("mixed"))).toContain("disputes.record.status.refund.settledOpen");
      });

      it("none of it appears on a chargeback", () => {
        for (const kind of ["none", "pending", "failed", "settled"] as const) {
          const out = composeStatusCopy(base("chargeback", { ...nothing, ...live(kind) }));
          const k = keysOf(out);
          expect(k.some((x) => x.includes("status.refund.") || x === advice)).toBe(false);
        }
      });

      it("the return sentence follows the actual return state ('received' only when the store marked it received)", () => {
        const inProgress = keys({ ...live("unknown"), returns: "in_progress" });
        expect(inProgress).toContain("disputes.record.item.return.inProgress");
        expect(inProgress).not.toContain("disputes.record.item.return.returned");
        expect(keys({ ...live("unknown"), returns: "returned" })).toContain("disputes.record.item.return.returned");
      });
    });

    it("is not shown once the response is filed", () => {
      const filed = composeStatusCopy(base("inquiry", { ...returned, stage: "saved", submissionState: "saved_to_shopify", lifecycle: "saved_to_shopify" }));
      expect(keysOf(filed)).not.toContain(refundKey);
    });
  });

  it("a returned parcel WITH a response shows that state, and the returned-parcel fact in What happened", () => {
    const out = composeStatusCopy(
      base("inquiry", { stage: "held", returnedToSender: true, caseFact: { key: "disputes.record.status.fact.returnedToSender" } }),
    );
    expect(out.state).toBe("scheduled");
    const happened = out.parts.find((p) => p.kind === "happened");
    expect(happened?.lines.map((l) => l.key)).toContain("disputes.record.status.fact.returnedToSender");
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
        const toks: I18nToken[] = [out.headline, out.chip, out.subline, ...out.parts.flatMap((p) => [p.label, ...p.lines, ...p.actions.flatMap((a) => (a.meta ? [a.label, a.meta] : [a.label]))])];
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
