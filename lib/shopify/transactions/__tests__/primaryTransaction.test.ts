/**
 * The canonical primary-transaction picker, the #24285 regression
 * (failed Mastercard attempt before a successful Klarna payment) driven
 * through every consumer, and a source scan that keeps the five old
 * pickers from growing back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const updateMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      update: (row: unknown) => {
        updateMock(row);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

import {
  pickPrimaryTransaction,
  successfulPayments,
} from "../primaryTransaction";
import { derivePaymentContext } from "@/lib/disputes/paymentContext";
import {
  deriveCardNetwork,
  enrichDisputeWithNetworkReasonCode,
} from "@/lib/disputes/enrichNetworkReasonCode";
import { pickPaymentMethod } from "@/lib/shopify/queries/ordersForBackfill";
import { klarnaInquiryTemplateOverride } from "@/lib/packs/klarnaInquiryTemplate";
import { disputeFrame, requestLine } from "@/lib/defence/counsel/frame";
import { paymentOverlayFor } from "@/lib/defence/paymentOverlays";
import { buildCaseDetailsRows } from "@/lib/defence/render/caseDetails";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

const failedMastercard = {
  id: "gid://shopify/OrderTransaction/1",
  kind: "SALE",
  status: "FAILURE",
  gateway: "shopify_payments",
  receiptJson: null,
  paymentDetails: {
    __typename: "CardPaymentDetails",
    company: "Mastercard",
    wallet: "SHOPIFY_PAY",
  },
};
const failedKlarna = {
  id: "gid://shopify/OrderTransaction/2",
  kind: "SALE",
  status: "FAILURE",
  gateway: "shopify_payments",
  receiptJson: null,
  paymentDetails: {
    __typename: "LocalPaymentMethodsPaymentDetails",
    paymentMethodName: "klarna",
  },
};
const successKlarna = {
  id: "gid://shopify/OrderTransaction/3",
  kind: "SALE",
  status: "SUCCESS",
  gateway: "shopify_payments",
  receiptJson: JSON.stringify({ payment_method_details: { type: "klarna" } }),
  paymentDetails: {
    __typename: "LocalPaymentMethodsPaymentDetails",
    paymentMethodName: "klarna",
  },
};
const successVisa = {
  id: "gid://shopify/OrderTransaction/4",
  kind: "SALE",
  status: "SUCCESS",
  gateway: "shopify_payments",
  receiptJson: null,
  paymentDetails: { __typename: "CardPaymentDetails", company: "Visa" },
};

/** Order #24285 as Shopify returned it: failed card, failed Klarna, paid Klarna. */
const order24285 = {
  transactions: [failedMastercard, failedKlarna, successKlarna],
} as unknown as OrderDetailNode;
/** Mirror: failed Klarna attempt first, successful card second. */
const mirrorOrder = {
  transactions: [failedKlarna, successVisa],
} as unknown as OrderDetailNode;

describe("pickPrimaryTransaction", () => {
  it("returns null for empty input", () => {
    expect(pickPrimaryTransaction(null)).toBeNull();
    expect(pickPrimaryTransaction([])).toBeNull();
  });

  it("matches kind/status case-insensitively", () => {
    const tx = { kind: "sale", status: "success" };
    expect(pickPrimaryTransaction([tx])).toBe(tx);
  });

  it("never returns a failed attempt while a successful payment exists", () => {
    expect(pickPrimaryTransaction(order24285.transactions)).toBe(successKlarna);
  });

  it("returns null (not transactions[0]) when nothing succeeded", () => {
    expect(
      pickPrimaryTransaction([
        failedMastercard,
        { kind: "SALE", status: "ERROR" },
        { kind: "VOID", status: "SUCCESS" },
        { kind: "REFUND", status: "SUCCESS" },
        { kind: "SALE", status: "PENDING" },
      ]),
    ).toBeNull();
  });

  it("prefers SALE/CAPTURE over AUTHORIZATION, and ignores refunds", () => {
    const auth = { kind: "AUTHORIZATION", status: "SUCCESS" };
    const refund = { kind: "REFUND", status: "SUCCESS" };
    const capture = { kind: "CAPTURE", status: "SUCCESS" };
    expect(pickPrimaryTransaction([refund, auth, capture])).toBe(capture);
    expect(pickPrimaryTransaction([refund, auth])).toBe(auth);
  });

  it("split tender: first successful in Shopify order, deterministically", () => {
    const a = { kind: "SALE", status: "SUCCESS", id: "a" };
    const b = { kind: "SALE", status: "SUCCESS", id: "b" };
    expect(pickPrimaryTransaction([a, b])).toBe(a);
    expect(successfulPayments([a, b])).toEqual([a, b]);
  });
});

