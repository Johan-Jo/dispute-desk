/**
 * Counsel v2 inside the package job (buildDefencePackageJob.ts).
 *
 * Item-not-received disputes only. Builds the claim ledger from the pack plus
 * a live read of the customer's other orders, runs the strategist → writer →
 * checks → fact-check → judge loop, and returns the letter as a
 * DefenceNarrativeOutput — or null, in which case the job writes the
 * template letter exactly as before. Nothing here can make a case file less
 * than it did without counsel.
 *
 * Kill switch: DEFENCE_COUNSEL_V2=off.
 */

import { callClaudeMessages } from "../anthropicClient";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import type { DefenceNarrativeOutput, EvidenceFact } from "../types";
import { buildItemNotReceivedLedger } from "./claimLedger";
import { toNarrative } from "./checks";
import { writeCounselLetter, type ModelCall } from "./generate";
import { ITEM_NOT_RECEIVED } from "./playbooks";
import { COUNSEL_PROMPT_VERSION } from "./prompts";
import type { CustomerOrderSummary, LedgerClaim, LedgerInput } from "./types";

export const COUNSEL_PROMPT_FAMILY = "counsel_v2";
export const COUNSEL_DEFAULT_MODEL = "claude-sonnet-4-6";

/** Counsel runs per shop per day (each is ~15–25 uncached model calls). */
export const COUNSEL_DAILY_RUN_CAP = Number(process.env.DEFENCE_COUNSEL_DAILY_RUN_CAP ?? "25");

