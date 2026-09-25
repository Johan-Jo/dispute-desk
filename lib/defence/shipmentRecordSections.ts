/**
 * Multi-parcel item-not-received letters: the sections that describe the
 * parcels are written from the records, not by the model.
 *
 * blume-box #360980 (two products, two parcels) took eight rebuilds on
 * 2026-09-23. Each fixed one invented sentence and the next draft found a new
 * one: "tendered to their respective carriers prior to the filing of this
 * dispute", "USPS holds no carrier-confirmed delivery record", "the Bundle was
 * SUBSEQUENTLY fulfilled" (it was fulfilled first), "non-receipt is not
 * consistent with the carrier record" (an in-transit parcel is exactly
 * consistent with it). The facts of a multi-parcel order are few and fully
 * known, so there is nothing for a model to phrase — and nothing it can get
 * wrong once it is not asked to.
 *
 * Applied only when a delivery fact carries `shipments` (two or more parcels,
 * written by the classifier). Every other letter is unchanged. The model's
 * other sections (policy, communication, …) are kept and validated as before.
 *
 * Each parcel is stated ONLY from its own entry, with the same rules the
 * overlay gives the model (docs/technical.md § non-receipt letters):
 *   - a tracking number only when `referenceIsTrackingNumber`, with its link;
 *     otherwise a "shipping reference", no link;
 *   - delivery only from `deliveredAt` on a carrier-confirmed tier;
 *   - transit dated from `inTransitSince` ("first shows … in transit on"),
 *     else as a retrieval;
 *   - a parcel with no carrier record: "shipped by the merchant", nothing
 *     more — "delivered" only ever from a carrier's record (maintainer,
 *     2026-09-24: "fulfilled" is Shopify's term and means too many things);
 *   - no date is related to the dispute or the order, and nothing is said about
 *     what a record lacks.
 */

import { familyKeyForModule } from "./reasonCodes/familyRegistry";
import { classifyChronologyEvent } from "./chronology";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  ReasonCodeModuleKey,
} from "./types";

/** What the single-parcel sections read besides the facts. */
export interface RecordSectionContext {
  moduleKey?: string | null;
  orderName?: string | null;
  disputeOpenedAt?: string | null;
  /** The order timeline (Shopify Order.events, allow-listed downstream). */
  timelineEvents?: ReadonlyArray<{ at: string; text: string }>;
  /** The Order Line Items rows (items plus discount/shipping/tax rows). */
  lineItems?: ReadonlyArray<{ description: string; quantity: number; price: string; kind?: "item" | "adjustment" }>;
  disputeAmount?: number | null;
  disputeCurrency?: string | null;
}

