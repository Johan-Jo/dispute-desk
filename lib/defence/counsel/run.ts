/**
 * Counsel v2 inside the package job (buildDefencePackageJob.ts).
 *
 * Item-not-received disputes only. Builds the claim ledger from the pack plus
 * a live read of the customer's other orders, writes the letter (generate.ts:
 * code-written sections, one model-written summary, one review call,
 * at most one correction) and returns it as a DefenceNarrativeOutput — or
 * null, in which case the job writes the template letter exactly as before.
 * Nothing here can make a case file less than it did without counsel.
 *
 * Reuse: the letter's inputs are hashed. When a previous counsel letter for
 * the dispute has the same hash, its summary is reused and no model is called.
 *
 * Kill switch: DEFENCE_COUNSEL_V2=off. Cost plan: docs/plans/counsel-v2-cost-refactor.plan.md.
 */

import { createHash } from "node:crypto";
import { callClaudeMessages } from "../anthropicClient";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import type { DefenceNarrativeOutput, EvidenceFact } from "../types";
import { buildItemNotReceivedLedger } from "./claimLedger";
import { checkDraft, toNarrative, type CheckContext } from "./checks";
import { composeDraft, writeCounselLetter, type CounselStage, type ModelCall } from "./generate";
import { ITEM_NOT_RECEIVED } from "./playbooks";
import { COUNSEL_PROMPT_VERSION } from "./prompts";
import { buildRecordSections } from "./recordSections";
import type { CounselDraft, CustomerOrderSummary, LedgerClaim, LedgerInput } from "./types";

export const COUNSEL_PROMPT_FAMILY = "counsel_v2";
export const COUNSEL_DEFAULT_MODEL = "claude-sonnet-4-6";
/** The review call (fact-check + clarity). Not Haiku: in the offline eval
 *  (2026-09-26) it flagged correct intervals on #352543 as "inverted" in every
 *  run, its own note calling the sentence correct; Sonnet flagged none. One
 *  Sonnet review adds ~$0.005 per package. Override: DEFENCE_COUNSEL_REVIEW_MODEL. */
export const COUNSEL_REVIEW_MODEL = "claude-sonnet-4-6";

/** Counsel runs per shop per day (each is 2–4 model calls since the cost refactor). */
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