export function counselEnabled(moduleKey: string): boolean {
  return moduleKey === "inr_product_not_received" && process.env.DEFENCE_COUNSEL_V2 !== "off";
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const CUSTOMER_ORDERS_QUERY = `query CounselCustomerOrders($id: ID!) {
  order(id: $id) {
    customer {
      orders(first: 25, sortKey: CREATED_AT) {
        edges { node {
          name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { presentmentMoney { amount currencyCode } }
          transactions(first: 3) { kind status paymentDetails { ... on CardPaymentDetails { number wallet } } }
          fulfillments(first: 5) { deliveredAt trackingInfo(first: 1) { company } }
        } }
      }
    }
  }
}`;

interface OrdersResponse {
  order?: {
    customer?: {
      orders?: {
        edges?: Array<{
          node: {
            name: string;
            createdAt: string;
            cancelledAt: string | null;
            displayFinancialStatus: string | null;
            displayFulfillmentStatus: string | null;
            totalPriceSet?: { presentmentMoney?: { amount: string; currencyCode: string } } | null;
            transactions?: Array<{ kind: string; status: string; paymentDetails?: { number?: string | null; wallet?: string | null } | null }>;
            fulfillments?: Array<{ deliveredAt: string | null; trackingInfo?: Array<{ company: string | null }> }>;
          };
        }>;
      };
    } | null;
  } | null;
}

/** The customer's orders on this store (Admin API). Empty on any failure:
 *  the ledger then simply has no later-order claim. */
export async function fetchCustomerOrders(shopId: string, orderGid: string): Promise<CustomerOrderSummary[]> {
  try {
    const res = await makeAuthedRequest<OrdersResponse>({
      shopId,
      query: CUSTOMER_ORDERS_QUERY,
      variables: { id: orderGid },
      timeoutMs: 15_000,
      maxRetries: 1,
    });
    return (res.data?.order?.customer?.orders?.edges ?? []).map(({ node: n }) => {
      const pay = (n.transactions ?? []).find(
        (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION" || t.kind === "CAPTURE") && t.status === "SUCCESS",
      )?.paymentDetails;
      const f = (n.fulfillments ?? []).find((x) => x.deliveredAt) ?? null;
      const money = n.totalPriceSet?.presentmentMoney;
      return {
        name: n.name,
        createdAt: n.createdAt,
        financialStatus: n.displayFinancialStatus,
        fulfillmentStatus: n.displayFulfillmentStatus,
        cancelled: !!n.cancelledAt,
        deliveredAt: f?.deliveredAt ?? null,
        carrier: f?.trackingInfo?.[0]?.company ?? null,
        cardLast4: pay?.number?.match(/(\d{4})\s*$/)?.[1] ?? null,
        wallet: pay?.wallet ?? null,
        total: money ? `${money.currencyCode} ${Number(money.amount).toFixed(2)}` : null,
      };
    });
  } catch (err) {
    console.warn("[counsel] customer orders read failed", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export interface CounselRunResult {
  narrative: DefenceNarrativeOutput;
  ledger: LedgerClaim[];
  modelUsed: string;
  promptVersion: number;
  promptFamily: string;
  tokens: { prompt: number; completion: number; cached: number };
  durationMs: number;
}

export async function runCounsel(args: {
  shopId: string;
  moduleKey: string;
  facts: readonly EvidenceFact[];
  packSections: LedgerInput["packSections"];
  orderName: string | null;
  orderGid: string | null;
  disputeGid: string | null;
  disputeOpenedAt: string | null;
  disputeAmount: number | null;
  disputeCurrency: string | null;
  amountDisplay: string | null;
  cardLast4: string | null;
  merchantName: string;
  log?: (m: string) => void;
  /** Called once after the model calls, letter or not, so every run's spend
   *  is recorded against the counsel cap. */
  onSpend?: (spend: { model: string; tokens: CounselRunResult["tokens"]; durationMs: number; ok: boolean }) => Promise<void>;
}): Promise<CounselRunResult | null> {
  if (!counselEnabled(args.moduleKey)) return null;
  const started = Date.now();

  const customerOrders = args.orderGid ? await fetchCustomerOrders(args.shopId, args.orderGid) : [];
  const ledger = buildItemNotReceivedLedger({
    moduleKey: args.moduleKey,
    facts: args.facts,
    packSections: args.packSections,
    orderName: args.orderName,
    disputeOpenedAt: args.disputeOpenedAt,
    disputeAmount: args.disputeAmount,
    disputeCurrency: args.disputeCurrency,
    customerOrders,
  });
  if (!ledger) {
    console.info(`[counsel] no ledger for ${args.orderName ?? "?"} (not a single carrier-confirmed delivery); template writer`);
    return null;
  }

  const delivery = args.facts.find(
    (f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && str(obj(f.value)?.trackingNumber),
  );
  const dv = obj(delivery?.value) ?? {};
  const carrierName = str(dv.carrier);
  const trackingNumber = str(dv.trackingNumber);
  const trackingUrl = str(dv.trackingUrl);
  const disputeNumber = args.disputeGid?.split("/").pop() ?? null;
  const amountDigits = args.amountDisplay?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;

  const hasAddresses = ledger.some((c) => c.addressExhibit);
  const hasLater = ledger.some((c) => c.laterOrderExhibit);
  const pageContext = [
    `Header: ${[disputeNumber && `Dispute ${disputeNumber}`, args.orderName && `Order ${args.orderName}`, args.amountDisplay].filter(Boolean).join(" · ")} · submitted on behalf of ${args.merchantName}.`,
    `Case details table: merchant, card network${args.cardLast4 ? `, card ending ${args.cardLast4}` : ""}, transaction date, order number, disputed amount.`,
    `Shipment card: carrier, tracking number, shipped and delivered dates. Tracking link printed below the shipping section.`,
    hasAddresses ? "Order addresses card under the shipment card: shipping and billing address side by side, stated identical." : null,
    `Line-items table: products, adjustments, total.${hasLater ? " Under it, a card for the same customer's later order (order number, date, amount, card ending, wallet)." : ""}`,
    "Timeline: the order's events (order, payment, shipping, delivery, notifications) and the chargeback, with dates.",
    'Request line after the conclusion: "The merchant respectfully requests reversal of the chargeback."',
  ]
    .filter(Boolean)
    .join("\n");

  const model = process.env.DEFENCE_COUNSEL_MODEL ?? COUNSEL_DEFAULT_MODEL;
  const tokens = { prompt: 0, completion: 0, cached: 0 };
  const call: ModelCall = async ({ system, user, temperature, maxTokens }) => {
    const r = await callClaudeMessages({
      model,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
      temperature,
      maxTokens,
    });
    tokens.prompt += r.promptTokens;
    tokens.completion += r.completionTokens;
    tokens.cached += r.cachedTokens;
    if (!r.raw) throw new Error(r.error ?? "empty model reply");
    return r.raw;
  };

  const result = await writeCounselLetter({
    ledger,
    playbook: ITEM_NOT_RECEIVED,
    merchantName: args.merchantName,
    pageContext,
    call,
    // 5, as tested: with 3, a case whose drafts all trip one check falls back.
    candidates: 5,
    log: args.log,
    check: {
      ledger,
      playbook: ITEM_NOT_RECEIVED,
      facts: args.facts,
      disputeOpenedAt: args.disputeOpenedAt,
      merchantName: args.merchantName,
      carrierName,
      pageIdentifiers: [args.orderName, args.orderName?.replace(/^#/, ""), trackingNumber, args.cardLast4, amountDigits, disputeNumber]
        .filter((x): x is string => !!x),
      trackingUrl,
    },
  });
  await args.onSpend?.({ model, tokens, durationMs: Date.now() - started, ok: !!result.best });
  if (!result.best) {
    // Visible in the logs: why the template writer took over.
    console.warn(
      `[counsel] no draft passed for ${args.orderName ?? "?"}: ` +
        result.candidates.map((c, i) => `#${i + 1} ${c.issues.length ? c.issues.join(" | ").slice(0, 400) : `judge: ${JSON.stringify(c.verdict?.unclearSentences ?? [])}`}`).join(" || "),
    );
    return null;
  }

  return {
    narrative: toNarrative(
      result.best.draft,
      args.facts.map((f) => f.id),
      trackingUrl ? `Carrier tracking record: ${trackingUrl}` : null,
      ledger,
    ),
    ledger,
    modelUsed: model,
    promptVersion: COUNSEL_PROMPT_VERSION,
    promptFamily: COUNSEL_PROMPT_FAMILY,
    tokens,
    durationMs: Date.now() - started,
  };
}