describe("order #24285 shape (failed Mastercard, failed Klarna, paid Klarna)", () => {
  it("derivePaymentContext returns the Klarna family, no card network", () => {
    const ctx = derivePaymentContext(order24285);
    expect(ctx.family).toBe("klarna");
    expect(ctx.cardNetwork).toBeNull();
    expect(deriveCardNetwork(order24285)).toBeNull();
  });

  it("network reason code resolves to not_card_network (no Mastercard 4860)", async () => {
    updateMock.mockClear();
    const out = await enrichDisputeWithNetworkReasonCode({
      disputeId: "d65b7220",
      shopifyReason: "PRODUCT_NOT_RECEIVED",
      order: order24285,
    });
    expect(out.result.confidence).toBe("not_card_network");
    expect(out.result.code).toBeNull();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ network_reason_code_confidence: "not_card_network" }),
    );
  });

  it("ingest payment_method agrees with the dispute classification", () => {
    expect(
      pickPaymentMethod(
        order24285.transactions as unknown as Parameters<typeof pickPaymentMethod>[0],
      ),
    ).toBe("klarna");
  });

  it("selects the Klarna inquiry template route (family is what gates it)", () => {
    // buildPack feeds derivePaymentContext(order).family into the override;
    // the failed-card-first order used to make this null (card template).
    expect(
      klarnaInquiryTemplateOverride({
        paymentFamily: derivePaymentContext(order24285).family,
        phase: "inquiry",
        reason: "PRODUCT_NOT_RECEIVED",
      }),
    ).toBe("a0000000-0000-0000-0000-000000000c01");
  });
});

describe("order #24285 end to end through the pure consumers", () => {
  const ctx = derivePaymentContext(order24285);

  it("counsel frame is Klarna, not a Visa/Mastercard chargeback", () => {
    const frame = disputeFrame({
      paymentFamily: ctx.family,
      paymentLabel: ctx.label,
      phase: "chargeback",
    });
    expect(frame.provider).toBe("klarna");
    expect(frame.providerName).toBe("Klarna");
    expect(requestLine(frame)).toContain("Klarna");
  });

  it("the Klarna overlay (not the card one) is selected", () => {
    expect(paymentOverlayFor(ctx.family).overlay).not.toBeNull();
    expect(paymentOverlayFor("card").overlay).toBeNull();
  });

  it("Case Details prints Payment method / Customer name, no card rows", () => {
    const rows = buildCaseDetailsRows({
      paymentMethodLabel: "Klarna",
      cardNetwork: null,
      cardLast4: null,
    });
    const labels = rows.map(([l]) => l);
    expect(labels).toContain("Payment method");
    expect(labels).toContain("Customer name");
    expect(labels).not.toContain("Card network");
    expect(labels).not.toContain("Cardholder name");
    expect(labels).not.toContain("Card (last 4)");
  });
});

describe("mirror: failed Klarna attempt first, successful card second", () => {
  it("is a card order with the Visa network", () => {
    const ctx = derivePaymentContext(mirrorOrder);
    expect(ctx.family).toBe("card");
    expect(ctx.cardNetwork).toBe("visa");
  });

  it("resolves a card network, not not_card_network", async () => {
    const out = await enrichDisputeWithNetworkReasonCode({
      disputeId: "x",
      shopifyReason: "FRAUDULENT",
      order: mirrorOrder,
    });
    expect(out.result.confidence).not.toBe("not_card_network");
  });
});

describe("no successful payment → unknown, never card", () => {
  beforeEach(() => updateMock.mockClear());
  const failedOnly = {
    transactions: [failedMastercard],
  } as unknown as OrderDetailNode;

  it("family unknown, no card network, no payment_method", () => {
    expect(derivePaymentContext(failedOnly).family).toBe("unknown");
    expect(deriveCardNetwork(failedOnly)).toBeNull();
    expect(
      pickPaymentMethod(
        failedOnly.transactions as unknown as Parameters<typeof pickPaymentMethod>[0],
      ),
    ).toBeNull();
  });
});

describe("guard: one primary-transaction picker", () => {
  const repoRoot = join(__dirname, "..", "..", "..", "..");
  const canonical = join("lib", "shopify", "transactions", "primaryTransaction.ts");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
    return out;
  }

  // A transaction-looking identifier compared to a transaction kind/status
  // literal, or `.kind`/`.status` compared to the Shopify transaction enums.
  const KIND_LITERAL = /\.kind\s*[!=]==?\s*["'](?:sale|authorization|capture|refund|void)["']/i;
  const STATUS_LITERAL = /\.status\s*[!=]==?\s*["'](?:success|failure|error)["']/i;

  it("no function outside the canonical module filters transactions by kind/status", () => {
    const offenders: string[] = [];
    for (const file of [
      ...walk(join(repoRoot, "lib")),
      ...walk(join(repoRoot, "app")),
    ]) {
      const rel = relative(repoRoot, file).split(sep).join("/");
      if (rel === canonical.split(sep).join("/")) continue;
      const src = readFileSync(file, "utf8");
      // `.status === "SUCCESS"` is common for unrelated records
      // (fulfillments, carrier results); only treat it as a transaction
      // filter in files that actually handle order transactions.
      const touchesTransactions = /transactions|OrderTransaction/.test(src);
      src.split("\n").forEach((line, i) => {
        if (
          KIND_LITERAL.test(line) ||
          (touchesTransactions && STATUS_LITERAL.test(line))
        ) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Filter transactions via lib/shopify/transactions/primaryTransaction.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