/** One model call's usage, for defence_package_runs.stage_tokens. */
export interface CounselStageUsage {
  stage: CounselStage;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CounselRunResult {
  narrative: DefenceNarrativeOutput;
  ledger: LedgerClaim[];
  modelUsed: string;
  promptVersion: number;
  promptFamily: string;
  tokens: { prompt: number; completion: number; cached: number };
  durationMs: number;
  /** True when a previous letter was reused and no model was called. */
  reused: boolean;
}

/**
 * The hash of everything the letter depends on (cost refactor §3.6). Same
 * hash → same letter: the ledger (claims, specifics, limits, exhibits), what
 * the page prints around it, the prompt version (which also versions the
 * code-written sentences) and the models.
 */
export function counselInputHash(args: {
  ledger: readonly LedgerClaim[];
  pageContext: string;
  merchantName: string;
  check: Pick<CheckContext, "carrierName" | "pageIdentifiers" | "trackingUrl">;
  writeModel: string;
  reviewModel: string;
}): string {
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const payload = {
    v: COUNSEL_PROMPT_VERSION,
    writeModel: args.writeModel,
    reviewModel: args.reviewModel,
    merchantName: args.merchantName,
    pageContext: args.pageContext,
    carrierName: args.check.carrierName,
    pageIdentifiers: args.check.pageIdentifiers,
    trackingUrl: args.check.trackingUrl,
    ledger: args.ledger.map((c) => ({
      id: c.id,
      statement: c.statement,
      specifics: sorted(c.specifics),
      mustNot: c.mustNot,
      timelineEvent: c.timelineEvent ?? null,
      addressExhibit: c.addressExhibit ?? null,
      laterOrderExhibit: c.laterOrderExhibit ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
  /** The summary of a previous counsel letter for this dispute with this
   *  input hash, or null. Reuse makes no model call. */
  findReusable?: (inputHash: string) => Promise<string[] | null>;
  /** Called once per run, letter or not, reused or not, so every run's spend
   *  is recorded (and the counsel cap sees the ones that called a model). */
  onSpend?: (spend: {
    model: string;
    tokens: CounselRunResult["tokens"];
    stages: CounselStageUsage[];
    durationMs: number;
    ok: boolean;
    reused: boolean;
  }) => Promise<void>;
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

  const check: CheckContext = {
    ledger,
    playbook: ITEM_NOT_RECEIVED,
    facts: args.facts,
    disputeOpenedAt: args.disputeOpenedAt,
    merchantName: args.merchantName,
    carrierName,
    pageIdentifiers: [args.orderName, args.orderName?.replace(/^#/, ""), trackingNumber, args.cardLast4, amountDigits, disputeNumber]
      .filter((x): x is string => !!x),
    trackingUrl,
  };
  const model = process.env.DEFENCE_COUNSEL_MODEL ?? COUNSEL_DEFAULT_MODEL;
  const reviewModel = process.env.DEFENCE_COUNSEL_REVIEW_MODEL ?? COUNSEL_REVIEW_MODEL;
  const inputHash = counselInputHash({ ledger, pageContext, merchantName: args.merchantName, check, writeModel: model, reviewModel });
  const trackingLine = trackingUrl ? `Carrier tracking record: ${trackingUrl}` : null;
  const factIds = args.facts.map((f) => f.id);
  const finish = (draft: CounselDraft): DefenceNarrativeOutput => ({
    ...toNarrative(draft, factIds, trackingLine, ledger),
    counsel: { inputHash, summary: draft.summary.paragraphs },
  });
  const tokens = { prompt: 0, completion: 0, cached: 0 };
  const stages: CounselStageUsage[] = [];
  const result = (draft: CounselDraft, reused: boolean): CounselRunResult => ({
    narrative: finish(draft),
    ledger,
    modelUsed: model,
    promptVersion: COUNSEL_PROMPT_VERSION,
    promptFamily: COUNSEL_PROMPT_FAMILY,
    tokens,
    durationMs: Date.now() - started,
    reused,
  });

  // Reuse (§3.6): same inputs → the same letter, no model call. The stored
  // summary still has to pass today's code checks against today's ledger.
  const previous = args.findReusable ? await args.findReusable(inputHash).catch(() => null) : null;
  if (previous?.length) {
    const draft = composeDraft({ paragraphs: previous, claimIds: [] }, buildRecordSections(ledger));
    if (checkDraft(draft, check).length === 0) {
      await args.onSpend?.({ model, tokens, stages, durationMs: Date.now() - started, ok: true, reused: true });
      return result(draft, true);
    }
  }

  const call: ModelCall = async ({ stage, system, user, temperature, maxTokens }) => {
    const m = stage === "review" ? reviewModel : model;
    const r = await callClaudeMessages({
      model: m,
      // The summary system prompt is static across cases: cached, so the
      // correction and the next case's write read it at the cache rate. The
      // review prompt is under the minimum cacheable length; not marked.
      system: [stage === "review" ? { type: "text", text: system } : { type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      temperature,
      maxTokens,
    });
    tokens.prompt += r.promptTokens;
    tokens.completion += r.completionTokens;
    tokens.cached += r.cachedTokens;
    stages.push({ stage, model: m, input: r.promptTokens, output: r.completionTokens, cacheRead: r.cachedTokens, cacheWrite: r.cacheWriteTokens ?? 0 });
    if (!r.raw) throw new Error(r.error ?? "empty model reply");
    return r.raw;
  };

  let written: Awaited<ReturnType<typeof writeCounselLetter>>;
  try {
    written = await writeCounselLetter({ ledger, playbook: ITEM_NOT_RECEIVED, merchantName: args.merchantName, pageContext, call, log: args.log, check });
  } catch (err) {
    // A model error is still spend: record it before the job falls back.
    await args.onSpend?.({ model, tokens, stages, durationMs: Date.now() - started, ok: false, reused: false });
    throw err;
  }
  await args.onSpend?.({ model, tokens, stages, durationMs: Date.now() - started, ok: written.ok, reused: false });
  if (!written.ok) {
    // Visible in the logs: why the template writer took over.
    console.warn(
      `[counsel] summary failed for ${args.orderName ?? "?"} after ${written.corrected ? "one correction" : "the first draft"}: ` +
        written.issues.join(" | ").slice(0, 800),
    );
    return null;
  }
  return result(written.draft, false);
}
