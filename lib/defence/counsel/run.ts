/**
 * Counsel v2 inside the package job (buildDefencePackageJob.ts).
 *
 * The only letter writer (the template writer is retired, 2026-09-28). One
 * playbook per claim type (playbooks.ts `playbookForModule`): item not
 * received and not as described. Card, PayPal and Klarna disputes alike; the
 * frame (frame.ts) names the proceeding and the request. Builds the claim
 * ledger from the pack plus a live read of the customer's other orders,
 * writes the letter (generate.ts: code-written sections, one model-written
 * summary, one review call, at most one correction) and returns it as a
 * DefenceNarrativeOutput — or null, and the dispute gets no letter.
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
import { buildItemNotReceivedLedger, longDate } from "./claimLedger";
import { buildNotAsDescribedLedger, type NotAsDescribedExtras } from "./notAsDescribedLedger";
import { extractReturnWindow } from "./policyTerms";
import { translateListing } from "../listingTranslation";
import { getServiceClient } from "@/lib/supabase/server";
import { checkDraft, toNarrative, type CheckContext } from "./checks";
import { composeDraft, writeLetter, type CounselStage, type ModelCall } from "./generate";
import { NOT_AS_DESCRIBED, playbookForModule } from "./playbooks";
import { briefForModule, GENERAL_BRIEF, type Brief } from "./briefs";
import { CONSTITUTION_VERSION } from "./constitution";
import { disputeFrame, frameRule, requestLine, type DisputeFrame } from "./frame";
import { classifyChronologyEvent } from "../chronology";
import type { InternalNarrativeConstraints } from "../internalConstraints";
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

/** The single writer covers every dispute type: a type without its own brief
 *  gets the general brief (plan rev 8 §2.8). Kill switch: DEFENCE_COUNSEL_V2=off. */
export function counselEnabled(_moduleKey: string): boolean {
  return process.env.DEFENCE_COUNSEL_V2 !== "off";
}

/** The ledger for a brief, from the one set of claim builders
 *  (plan §2.2). A type whose own claims are missing falls to the general
 *  brief, never to another type's (plan §5). */
export function ledgerForBrief(
  brief: Brief,
  input: LedgerInput,
  constraints: InternalNarrativeConstraints | null,
  extras: Omit<NotAsDescribedExtras, "constraints"> = {},
): { brief: Brief; ledger: LedgerClaim[] } | null {
  const general = (): { brief: Brief; ledger: LedgerClaim[] } | null => {
    const base = buildNotAsDescribedLedger(input, { constraints }) ?? [];
    const neutral = base.filter((c) => GENERAL_BRIEF.claims.includes(c.id));
    const ledger: LedgerClaim[] = [
      {
        id: "claim_stated",
        statement: "The customer disputes the transaction.",
        specifics: {},
        weight: "core",
        sources: ["dispute.reason"],
        mustNot: [],
      },
      ...neutral,
    ];
    return { brief: GENERAL_BRIEF, ledger };
  };
  /* Parcel claims (`parcel_1`, `parcel_2`, …) carry their own `parcel` block
   * and are always kept — `pickBriefTheory` appends them to the theory. Before
   * 2026-09-29 this filter dropped them, and `carrier_delivered` was the only
   * minimum, so EVERY multi-parcel item-not-received ledger (blume-box
   * #360980) fell through to the general brief: "The customer disputes the
   * transaction." */
  const within = (l: LedgerClaim[] | null, b: Brief) => {
    if (!l) return null;
    const kept = l.filter((c) => b.claims.includes(c.id) || !!c.parcel);
    const ids = new Set(kept.map((c) => c.id));
    const minimum = b.minimumClaims.every((id) => ids.has(id));
    const anyOf = !b.minimumAnyOf || b.minimumAnyOf.some((id) => ids.has(id));
    return minimum && anyOf ? { brief: b, ledger: kept } : null;
  };
  if (brief.type === "item_not_received") return within(buildItemNotReceivedLedger(input), brief) ?? general();
  if (brief.type === "product_not_as_described") return within(buildNotAsDescribedLedger(input, { constraints, ...extras }), brief) ?? general();
  return general();
}

