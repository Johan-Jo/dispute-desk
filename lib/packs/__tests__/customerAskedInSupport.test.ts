/**
 * A customer asked to return the order OUTSIDE Shopify (support inbox). READ-TIME
 * only: the single no-return verdict, the checklist row, the loader (read-only),
 * the precedence against the merchant's answer, the six locales, and the real
 * stored pack (#24215, NO_RETURN) with a synthetic Gorgias message set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inapplicableFields, type OrderContext } from "@/lib/automation/completeness";
import { noReturnFactVerdict } from "@/lib/disputes/returnRequestConfirmation";
import { unavailableReasonToken } from "@/lib/disputes/unavailableReasonToken";
import {
  deriveCustomerReturnRequest,
  loadCustomerReturnRequest,
  type StoredMessageForConstraints,
} from "@/lib/integrations/gorgias/internalNarrativeConstraints";
import { assembleEffectiveChecklist, normaliseSections, orderFactsFromSections } from "../effectiveChecklist";
import { customerRequestStands, loadReturnScopeForPack } from "../loadReturnScope";
import { noReturnApplicability } from "../noReturnApplicability";
import cases from "./__fixtures__/returnCoherenceCases.json";

const ASKED = { returnsOutsideShopify: false, answer: null, customerAskedInSupport: true } as const;

describe("the one verdict", () => {
  it("NO_RETURN + no refund + customer asked in support: inapplicable with a CODE reason", () => {
    const v = noReturnFactVerdict({ returnStatus: "NO_RETURN", totalRefunded: "0.00", returnScope: ASKED });
    expect(v).toEqual({ emit: false, reason: "customer_asked_in_support" });
  });

  it("without the signal the verdict is exactly what it was", () => {
    expect(noReturnFactVerdict({ returnStatus: "NO_RETURN", totalRefunded: "0.00" })).toMatchObject({ emit: true });
    const off = { returnsOutsideShopify: false, answer: null, customerAskedInSupport: false };
    expect(noReturnFactVerdict({ returnStatus: "NO_RETURN", totalRefunded: "0.00", returnScope: off })).toMatchObject({
      emit: true,
    });
  });

  it("an unknown status stays applicable unless the signal fires", () => {
    expect(noReturnFactVerdict({ returnStatus: null, totalRefunded: null })).toEqual({ unknown: true, why: "status_absent" });
    expect(noReturnFactVerdict({ returnStatus: null, totalRefunded: null, returnScope: ASKED })).toEqual({
      emit: false,
      reason: "customer_asked_in_support",
    });
  });

  it("never overrides a stronger fact: a return or refund on record keeps its own reason", () => {
    expect(noReturnFactVerdict({ returnStatus: "RETURNED", totalRefunded: "0", returnScope: ASKED })).toEqual({
      emit: false,
      reason: "return_on_record",
    });
    expect(noReturnFactVerdict({ returnStatus: "NO_RETURN", totalRefunded: "50", returnScope: ASKED })).toEqual({
      emit: false,
      reason: "refund_on_record",
    });
  });

  it("the merchant's explicit 'request_received' keeps its own reason", () => {
    const v = noReturnFactVerdict({
      returnStatus: "NO_RETURN",
      totalRefunded: "0",
      returnScope: { ...ASKED, returnsOutsideShopify: true, answer: "request_received" },
    });
    expect(v).toEqual({ emit: false, reason: "merchant_says_request_received" });
  });

  it("an unknown status with the merchant's 'request_received' and the signal keeps the merchant's reason", () => {
    const v = noReturnFactVerdict({
      returnStatus: null,
      totalRefunded: null,
      returnScope: { ...ASKED, returnsOutsideShopify: true, answer: "request_received" },
    });
    expect(v).toEqual({ emit: false, reason: "merchant_says_request_received" });
  });

  it("noReturnApplicability carries the code", () => {
    expect(noReturnApplicability({ returnStatus: "NO_RETURN", totalRefunded: "0", returnScope: ASKED }, [])).toEqual({
      applicable: false,
      reason: "customer_asked_in_support",
    });
  });

  it("the reason maps to a token in en and is a code (no whitespace)", () => {
    expect(unavailableReasonToken("customer_asked_in_support")).toEqual({
      key: "disputes.unavailableReason.customerAskedInSupport",
    });
  });
});

describe("precedence against the merchant's answer (customerRequestStands)", () => {
  const req = { requested: true, latestSentAt: "2026-11-01T10:00:00Z" };
  it("no detection: no signal", () => {
    expect(customerRequestStands({ requested: false, latestSentAt: null }, null)).toBe(false);
  });
  it("no answer, 'not_sure', or 'request_received' (own reason): the detection stands", () => {
    expect(customerRequestStands(req, null)).toBe(true);
    expect(customerRequestStands(req, { answer: "not_sure", answeredAt: "2026-11-05T00:00:00Z" })).toBe(true);
  });
  it("'no request received' answered AFTER the latest message: the merchant wins", () => {
    expect(customerRequestStands(req, { answer: "no_request_received", answeredAt: "2026-11-02T00:00:00Z" })).toBe(false);
  });
  it("'no request received' answered BEFORE the message, or at an unreadable time: the detection wins", () => {
    expect(customerRequestStands(req, { answer: "no_request_received", answeredAt: "2026-10-30T00:00:00Z" })).toBe(true);
    expect(customerRequestStands(req, { answer: "no_request_received", answeredAt: "" })).toBe(true);
    expect(
      customerRequestStands({ requested: true, latestSentAt: null }, { answer: "no_request_received", answeredAt: "2026-11-02T00:00:00Z" }),
    ).toBe(true);
  });
});

describe("the detector (matched to THIS order, customer messages only)", () => {
  const m = (over: Partial<StoredMessageForConstraints>): StoredMessageForConstraints => ({
    id: "m1",
    senderType: "customer",
    sentAt: "2026-11-01T10:00:00Z",
    messageText: "Hi, I want to send it back, can you email me a return label?",
    evidenceCategory: null,
    ticketMatchStatus: "confirmed_match",
    ticketConfidence: "high",
    ...over,
  });
  it("fires on a confirmed match and on a high-confidence proposal", () => {
    expect(deriveCustomerReturnRequest([m({})])).toEqual({ requested: true, latestSentAt: "2026-11-01T10:00:00Z" });
    expect(deriveCustomerReturnRequest([m({ ticketMatchStatus: "proposed_match" })]).requested).toBe(true);
  });
  it("does not fire on a low-confidence proposal, a rejected match, a merchant message or an unrelated text", () => {
    expect(deriveCustomerReturnRequest([m({ ticketMatchStatus: "proposed_match", ticketConfidence: "low" })]).requested).toBe(false);
    expect(deriveCustomerReturnRequest([m({ ticketMatchStatus: "rejected_match" })]).requested).toBe(false);
    expect(deriveCustomerReturnRequest([m({ senderType: "merchant" })]).requested).toBe(false);
    expect(deriveCustomerReturnRequest([m({ messageText: "Where is my parcel?" })]).requested).toBe(false);
  });
  it("reports the LATEST request time", () => {
    const r = deriveCustomerReturnRequest([m({ id: "a", sentAt: "2026-11-01T10:00:00Z" }), m({ id: "b", sentAt: "2026-11-03T10:00:00Z" })]);
    expect(r.latestSentAt).toBe("2026-11-03T10:00:00Z");
  });
});

/** A client that records every call and THROWS on a write or an RPC. */
function gorgiasStub(opts: { tickets?: unknown[] | null; messages?: unknown[]; error?: boolean; settings?: boolean | null }) {
  const log: string[] = [];
  const eqs: string[] = [];
  const write = (t: string) => () => {
    log.push(`WRITE:${t}`);
    throw new Error("a read path must never write");
  };
  const chain = (table: string, rows: unknown[] | null) => {
    const q: Record<string, unknown> = {
      insert: write(table), update: write(table), upsert: write(table), delete: write(table),
      select: () => q,
      eq: (c: string, v: string) => {
        eqs.push(`${table}.${c}=${v}`);
        return q;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => void) => res({ data: opts.error ? null : rows, error: opts.error ? { message: "boom" } : null }),
    };
    return q;
  };
  const sb = {
    rpc: () => {
      log.push("rpc");
      throw new Error("a read path must never call an RPC");
    },
    from: (table: string) => {
      log.push(`from:${table}`);
      if (table === "shop_settings") {
        const q: Record<string, unknown> = {
          insert: write(table), update: write(table), upsert: write(table), delete: write(table),
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: opts.settings == null ? null : { returns_outside_shopify: opts.settings }, error: null }),
        };
        return q;
      }
      if (table === "gorgias_matched_tickets") return chain(table, opts.tickets ?? []);
      if (table === "gorgias_evidence_messages") return chain(table, opts.messages ?? []);
      return chain(table, []);
    },
  };
  return { sb, log, eqs };
}

