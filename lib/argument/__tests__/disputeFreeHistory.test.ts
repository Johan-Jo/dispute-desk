/**
 * "Dispute-free" must be VERIFIED, never assumed.
 *
 * Regression for blume-box dispute 162042cd (2026-07-31). The account
 * `jax hacy` was created 2026-06-29 and placed nine orders in the next
 * four days; two of them were already chargebacks in our own `disputes`
 * table when the pack was built. Because every consumer spelled the
 * check `disputeFreeHistory !== false`, the missing flag resolved to
 * `true` and we produced
 *   { priorOrderCount: 8, disputeFreeHistory: true }
 * marked strong + bankEligible + includeInBankNarrative — i.e. we were
 * about to tell an issuer that account had "an established dispute-free
 * order history".
 *
 * The invariant these tests pin: an ABSENT flag is `unknown`, and
 * `unknown` never renders the word "undisputed" and never scores strong.
 */

import { describe, expect, it } from "vitest";
import {
  categorizeEvidenceField,
  disputeFreeHistoryState,
} from "../canonicalEvidence";
import { deriveEvidenceLineItems } from "../evidenceLineItem";

describe("disputeFreeHistoryState", () => {
  it("absent flag is unknown — NOT dispute-free", () => {
    expect(disputeFreeHistoryState({ totalOrders: 9 })).toBe("unknown");
    expect(disputeFreeHistoryState({})).toBe("unknown");
    expect(disputeFreeHistoryState(null)).toBe("unknown");
    expect(disputeFreeHistoryState(undefined)).toBe("unknown");
  });

  it("only an explicit boolean resolves either way", () => {
    expect(disputeFreeHistoryState({ disputeFreeHistory: true })).toBe("dispute_free");
    expect(disputeFreeHistoryState({ disputeFreeHistory: false })).toBe("has_disputes");
  });

  it("non-boolean truthy values do not count as verification", () => {
    expect(disputeFreeHistoryState({ disputeFreeHistory: "true" })).toBe("unknown");
    expect(disputeFreeHistoryState({ disputeFreeHistory: 1 })).toBe("unknown");
  });
});

describe("customer_account_info strength", () => {
  it("verified dispute-free history with priors is strong", () => {
    expect(
      categorizeEvidenceField("customer_account_info", {
        totalOrders: 9,
        disputeFreeHistory: true,
      }),
    ).toBe("strong");
  });

  it("UNVERIFIED history with priors is moderate, never strong", () => {
    // The exact blume-box payload shape.
    expect(
      categorizeEvidenceField("customer_account_info", {
        totalOrders: 9,
        isRepeatCustomer: true,
      }),
    ).toBe("moderate");
  });

  it("known prior chargebacks stay supporting", () => {
    expect(
      categorizeEvidenceField("customer_account_info", {
        totalOrders: 9,
        disputeFreeHistory: false,
      }),
    ).toBe("supporting");
  });

  it("a first-order account is supporting whatever the flag says", () => {
    expect(
      categorizeEvidenceField("customer_account_info", {
        totalOrders: 1,
        disputeFreeHistory: true,
      }),
    ).toBe("supporting");
  });
});

describe("bank-facing copy never claims an unverified history is clean", () => {
  function accountRow(payload: Record<string, unknown>) {
    const rows = deriveEvidenceLineItems({
      checklist: [
        {
          field: "customer_account_info",
          label: "Customer account history",
          status: "available",
          priority: "recommended",
          blocking: false,
          source: "auto_shopify",
          collectionType: "auto",
        },
      ],
      facts: [],
      payloadByField: new Map<string, unknown>([
        ["customer_account_info", payload],
      ]),
      // The row only becomes bank-facing when case strength counted it
      // as a signal — mirror that so this test exercises the COPY branch
      // rather than the contribution gate.
      contributions: {
        strong: [{ evidenceFieldKey: "customer_account_info" }],
        moderate: [],
      },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    } as never);
    return rows.find((r) => r.field === "customer_account_info") ?? null;
  }

  it("verified clean history keeps the 'undisputed' wording", () => {
    const row = accountRow({ totalOrders: 9, disputeFreeHistory: true });
    expect(row?.includedInBankArgument).toBe(true);
    expect(row?.reasonToken?.key).toMatch(
      /customerAccount\.returning(Bank|Context)Plural/,
    );
  });

  it("UNVERIFIED history states the count without the dispute-free claim", () => {
    const row = accountRow({ totalOrders: 9, isRepeatCustomer: true });
    // Still bank-facing — "8 prior orders" is true and useful. The
    // honesty lives in the copy, which omits "undisputed" entirely.
    expect(row?.includedInBankArgument).toBe(true);
    expect(row?.reasonToken?.key).toMatch(
      /customerAccount\.returningUnverifiedPlural/,
    );
  });

  it("known prior chargebacks never reach the bank argument", () => {
    const row = accountRow({ totalOrders: 9, disputeFreeHistory: false });
    expect(row?.includedInBankArgument).toBe(false);
  });
});
