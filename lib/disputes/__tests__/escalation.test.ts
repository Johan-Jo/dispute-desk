/**
 * Plan D2/D3/D4: escalation and reopen flags. Each banner sentence appears
 * only when its data establishes it.
 */
import { describe, it, expect } from "vitest";
import { escalationBanner, isEscalatedFromInquiry, showReopenedPill } from "@/lib/disputes/escalation";
import { renderBankClaimNeededEmail } from "@/lib/email/sendBankClaimNeededAlert";

const DUE = "2026-10-05T23:59:59Z";
const ESC = "2026-09-20T10:00:00Z";

describe("escalation flags", () => {
  const escalated = {
    status: "needs_response",
    phase: "chargeback",
    due_at: DUE,
    final_outcome: null,
    closed_at: null,
    response_cycle: 1,
    reopened_at: null,
    reopened_after_close_at: null,
    escalated_from_inquiry_at: ESC,
  };

  it("an escalated chargeback carries the flag; an inquiry never does", () => {
    expect(isEscalatedFromInquiry(escalated)).toBe(true);
    expect(isEscalatedFromInquiry({ ...escalated, escalated_from_inquiry_at: null })).toBe(false);
    expect(isEscalatedFromInquiry({ ...escalated, phase: "inquiry" })).toBe(false);
  });

  it("an escalation that was never answered: escalated + due, no carry-over line", () => {
    expect(escalationBanner(escalated)?.lines.map((l) => l.key)).toEqual(["escalatedOn", "responseDue"]);
  });

  it("an answered inquiry escalated (cycle 2) adds the carry-over line", () => {
    expect(escalationBanner({ ...escalated, response_cycle: 2, reopened_at: ESC })?.lines.map((l) => l.key)).toEqual([
      "escalatedOn",
      "responseDue",
      "inquiryResponseDoesNotCarry",
    ]);
  });

  it("under review: only the escalation sentence, never a due line", () => {
    expect(escalationBanner({ ...escalated, status: "under_review", response_cycle: 2 })?.lines.map((l) => l.key)).toEqual([
      "escalatedOn",
    ]);
  });

  it("decided disputes carry no banner", () => {
    expect(escalationBanner({ ...escalated, final_outcome: "lost" })).toBeNull();
  });

  it("a plain reopen shows the reopen banner only while a response is asked for", () => {
    const reopened = { ...escalated, escalated_from_inquiry_at: null, response_cycle: 2, reopened_at: ESC };
    expect(escalationBanner(reopened)).toEqual({
      kind: "reopened",
      lines: [
        { key: "reopenedOn", date: ESC },
        { key: "responseDue", date: DUE },
      ],
    });
    expect(escalationBanner({ ...reopened, status: "under_review" })).toBeNull();
  });

  it("the escalation's own cycle shows as escalated, not also as reopened", () => {
    expect(showReopenedPill({ ...escalated, response_cycle: 2 })).toBe(false);
    expect(showReopenedPill({ ...escalated, response_cycle: 3 })).toBe(true);
    expect(showReopenedPill({ ...escalated, escalated_from_inquiry_at: null, response_cycle: 2 })).toBe(true);
  });
});

describe("bank-claim email for an escalation (D4)", () => {
  it("names the escalation instead of a reopen", () => {
    const base = {
      locale: "en" as const,
      trigger: "reopened" as const,
      orderName: "#99348",
      amount: "€80.00",
      dueDate: "Oct 5, 2026",
      disputeUrl: "https://x/disputes/1",
      shopifyUrl: null,
    };
    expect(renderBankClaimNeededEmail({ ...base, escalated: true }).text).toContain(
      "has been escalated to a chargeback",
    );
    expect(renderBankClaimNeededEmail(base).text).toContain("Shopify has reopened the dispute");
  });
});