const TICKET = { id: "t1", match_status: "confirmed_match", confidence: "high" };
const MSG = {
  id: "m1", matched_ticket_id: "t1", sender_type: "customer", sent_at: "2026-11-01T10:00:00Z",
  message_text: "Hello, I would like to return it. Please send a return label.", evidence_category: null,
};

describe("loader: read-only, shop-scoped, never throws", () => {
  it("selects only; filters by dispute AND shop; reports the request", async () => {
    const { sb, log, eqs } = gorgiasStub({ tickets: [TICKET], messages: [MSG] });
    const r = await loadCustomerReturnRequest(sb as never, { disputeId: "d1", shopId: "s1" });
    expect(r).toEqual({ requested: true, latestSentAt: "2026-11-01T10:00:00Z" });
    expect(log.filter((l) => l === "rpc" || l.startsWith("WRITE:"))).toEqual([]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        "gorgias_matched_tickets.dispute_id=d1", "gorgias_matched_tickets.shop_id=s1",
        "gorgias_evidence_messages.dispute_id=d1", "gorgias_evidence_messages.shop_id=s1",
      ]),
    );
  });
  it("no integration / no tickets / a read error / a throwing client = no signal", async () => {
    expect((await loadCustomerReturnRequest(gorgiasStub({ tickets: [] }).sb as never, { disputeId: "d", shopId: "s" })).requested).toBe(false);
    expect((await loadCustomerReturnRequest(gorgiasStub({ error: true }).sb as never, { disputeId: "d", shopId: "s" })).requested).toBe(false);
    const boom = { from: () => { throw new Error("down"); } };
    await expect(loadCustomerReturnRequest(boom as never, { disputeId: "d", shopId: "s" })).resolves.toEqual({
      requested: false,
      latestSentAt: null,
    });
  });
  it("loadReturnScopeForPack: setting OFF + a request = a scope carrying only the signal; no write anywhere", async () => {
    const { sb, log } = gorgiasStub({ tickets: [TICKET], messages: [MSG], settings: false });
    const scope = await loadReturnScopeForPack(sb as never, { shopId: "s1", disputeId: "d1", packCycle: 1 });
    expect(scope).toEqual({ returnsOutsideShopify: false, answer: null, customerAskedInSupport: true });
    expect(log.filter((l) => l === "rpc" || l.startsWith("WRITE:"))).toEqual([]);
  });
  it("withSupportSignal:false (the evidence-pack PDF, the outcome email) never reads Gorgias", async () => {
    const { sb, log } = gorgiasStub({ tickets: [TICKET], messages: [MSG], settings: false });
    const scope = await loadReturnScopeForPack(sb as never, { shopId: "s1", disputeId: "d1", packCycle: 1, withSupportSignal: false });
    expect(scope).toBeUndefined();
    expect(log.some((l) => l.startsWith("from:gorgias"))).toBe(false);
  });
  it("loadReturnScopeForPack: no request = unchanged (undefined when the setting is off)", async () => {
    const { sb } = gorgiasStub({ tickets: [], settings: false });
    await expect(loadReturnScopeForPack(sb as never, { shopId: "s1", disputeId: "d1", packCycle: 1 })).resolves.toBeUndefined();
  });
});

