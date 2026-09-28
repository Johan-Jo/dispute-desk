/**
 * The refund-request constraint is derived from STORED messages, whatever
 * their review state, on order-matched tickets only, from the customer only.
 * Non-receipt plan §4.1(c) / §10 test 4.
 */

import { describe, it, expect } from "vitest";
import {
  deriveInternalNarrativeConstraints,
  type StoredMessageForConstraints,
} from "../internalNarrativeConstraints";

// Case A's real message (blume-box #360980): proposed, classified
// "contradiction" — never approved, never refund_history.
const caseA: StoredMessageForConstraints = {
  id: "cf7b6536-356d-4c26-968c-c6d99e6eb254",
  senderType: "customer",
  sentAt: "2026-09-05T16:15:25Z",
  messageText:
    "Hello I am reaching out because I have not received my order. It has not shipped either. I want to know when my order will arrive and I would like to be reimbursed for having to wait over 2 weeks.",
  evidenceCategory: "contradiction",
  ticketMatchStatus: "confirmed_match",
  ticketConfidence: "high",
};

describe("deriveInternalNarrativeConstraints", () => {
  it("Case A: an unapproved, mis-classified customer request still constrains", () => {
    const c = deriveInternalNarrativeConstraints([caseA]);
    expect(c.refundOrCompensationRequested).toEqual({
      messageIds: [caseA.id],
      firstSentAt: "2026-09-05T16:15:25Z",
    });
  });

  it("a rejected ticket does not constrain", () => {
    expect(
      deriveInternalNarrativeConstraints([{ ...caseA, ticketMatchStatus: "rejected_match" }])
        .refundOrCompensationRequested,
    ).toBeNull();
  });

  it("a proposed ticket below high confidence does not constrain; at high it does", () => {
    expect(
      deriveInternalNarrativeConstraints([
        { ...caseA, ticketMatchStatus: "proposed_match", ticketConfidence: "medium" },
      ]).refundOrCompensationRequested,
    ).toBeNull();
    expect(
      deriveInternalNarrativeConstraints([
        { ...caseA, ticketMatchStatus: "proposed_match", ticketConfidence: "high" },
      ]).refundOrCompensationRequested,
    ).not.toBeNull();
  });

  it("the same words from the merchant do not constrain", () => {
    expect(
      deriveInternalNarrativeConstraints([{ ...caseA, senderType: "merchant" }])
        .refundOrCompensationRequested,
    ).toBeNull();
  });

  it("a customer message with no money-back request does not constrain", () => {
    expect(
      deriveInternalNarrativeConstraints([
        { ...caseA, messageText: "Where is my order? It has not arrived.", evidenceCategory: null },
      ]).refundOrCompensationRequested,
    ).toBeNull();
  });

  it.each([
    ["sv", "Jag vill ha pengarna tillbaka."],
    ["de", "Ich möchte eine Rückerstattung."],
    ["es", "Quiero un reembolso."],
    ["fr", "Je demande un remboursement."],
    ["pt", "Quero o reembolso."],
  ])("recognises a request in %s", (_l, text) => {
    expect(
      deriveInternalNarrativeConstraints([{ ...caseA, messageText: text, evidenceCategory: null }])
        .refundOrCompensationRequested,
    ).not.toBeNull();
  });

  it("an analyzer refund_history category is enough on its own", () => {
    expect(
      deriveInternalNarrativeConstraints([
        { ...caseA, messageText: "…", evidenceCategory: "refund_history" },
      ]).refundOrCompensationRequested,
    ).not.toBeNull();
  });

  it("carries ids and a date — never message text", () => {
    const c = deriveInternalNarrativeConstraints([caseA]);
    expect(JSON.stringify(c)).not.toContain("reimbursed");
  });
});