/**
 * The dispute's opening as a timeline row, when Shopify's own events carry
 * none (every inquiry, every PayPal dispute: #101111 had no row for it). Added
 * to the ledger claim that dates the dispute, so it prints once.
 */
/**
 * The order's placement as a timeline row, when Shopify's events carry none
 * (#98483 started at the payment row). From the order record's own date.
 */
export function addOrderPlacedRow(ledger: LedgerClaim[], sections: LedgerInput["packSections"]): void {
  const order = sections.find((s) => s?.type === "order" && (s.data as Record<string, unknown> | null)?.orderName)?.data as
    | Record<string, unknown>
    | undefined;
  const createdAt = typeof order?.createdAt === "string" ? order.createdAt : null;
  if (!createdAt || !longDate(createdAt)) return;
  const timeline = ((sections.find((s) => s?.type === "access_log")?.data as { timelineEvents?: unknown[] } | undefined)?.timelineEvents ?? [])
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
    .filter((e): e is Record<string, unknown> => !!e && typeof e.message === "string");
  if (timeline.some((e) => classifyChronologyEvent(e.message as string) === "order_placed")) return;
  ledger.push({
    id: "order_placed",
    statement: `The order was placed on ${longDate(createdAt)}.`,
    specifics: { orderPlacedOn: longDate(createdAt)! },
    weight: "supporting",
    sources: ["pack.order.createdAt"],
    mustNot: [],
    timelineEvent: { at: createdAt, text: "The customer placed the order on the online store." },
  });
}

export function addDisputeOpenedRow(
  ledger: LedgerClaim[],
  sections: LedgerInput["packSections"],
  openedAt: string | null,
  frame: DisputeFrame,
): void {
  if (!openedAt || !longDate(openedAt)) return;
  const timeline = ((sections.find((s) => s?.type === "access_log")?.data as { timelineEvents?: unknown[] } | undefined)?.timelineEvents ?? [])
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
    .filter((e): e is Record<string, unknown> => !!e && typeof e.message === "string");
  if (timeline.some((e) => classifyChronologyEvent(e.message as string) === "chargeback")) return;
  const text =
    frame.provider !== "card"
      ? `The customer opened a ${frame.providerName ?? "payment"} dispute.`
      : frame.stage === "inquiry"
        ? "The cardholder opened an inquiry."
        : "The cardholder opened a chargeback.";
  const row = { at: openedAt, text };
  // Delivered after the dispute opened: the filing date is not cited, in the
  // prose or the chronology (see the claim in claimLedger.ts).
  if (ledger.some((c) => c.id === "delivered_after_dispute_opened")) return;
  const holder = ledger.find((c) => c.id === "dispute_after_delivery");
  if (holder) {
    holder.timelineEvent = holder.timelineEvent ?? row;
    return;
  }
  ledger.push({
    id: "dispute_opened",
    statement: `The dispute was opened on ${longDate(openedAt)}.`,
    specifics: { disputeOpenedOn: longDate(openedAt)! },
    weight: "supporting",
    sources: ["dispute.initiated_at"],
    mustNot: [],
    timelineEvent: row,
  });
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
  /** The refund policy the letter argues from, printed in full (original +
   *  English), when the ledger holds `return_route_open` (plan §2.2.1). */
  policyExhibit?: PolicyExhibit | null;
}

/** The refund policy as the letter shows it (maintainer, 2026-09-28): its key
 *  term in a few words, from the verified extraction, and a link to the
 *  published policy — never the full text. */
export interface PolicyExhibit {
  summary: string;
  url: string | null;
  updatedOn: string | null;
}

type Obj2 = Record<string, unknown>;

/** Not-as-described inputs that need a record read or a model call: the
 *  ordered items in English (order record), and the verified return window
 *  with the policy text behind it. */