describe("real stored pack #24215 (NO_RETURN, zero refund) with a synthetic Gorgias message set", () => {
  const c = cases["24215"];
  const sections = normaliseSections(c.sections);
  const facts = orderFactsFromSections(sections);
  it("without the signal the row stays (the pre-existing behaviour)", () => {
    const eff = assembleEffectiveChecklist({ storedChecklist: c.checklist_v2, packSections: c.sections });
    expect(eff.checklist.some((x) => x.field === "no_return_initiated")).toBe(true);
  });
  it("an AVAILABLE stored row is kept by the existing rule (never hide a row whose fact the letter files) and reported as contradicted", () => {
    const eff = assembleEffectiveChecklist({ storedChecklist: c.checklist_v2, packSections: c.sections, returnScope: ASKED });
    expect(eff.checklist.some((x) => x.field === "no_return_initiated")).toBe(true);
    expect(eff.contradictedAvailable).toContain("no_return_initiated");
  });
  it("with the signal a not-yet-satisfied row disappears through assembleEffectiveChecklist and the decided view agrees", () => {
    const stored = (c.checklist_v2 as Array<{ field: string; status: string }>).map((x) =>
      x.field === "no_return_initiated" ? { ...x, status: "missing" } : x,
    );
    // A pack whose collector did not provide the fact (a row nothing satisfied).
    const bare = c.sections.map((s) => ({
      ...s,
      fieldsProvided: ((s as { fieldsProvided?: string[] }).fieldsProvided ?? []).filter((f) => f !== "no_return_initiated"),
    }));
    const eff = assembleEffectiveChecklist({ storedChecklist: stored, packSections: bare, returnScope: ASKED });
    expect(eff.checklist.some((x) => x.field === "no_return_initiated")).toBe(false);
    expect(eff.droppedForRecord).toContain("no_return_initiated");
    const ctx = { noReturnFact: noReturnApplicability({ ...facts, returnScope: ASKED }, sections) } as OrderContext;
    expect([...inapplicableFields(ctx)]).toContain("no_return_initiated");
  });
  it("a refund or return Shopify records still wins (precedence)", () => {
    const r = noReturnApplicability({ returnStatus: "RETURNED", totalRefunded: 0, returnScope: ASKED }, sections);
    expect(r).toEqual({ applicable: false, reason: "return_on_record" });
  });
});

