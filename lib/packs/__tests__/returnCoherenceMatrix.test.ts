/**
 * PR 1 cross-surface matrix (plan §5): for each REAL stored pack, every
 * merchant surface this PR touches is rendered from the same pack and the
 * resulting sentences are scanned for contradictions. Real prod packs
 * (2026-11-06, sanitised): #24612, #24510 (RETURNED, zero refund entry),
 * #24599 (IN_PROGRESS, no refund section), #24215 (NO_RETURN, zero entry),
 * #99445 (built before the return status was recorded).
 */
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import type { I18nToken } from "@/lib/i18n/token";
import { buildRefundPresentation } from "@/lib/argument/refundPresentation";
import { refundStatementFromPackSections, refundStatementTokens } from "@/lib/disputes/refundStatement";
import { unavailableReasonToken } from "@/lib/disputes/unavailableReasonToken";
import { orderSituationFromPackSections } from "@/lib/disputes/orderSituation";
import { inapplicableFields, type OrderContext } from "@/lib/automation/completeness";
import { assembleEffectiveChecklist, normaliseSections, orderFactsFromSections } from "../effectiveChecklist";
import { noReturnApplicability } from "../noReturnApplicability";
import cases from "./__fixtures__/returnCoherenceCases.json";

function say(token: I18nToken | null | undefined): string {
  if (!token) return "";
  const raw = token.key.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], en);
  if (typeof raw !== "string") throw new Error(`missing en key ${token.key}`);
  return raw.replace(/\{(\w+)\}/g, (_m, k) => String((token.params as Record<string, unknown> | undefined)?.[k] ?? `{${k}}`));
}

function surfaces(name: keyof typeof cases) {
  const c = cases[name];
  const stmt = refundStatementFromPackSections(c.sections, "2026-11-05T10:00:00Z");
  const effective = assembleEffectiveChecklist({ storedChecklist: c.checklist_v2, packSections: c.sections });
  const sections = normaliseSections(c.sections);
  const ctx = { noReturnFact: noReturnApplicability(orderFactsFromSections(sections), sections) } as OrderContext;
  const refundSec = c.sections.find((s) => s.labelToken.key === "packs.section.refundHistory");
  const situation = orderSituationFromPackSections(c.sections as never);
  const texts: string[] = [];
  const t = stmt ? refundStatementTokens(stmt) : null;
  if (t) texts.push(say(t.title), say(t.detail));
  // The unavailable-reason line a stored "no refund" row would render.
  texts.push(say(unavailableReasonToken("No refund was issued on this order", stmt)));
  // The refund evidence row's presentation (a zero entry must not say "No refund issued").
  const pres = refundSec ? buildRefundPresentation(refundSec.data as never, stmt) : null;
  if (pres) texts.push(say(pres.titleToken), ...pres.factsTokens.map(say));
  return { stmt, effective, inapplicable: [...inapplicableFields(ctx)], texts, situation };
}

const returnRows = (r: ReturnType<typeof surfaces>) => r.effective.checklist.filter((x) => x.field === "no_return_initiated");

describe("RETURNED order with a zero-amount refund entry (#24612, #24510)", () => {
  it.each(["24612", "24510"] as const)("#%s: one coherent account on every surface", (k) => {
    const r = surfaces(k);
    expect(r.stmt?.kind).toBe("recorded_no_amount");
    expect(returnRows(r)).toEqual([]); // checklist (workspace, pack page API)
    expect(r.inapplicable).toContain("no_return_initiated"); // decided view
    const all = r.texts.join(" | ");
    expect(all).not.toMatch(/no refund (has been )?(issued|was issued)/i); // the contradictory line
    expect(all).not.toMatch(/no return initiated/i); // beside a recorded return
    expect(all).not.toMatch(/pending|started|failed|successful/i); // recorded_no_amount stays neutral
    expect(all).toMatch(/no confirmed amount/i);
  });
});

describe("IN_PROGRESS return, no refund section (#24599)", () => {
  it("the row is gone, the refund statement is `none`, and no surface claims a return was never started", () => {
    const r = surfaces("24599");
    expect(r.stmt?.kind).toBe("none");
    expect(returnRows(r)).toEqual([]);
    expect(r.texts.join(" | ")).not.toMatch(/no return initiated/i);
  });
});

describe("NO_RETURN with a zero-amount entry (#24215): the row and its facts stay", () => {
  it("keeps the no-return row and still never says 'No refund issued' for the zero entry", () => {
    const r = surfaces("24215");
    expect(returnRows(r)).toHaveLength(1);
    expect(r.inapplicable).toEqual([]);
    expect(r.texts.join(" | ")).not.toMatch(/no refund (has been )?(issued|was issued)/i);
  });
});

describe("pack built before the return status was recorded (#99445): unknown is not a return", () => {
  it("keeps the row, drops nothing, and reads the refund entries neutrally", () => {
    const r = surfaces("99445");
    expect(returnRows(r)).toHaveLength(1);
    expect(r.effective.droppedForRecord).toEqual([]);
    expect(r.inapplicable).toEqual([]);
    expect(r.stmt?.kind).toBe("recorded_no_amount"); // two zero entries
  });
});

describe("pre-stamp pack with a MISSING no-return row and nothing refunded (6 prod packs)", () => {
  it("UNKNOWN status keeps the missing row: nothing is inferred from an absent status", () => {
    const c = structuredClone(cases["99445"]) as unknown as { checklist_v2: Array<Record<string, unknown>>; sections: Array<{ labelToken: { key: string }; fieldsProvided: string[] }> };
    c.checklist_v2 = c.checklist_v2.map((r) => (r.field === "no_return_initiated" ? { ...r, status: "missing" } : r));
    c.sections = c.sections
      .filter((s) => s.labelToken.key !== "packs.section.refundHistory")
      .map((s) => ({ ...s, fieldsProvided: s.fieldsProvided.filter((f) => f !== "no_return_initiated") }));
    const out = assembleEffectiveChecklist({ storedChecklist: c.checklist_v2, packSections: c.sections });
    expect(out.checklist.find((r) => r.field === "no_return_initiated")?.status).toBe("missing");
    expect(out.droppedForRecord).toEqual([]);
  });
});

describe("what is NOT changed (bank-facing and stored)", () => {
  it.each(["24612", "24510", "24599", "24215", "99445"] as const)("#%s: inputs are not mutated and the stored score is only an input", (k) => {
    const before = JSON.stringify(cases[k]);
    surfaces(k);
    expect(JSON.stringify(cases[k])).toBe(before);
  });
});