type Shipment = Record<string, unknown>;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "17 September 2026", in UTC — the date the record carries. */
function day(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function itemsOf(s: Shipment): string {
  const items = Array.isArray(s.items) ? (s.items as Array<Record<string, unknown>>) : [];
  const names = items
    .map((it) => {
      const title = str(it.title);
      if (!title) return null;
      return typeof it.quantity === "number" && it.quantity > 1 ? `${it.quantity} × ${title}` : title;
    })
    .filter((t): t is string => t !== null);
  if (names.length === 0) return "The shipment";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "GOFO tracking number YT… (https://…)" or "USPS shipping reference 26…". */
function identity(s: Shipment): string {
  const carrier = str(s.carrier);
  const ref = str(s.reference);
  if (!ref) return carrier ?? "";
  if (s.referenceIsTrackingNumber === true) {
    const url = str(s.trackingUrl);
    return `${carrier ? `${carrier} ` : ""}tracking number ${ref}${url ? ` (${url})` : ""}`;
  }
  return `${carrier ? `${carrier} ` : ""}shipping reference ${ref}`;
}

/** What THIS parcel's own record shows, as one or two sentences. */
function parcelAccount(s: Shipment): string {
  const items = itemsOf(s);
  const carrier = str(s.carrier) ?? "The carrier";
  const id = identity(s);
  if (s.proofType === "signature_confirmed" || s.proofType === "delivered_confirmed") {
    const when = day(s.deliveredAt);
    const signed = s.proofType === "signature_confirmed" ? ", with a signature on delivery" : "";
    return `${items}: ${id}. ${carrier}'s record confirms delivery${when ? ` on ${when}` : ""}${signed}.`;
  }
  if (s.proofType === "in_transit") {
    const since = day(s.inTransitSince);
    const retrieved = day(s.carrierStatusObservedAt);
    const status = since
      ? `first shows the shipment in transit on ${since}`
      : retrieved
        ? `shows the shipment in transit (status as retrieved on ${retrieved})`
        : "shows the shipment in transit";
    return `${items}: ${id}. ${carrier}'s tracking record ${status}.`;
  }
  const fulfilled = day(s.fulfilledAt);
  return `${items}: shipped by the merchant${fulfilled ? ` on ${fulfilled}` : ""} (${id}).`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** The conclusion body is left empty on purpose: its request line (a fixed
 *  template, composePdfBlocks) is the whole conclusion. */
const CONCLUSION_REASON = "The request line is the conclusion; the record is set out above.";

function section(text: string, usedFactIds: string[]): NarrativeSection {
  return { text, usedFactIds };
}

/**
 * The delivery fact carrying the parcel list, and every delivery fact id the
 * record sections stand on. Null when the letter is not multi-parcel.
 */
function shipmentBasis(
  facts: readonly EvidenceFact[],
): { shipments: Shipment[]; factIds: string[] } | null {
  const delivery = facts.filter(
    (f) => f.category === "delivery_proof" || f.category === "shipping_tracking",
  );
  const withList = delivery.find((f) => {
    const s = (f.value as Record<string, unknown> | null)?.shipments;
    return Array.isArray(s) && s.length > 1;
  });
  if (!withList) return null;
  const shipments = (withList.value as Record<string, unknown>).shipments as Shipment[];
  return { shipments, factIds: delivery.map((f) => f.id) };
}

/**
 * Replace the parcel-describing sections with the record's own account.
 * Returns the narrative unchanged for any letter that is not multi-parcel.
 */
export function applyShipmentRecordSections(
  narrative: DefenceNarrativeOutput,
  approvedFacts: readonly EvidenceFact[],
  ctx?: RecordSectionContext,
): DefenceNarrativeOutput {
  const basis = shipmentBasis(approvedFacts);
  if (!basis) return ctx ? applySingleParcelRecordSections(narrative, approvedFacts, ctx) : narrative;
  const { shipments, factIds } = basis;
  const n = shipments.length;
  const accounts = shipments.map(parcelAccount);

  /* Each section says something the others do not — the composed document
   * already opens every section with a fixed thesis line (thesisTemplates.ts),
   * and the first version of this module repeated the parcels in four
   * sections and the reversal request twice (maintainer, 2026-09-23):
   *   - summary: one sentence per parcel, no identifiers;
   *   - fulfilment: the one full account, with tracking numbers and links;
   *   - chronology: dates and events only;
   *   - conclusion: what the request rests on — the thesis line asks for
   *     reversal, so the body does not ask again;
   *   - transaction overview: omitted — it would only repeat the summary,
   *     under a thesis written for card-fraud cases. */
  const omitted = narrative.omittedSections.filter(
    (o) =>
      o.sectionKey !== "transactionOverviewArgument" &&
      o.sectionKey !== "chronologyArgument" &&
      o.sectionKey !== "conclusion",
  );
  return {
    ...narrative,
    // The opening line states the delivered parcel; the cards state each
    // parcel. The summary adds only how many there are.
    executiveSummary: section(`The order was sent in ${count(n)} parcels, each set out below.`, factIds),
    transactionOverviewArgument: section("", []),
    fulfillmentArgument: section(
      [`The order was sent in ${count(n)} parcels.`, ...accounts].join("\n\n"),
      factIds,
    ),
    // One timeline, not two: the dated parcel events join the order-event
    // bullets (lib/defence/chronology.ts, `withShipmentEvents`), which the
    // renderer already prints under this heading. A paragraph here repeated
    // them in a second, differently-ordered list (#360980, 2026-09-23).
    chronologyArgument: section("", []),
    // No body: the request line is the conclusion (see the single-parcel note).
    conclusion: section("", []),
    omittedSections: [
      ...omitted,
      {
        sectionKey: "transactionOverviewArgument",
        reason: "Multi-parcel order: the shipments are set out in the summary and fulfilment sections.",
      },
      {
        sectionKey: "chronologyArgument",
        reason: "Multi-parcel order: the dated parcel events are listed in the timeline.",
      },
      { sectionKey: "conclusion", reason: CONCLUSION_REASON },
    ],
  };
}

/* ── Single parcel, carrier-confirmed delivery ─────────────────────────
 *
 * The commonest non-receipt letter: one parcel, a carrier record of delivery.
 * Written from the records, reviewed on blume-box #352543 twice:
 *   - 2026-09-24: the model's draft stated the delivery five times and added
 *     claims the record does not make ("successful completion of the
 *     merchant's shipping obligation");
 *   - 2026-09-25: the record-only rewrite overcorrected — one sentence of
 *     argument, no reasoning. "Remove repeated wording, not reasoning."
 *
 * So each part has a distinct job, and the shipping section argues the CHAIN
 * the records form, each link stated only when the data carries it:
 *   - opening line: carrier, delivery date, dispute date (thesisTokens.ts);
 *   - summary: the merchant's position and what the defence rests on;
 *   - shipping section (under the card): order → shipment (the fulfilment
 *     record, with the item count when ONE fulfilment covers every item) →
 *     carrier delivery; that delivery against the dispute date; the money,
 *     when the items, discount, shipping and tax add up to the disputed
 *     amount; the customer emails, as notices and never as proof of
 *     receipt; the tracking link;
 *   - conclusion body: what the request rests on, with the amount — the
 *     request line itself is the fixed template above it.
 * Never: "independent" corroboration (one carrier event, several copies),
 * the passage of time as an argument, where the parcel was delivered
 * (rule 14), or a sent email as receipt.
 * Item not received only, and only for a carrier-confirmed delivery with a
 * carrier and a tracking number. Everything else keeps the model's prose.
 */

function isItemNotReceived(moduleKey: string | null | undefined): boolean {
  if (!moduleKey) return false;
  try {
    return familyKeyForModule(moduleKey as ReasonCodeModuleKey) === "item_not_received";
  } catch {
    return false;
  }
}

/** "19:53 UTC". */
function clock(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "6 July" — the year is already stated in the same paragraph. */
function dayMonth(iso: string): string | null {
  const full = day(iso);
  return full ? full.replace(/\s\d{4}$/, "") : null;
}

function money(price: string): { currency: string; amount: number } | null {
  const m = price.match(/^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/);
  return m ? { currency: m[1], amount: Number(m[2]) } : null;
}

const fmt = (currency: string, amount: number) => `${currency} ${amount.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100);

/**
 * "The three items total CAD 145.50; less the CAD 47.50 discount, plus
 * CAD 10.00 shipping and CAD 12.75 tax, the order comes to CAD 120.75, the
 * full disputed amount." Null unless every row is in the dispute's currency
 * and the rows add up to the disputed amount exactly.
 */
function reconciliation(ctx: RecordSectionContext, itemCount: number): string | null {
  const rows = ctx.lineItems ?? [];
  const items = rows.filter((r) => r.kind !== "adjustment");
  const adjustments = rows.filter((r) => r.kind === "adjustment");
  const currency = ctx.disputeCurrency ?? null;
  const disputed = ctx.disputeAmount;
  if (!currency || typeof disputed !== "number" || items.length === 0) return null;
  const parsed = rows.map((r) => money(r.price));
  if (parsed.some((p) => !p || p.currency !== currency)) return null;
  const total = parsed.reduce((s, p) => s + p!.amount, 0);
  if (cents(total) !== cents(disputed)) return null;
  const subtotal = items.reduce((s, r) => s + money(r.price)!.amount, 0);
  const itemsPhrase = `The ${itemCount === 1 ? "item costs" : `${count(itemCount)} items total`} ${fmt(currency, subtotal)}`;
  if (adjustments.length === 0) {
    return `${itemsPhrase}, the full disputed amount.`;
  }
  const less: string[] = [];
  const plus: string[] = [];
  for (const r of adjustments) {
    const a = money(r.price)!.amount;
    const label = r.description.toLowerCase();
    if (a < 0) less.push(label === "discount" ? `the ${fmt(currency, -a)} discount` : `${fmt(currency, -a)} in ${label}`);
    else plus.push(`${fmt(currency, a)} ${label}`);
  }
  const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts = [less.length ? `less ${join(less)}` : null, plus.length ? `plus ${join(plus)}` : null].filter(Boolean);
  return `${itemsPhrase}; ${parts.join(", ")}, the order comes to ${fmt(currency, disputed)}, the full disputed amount.`;
}

export function applySingleParcelRecordSections(
  narrative: DefenceNarrativeOutput,
  approvedFacts: readonly EvidenceFact[],
  ctx: RecordSectionContext,
): DefenceNarrativeOutput {
  if (!isItemNotReceived(ctx.moduleKey)) return narrative;
  const delivery = approvedFacts.filter(
    (f) => f.category === "delivery_proof" || f.category === "shipping_tracking",
  );
  const fact = delivery.find((f) => {
    const v = (f.value ?? {}) as Record<string, unknown>;
    return (
      (v.proofType === "delivered_confirmed" || v.proofType === "signature_confirmed") &&
      str(v.carrier) !== null &&
      str(v.trackingNumber) !== null &&
      day(v.deliveredAt) !== null
    );
  });
  if (!fact) return narrative;
  const v = (fact.value ?? {}) as Record<string, unknown>;
  const carrier = str(v.carrier) as string;
  const tracking = str(v.trackingNumber) as string;
  const url = str(v.trackingUrl);
  const deliveredAt = str(v.deliveredAt) as string;
  const signed = v.proofType === "signature_confirmed";
  const factIds = delivery.map((f) => f.id);
  const order = ctx.orderName ? `order ${ctx.orderName}` : "the order";
  const events = ctx.timelineEvents ?? [];

  // Link 1 — order → shipment. "All N items" only when exactly ONE
  // fulfilment is recorded and its item count equals the order's.
  const itemCount = (ctx.lineItems ?? [])
    .filter((r) => r.kind !== "adjustment")
    .reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const fulfilments = events.filter((e) => classifyChronologyEvent(e.text) === "fulfillment_shipment");
  const markedCount = fulfilments.length === 1 ? fulfilments[0].text.match(/marked (\d+) items? as fulfilled/i) : null;
  const allItems = markedCount !== null && itemCount > 0 && Number(markedCount[1]) === itemCount;
  const fulfilledOn = fulfilments.length === 1 ? day(fulfilments[0].at) : null;
  const what = allItems
    ? itemCount === 1
      ? "records the purchased item as shipped"
      : `records all ${count(itemCount)} purchased items as shipped together`
    : "records the order as shipped";
  const link1 = `The merchant's fulfilment record for ${order} ${what}${fulfilledOn ? ` on ${fulfilledOn}` : ""} under ${carrier} tracking number ${tracking}.`;

  // Link 2 — shipment → carrier delivery.
  const at = clock(deliveredAt);
  const link2 =
    `${carrier} then recorded that shipment as delivered on ${day(deliveredAt)}${at ? ` at ${at}` : ""}` +
    `${signed ? ", with a signature" : ""}. ` +
    "This is the carrier's own record, not the merchant's: it shows that the shipment carrying the disputed purchase reached delivered status.";

  // Timing — the delivery against the dispute, as sequence only.
  const opened = ctx.disputeOpenedAt ? Date.parse(ctx.disputeOpenedAt) : NaN;
  const predates = !Number.isNaN(opened) && Date.parse(deliveredAt) < opened;
  const timing = predates
    ? `The delivery was recorded on ${dayMonth(deliveredAt)}, and the dispute was opened on ${day(ctx.disputeOpenedAt)}: the record relied on here was made before the claim, not in response to it.`
    : null;

  // Money — only when the rows add up to the disputed amount.
  const sums = reconciliation(ctx, itemCount);
  const money_ = sums
    ? allItems
      ? `${sums} The shipment therefore accounts for the whole of the disputed purchase.`
      : sums
    : null;

  // Notices — what the customer was told, never proof of receipt.
  const confirmation = events.find((e) => classifyChronologyEvent(e.text) === "shipping_confirmation");
  const notice = events.find((e) => classifyChronologyEvent(e.text) === "delivery_notification");
  const notices = [
    confirmation ? `a shipping confirmation email on ${dayMonth(confirmation.at)}` : null,
    notice ? `a delivery notification on ${dayMonth(notice.at)}` : null,
  ].filter((s): s is string => s !== null);
  const emails = notices.length
    ? `The order history also records ${notices.join(" and ")}, sent to the customer. They show the customer was kept informed; the delivery itself rests on the carrier's record.`
    : null;

  const linkLine = url ? `${carrier}'s tracking record for this shipment is available at ${url}.` : null;

  const shipping = [`${link1} ${link2}`, timing, money_, emails, linkLine]
    .filter((p): p is string => !!p)
    .join("\n\n");

  const amount =
    typeof ctx.disputeAmount === "number" && ctx.disputeCurrency
      ? `${fmt(ctx.disputeCurrency, ctx.disputeAmount)} `
      : "";
  const summary =
    `The merchant contests the ${amount}non-receipt chargeback in full. ` +
    "The defence rests on the chain of records set out below: the order identifies what was purchased, " +
    `the fulfilment record ties ${allItems ? "those items" : "the order"} to the ${carrier} shipment, ` +
    "and the carrier's record shows that shipment as delivered.";

  const conclusion =
    `The records connect the ${amount ? `full ${amount.trim()} ` : ""}purchase to a shipment that ${carrier} recorded as delivered` +
    `${predates ? " before the dispute was opened" : ""}.`;

  const omitted = narrative.omittedSections ?? [];
  return {
    ...narrative,
    executiveSummary: section(summary, factIds),
    transactionOverviewArgument: section("", []),
    chronologyArgument: section("", []),
    fulfillmentArgument: section(shipping, factIds),
    conclusion: section(conclusion, factIds),
    omittedSections: [
      ...omitted.filter(
        (o) =>
          o.sectionKey !== "transactionOverviewArgument" &&
          o.sectionKey !== "chronologyArgument" &&
          o.sectionKey !== "conclusion",
      ),
      { sectionKey: "transactionOverviewArgument", reason: "The transaction is set out in the case details." },
      { sectionKey: "chronologyArgument", reason: "The dated events are listed in the timeline." },
    ],
  };
}