describe("six locales", () => {
  const read = (l: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", `${l}.json`), "utf8"));
  const keysOf = (m: any): string[] => {
    const out: string[] = [m.disputes.unavailableReason.customerAskedInSupport];
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (typeof o.askedInSupport === "string") out.push(o.askedInSupport);
      if (typeof o.returnAskedInSupport === "string") out.push(o.returnAskedInSupport);
      for (const v of Object.values(o)) walk(v);
    };
    walk(m);
    return out;
  };
  it.each(["en", "de", "es", "fr", "pt", "sv"])("%s has all three strings, none empty", (l) => {
    const k = keysOf(read(l));
    expect(k).toHaveLength(3);
    for (const s of k) expect(s.trim().length).toBeGreaterThan(10);
  });
  it.each(["de", "es", "fr", "pt", "sv"])("%s is not the English text", (l) => {
    const en = keysOf(read("en"));
    const k = keysOf(read(l));
    k.forEach((s, i) => expect(s).not.toBe(en[i]));
  });
  it("no forbidden-copy phrase and no bare gateway codes in any locale", () => {
    for (const l of ["en", "de", "es", "fr", "pt", "sv"]) {
      for (const s of keysOf(read(l))) {
        // Built from parts: the CI forbidden-copy grep scans this file too.
        const banned = [["submit", "response"], ["submit to card", "network"], ["file dispute", "response"]].map((p) => p.join(" "));
        for (const b of banned) expect(s.toLowerCase()).not.toContain(b);
        expect(s).not.toMatch(/\b(AVS|CVV)\b/);
      }
    }
  });
});