async function prepareNotAsDescribed(
  packSections: LedgerInput["packSections"],
  allowReturnRoute: boolean,
  model: (system: string, user: string, maxTokens: number) => Promise<string>,
): Promise<{ extras: Omit<NotAsDescribedExtras, "constraints">; policy: { text: string; updatedAt: string | null; capturedAt: string | null; url: string | null; windowDays: number | null } | null }> {
  const order = packSections.find((s) => s?.type === "order" && (s.data as Obj2 | null)?.orderName)?.data as Obj2 | undefined;
  const lineItems = ((order?.lineItems as unknown[]) ?? []).map((li) => (li && typeof li === "object" ? (li as Obj2) : {}));
  const described = lineItems
    .map((li) => [li.title, li.variant].filter((x): x is string => typeof x === "string" && !!x.trim()).join(" — "))
    .filter(Boolean);
  const english = await Promise.all(
    described.map((t) =>
      translateListing({ title: t, variantLine: null, excerpt: null }, (s, u) => model(s, u, 400))
        .then((x) => x?.title ?? null)
        .catch(() => null),
    ),
  );
  const orderItemsEnglish = english.every((x): x is string => !!x) ? english : [];

  let policy: { text: string; updatedAt: string | null; capturedAt: string | null; url: string | null; windowDays: number | null } | null = null;
  let returnWindow: NotAsDescribedExtras["returnWindow"] = null;
  if (allowReturnRoute) {
    const refunds = ((packSections.find((s) => s?.source === "policy_snapshots")?.data as Obj2 | undefined)?.policies as unknown[] | undefined ?? [])
      .map((p) => (p && typeof p === "object" ? (p as Obj2) : {}))
      .find((p) => p.policyType === "refunds" && typeof p.policySnapshotId === "string");
    if (refunds) {
      const { data } = await getServiceClient()
        .from("policy_snapshots")
        .select("extracted_text, policy_updated_at, captured_at")
        .eq("id", refunds.policySnapshotId as string)
        .maybeSingle();
      const text = typeof data?.extracted_text === "string" ? data.extracted_text : null;
      if (text) {
        policy = {
          text,
          updatedAt: (data?.policy_updated_at as string | null) ?? null,
          capturedAt: (data?.captured_at as string | null) ?? null,
          url: typeof refunds.publishedUrl === "string" ? refunds.publishedUrl : null,
          windowDays: null,
        };
        const w = await extractReturnWindow(text, (s, u) => model(s, u, 600)).catch(() => null);
        if (w) {
          returnWindow = { windowDays: w.windowDays, policyUpdatedAt: policy.updatedAt };
          policy.windowDays = w.windowDays;
        }
      }
    }
  }
  return { extras: { orderItemsEnglish, returnWindow, returnRouteAllowed: allowReturnRoute }, policy };
}

/** What the writer is told the shipment card prints. It names a delivered date
 *  only when the ledger holds the delivery: told "shipped and delivered dates"
 *  for an order with no delivery on record, the writer wrote that the card
 *  "records its delivery" and the reviewer rejected the letter (#103370). */
export function shipmentCardContext(deliveryRecorded: boolean): string {
  return `Shipment card: carrier, tracking number, ${deliveryRecorded ? "shipped and delivered dates" : "shipped date"}. Tracking link printed below the shipping section.`;
}

/** The timeline's event kinds, by the same rule. */
export function timelineEventsContext(deliveryRecorded: boolean): string {
  return deliveryRecorded ? "order, payment, shipping, delivery, notifications" : "order, payment, shipping, notifications";
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
  /** Payment family (paymentContext) and dispute phase: the frame. */
  paymentFamily?: string | null;
  paymentLabel?: string | null;
  phase?: string | null;
  /** Stored-message constraints: withhold the not-as-described return line. */
  constraints?: InternalNarrativeConstraints | null;
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
  const frame = disputeFrame({ paymentFamily: args.paymentFamily, paymentLabel: args.paymentLabel, phase: args.phase });

  const customerOrders = args.orderGid ? await fetchCustomerOrders(args.shopId, args.orderGid) : [];
  const ledgerInput: LedgerInput = {
    moduleKey: args.moduleKey,
    facts: args.facts,
    packSections: args.packSections,
    orderName: args.orderName,
    disputeOpenedAt: args.disputeOpenedAt,
    disputeAmount: args.disputeAmount,
    disputeCurrency: args.disputeCurrency,
    customerOrders,
  };
  const plainModel = async (system: string, user: string, maxTokens: number) => {
    const r = await callClaudeMessages({
      model: process.env.DEFENCE_COUNSEL_MODEL ?? COUNSEL_DEFAULT_MODEL,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
      temperature: 0,
      maxTokens,
    });
    if (!r.raw) throw new Error(r.error ?? "empty model reply");
    return r.raw;
  };
  const startBrief = briefForModule(args.moduleKey);
  const nad =
    startBrief.type === "product_not_as_described"
      ? await prepareNotAsDescribed(args.packSections, frame.provider === "card" || frame.provider === "paypal", plainModel)
      : null;
  const chosen = ledgerForBrief(startBrief, ledgerInput, args.constraints ?? null, nad?.extras ?? {});
  if (!chosen) {
    console.info(`[counsel] no ledger for ${args.orderName ?? "?"}; no letter`);
    return null;
  }
  const { brief, ledger } = chosen;
  const notAsDescribed = brief.type === "product_not_as_described";
  // The legacy playbook shape the shared checks still read for section keys.
  const playbook = playbookForModule(args.moduleKey) ?? NOT_AS_DESCRIBED;
  addDisputeOpenedRow(ledger, args.packSections, args.disputeOpenedAt, frame);
  addOrderPlacedRow(ledger, args.packSections);

  const delivery = args.facts.find(
    (f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && str(obj(f.value)?.trackingNumber),
  );
  const dv = obj(delivery?.value) ?? {};
  const carrierName = str(dv.carrier);
  const trackingNumber = str(dv.trackingNumber);
  const trackingUrl = str(dv.trackingUrl);
  const disputeNumber = args.disputeGid?.split("/").pop() ?? null;
  const amountDigits = args.amountDisplay?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;

  // Multi-parcel: one card per parcel carries its carrier, reference and link.
  const parcels = ledger.some((c) => c.parcel)
    ? ((args.facts
        .map((f) => obj(f.value)?.shipments)
        .find((x) => Array.isArray(x) && x.length > 1) as unknown[] | undefined) ?? []).map((x) => obj(x) ?? {})
    : [];
  const multi = parcels.length > 1;
  const hasAddresses = ledger.some((c) => c.addressExhibit);
  const hasLater = ledger.some((c) => c.laterOrderExhibit);
  const orderSection = args.packSections.find((s) => s?.type === "order" && (s.data as { orderName?: unknown } | null)?.orderName);
  const lineItemTitles = (((orderSection?.data as { lineItems?: unknown[] } | null)?.lineItems ?? []) as Array<{ title?: unknown }>)
    .map((li) => str(li?.title))
    .filter((x): x is string => !!x);
  const listingTitles = (((args.packSections.find((s) => s?.source === "shopify_product")?.data as { listings?: unknown[] } | null)?.listings ??
    []) as Array<{ title?: unknown }>)
    .map((l) => str(l?.title))
    .filter((x): x is string => !!x);
  const deliveryRecorded = ledger.some((c) => c.id === "carrier_delivered");
  const pageContext = [
    `Header: ${[disputeNumber && `Dispute ${disputeNumber}`, args.orderName && `Order ${args.orderName}`, args.amountDisplay].filter(Boolean).join(" · ")} · submitted on behalf of ${args.merchantName}.`,
    frame.provider === "card"
      ? `Case details table: merchant, card network${args.cardLast4 ? `, card ending ${args.cardLast4}` : ""}, transaction date, order number, disputed amount.`
      : `Case details table: merchant, payment method (${frame.providerName ?? "non-card"}), transaction date, order number, disputed amount.`,
    notAsDescribed && listingTitles.length
      ? "Product listing exhibit below the line items: the store's photographs and text, with an English translation."
      : null,
    notAsDescribed && !trackingNumber
      ? null
      : multi
      ? "Parcel cards, one per parcel: its products, carrier, tracking number or shipping reference, shipped date, delivery date where the carrier recorded one, and the tracking link where one exists."
      : shipmentCardContext(deliveryRecorded),
    hasAddresses ? "Order addresses card under the shipment card: shipping and billing address side by side, stated identical." : null,
    `Line-items table: products, adjustments, total.${hasLater ? " Under it, a card for the same customer's later order (order number, date, amount, card ending, wallet)." : ""}`,
    `Timeline: the order's events (${timelineEventsContext(deliveryRecorded)}) and the opening of the ${frame.provider === "card" ? (frame.stage === "inquiry" ? "inquiry" : "chargeback") : "dispute"}, with dates.`,
    `Request line after the conclusion: "${requestLine(frame)}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const check: CheckContext = {
    ledger,
    playbook,
    brief,
    frame,
    // English only, never the product's store name, for every type.
    forbiddenTitles: [...lineItemTitles, ...listingTitles],
    facts: args.facts,
    disputeOpenedAt: args.disputeOpenedAt,
    merchantName: args.merchantName,
    carrierName,
    pageIdentifiers: [
      args.orderName, args.orderName?.replace(/^#/, ""), trackingNumber, args.cardLast4, amountDigits, disputeNumber,
      ...parcels.map((s) => str(s.reference)),
    ].filter((x): x is string => !!x),
    trackingUrl,
    ...(multi
      ? {
          carrierNames: parcels.map((s) => str(s.carrier)).filter((x): x is string => !!x),
          productNames: parcels.flatMap((s) => ((s.items as unknown[]) ?? []).map((it) => str(obj(it)?.title))).filter((x): x is string => !!x),
        }
      : {}),
  };
  const model = process.env.DEFENCE_COUNSEL_MODEL ?? COUNSEL_DEFAULT_MODEL;
  const reviewModel = process.env.DEFENCE_COUNSEL_REVIEW_MODEL ?? COUNSEL_REVIEW_MODEL;
  const inputHash = counselInputHash({ ledger, pageContext: `${pageContext}\n${frameRule(frame)}`, merchantName: args.merchantName, check, writeModel: model, reviewModel });
  // Multi-parcel: each card prints its own link.
  const trackingLine = trackingUrl && !multi ? `Carrier tracking record: ${trackingUrl}` : null;
  const factIds = args.facts.map((f) => f.id);
  const finish = (draft: CounselDraft): DefenceNarrativeOutput => ({
    ...toNarrative(draft, factIds, trackingLine, ledger),
    counsel: { inputHash, summary: draft.summary.paragraphs },
  });
  const tokens = { prompt: 0, completion: 0, cached: 0 };
  const stages: CounselStageUsage[] = [];
  // The policy the letter argues from: its key term, verified, and a link.
  let policyExhibit: PolicyExhibit | null = null;
  if (nad?.policy?.windowDays && ledger.some((c) => c.id === "return_route_open")) {
    policyExhibit = {
      summary: `Refund on an item returned within ${nad.policy.windowDays} days of delivery`,
      url: nad.policy.url,
      updatedOn: nad.policy.updatedAt,
    };
  }
  const result = (draft: CounselDraft, reused: boolean): CounselRunResult => ({
    policyExhibit,
    narrative: finish(draft),
    ledger,
    modelUsed: model,
    promptVersion: COUNSEL_PROMPT_VERSION,
    promptFamily: COUNSEL_PROMPT_FAMILY,
    tokens,
    durationMs: Date.now() - started,
    reused,
  });

  // Reuse is off for the single writer until it stores and re-checks every
  // part of the letter, not only the summary (plan §2.7).
  void args.findReusable;
  void composeDraft;
  void buildRecordSections;

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

  let written: Awaited<ReturnType<typeof writeLetter>>;
  try {
    written = await writeLetter({ ledger, brief, frame, merchantName: args.merchantName, pageContext, call, log: args.log, check });
  } catch (err) {
    // A model error is still spend: record it before the job falls back.
    await args.onSpend?.({ model, tokens, stages, durationMs: Date.now() - started, ok: false, reused: false });
    throw err;
  }
  await args.onSpend?.({ model, tokens, stages, durationMs: Date.now() - started, ok: written.ok, reused: false });
  if (!written.ok) {
    // Visible in the logs: why there is no letter.
    console.warn(
      `[counsel] summary failed for ${args.orderName ?? "?"} after ${written.corrected ? "the corrections" : "the first draft"}: ` +
        written.issues.join(" | ").slice(0, 800) +
        ` || last summary: ${written.draft.summary.paragraphs.join(" ").slice(0, 900)}`,
    );
    return null;
  }
  return result(written.draft, false);
}
