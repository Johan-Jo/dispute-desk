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
import { fulfilmentCoverage } from "./fulfilmentCoverage";
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
  /** The order's email address (to say the updates went to it). */
  customerEmail?: string | null;
  /** The pack sections — the order and fulfilment line items, for
   *  `fulfilmentCoverage`. */
  packSections?: ReadonlyArray<{ type?: string | null; data?: unknown }>;
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
 * Written from the records, reviewed on blume-box #352543 three times:
 *   - 2026-09-24: the model's draft stated the delivery five times and added
 *     claims the record does not make;
 *   - 2026-09-25 (a): the record-only rewrite was one sentence of argument;
 *   - 2026-09-25 (b): "it still reads as an explanation of our records. It
 *     needs to USE those records to make the merchant's case."
 *
 * The argument: the claim is non-receipt; the shipment linked to this
 * purchase has a carrier-recorded delivery; the fulfilment mapping (when
 * verified item by item) puts every purchased item in that shipment; so the
 * delivery evidence addresses the complete disputed purchase. Each section
 * carries its own part of it:
 *   - summary: the position, the amount, and the chain the case rests on;
 *   - shipping (under the card): order → shipment → carrier delivery, and
 *     why the carrier's record, not the merchant's, answers non-receipt;
 *   - line items (under the table): the shipment covers every item (only
 *     when `fulfilmentCoverage` verifies it), and the money reconciles to the
 *     disputed amount (only when it does);
 *   - chronology (above the timeline): the delivery is dated before the
 *     dispute (only when it is), and the emails as shipment updates sent to
 *     the order's email address — never as proof of receipt;
 *   - conclusion: the reasoning, then the request line (a fixed template).
 * Every connection is conditional on the record that makes it. Never:
 * "independent" corroboration, the passage of time as an argument, when a
 * record was CREATED (only the date it reports), where the parcel was
 * delivered (rule 14), personal receipt or the customer's intentions.
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

const fmt = (currency: string, amount: number) => `${currency} ${amount.toFixed(2)}`;

/** The disputed amount as the letter prints it: "CAD 120.75". */
export function disputedAmountDisplay(amount: number | null | undefined, currency: string | null | undefined): string | null {
  return typeof amount === "number" && Number.isFinite(amount) && currency ? fmt(currency, amount) : null;
}

/** The address an order-history email line names: "… to Name (a@b.c)". */
function emailIn(text: string): string | null {
  const m = text.match(/\(([^()\s]+@[^()\s]+)\)/);
  return m ? m[1].toLowerCase() : null;
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
  const tracking = str(v.trackingNumber) as string;
  const url = str(v.trackingUrl);
  const deliveredAt = str(v.deliveredAt) as string;
  const signed = v.proofType === "signature_confirmed";
  const factIds = delivery.map((f) => f.id);
  const events = ctx.timelineEvents ?? [];
  const amount = disputedAmountDisplay(ctx.disputeAmount, ctx.disputeCurrency);
  const coverage = fulfilmentCoverage(ctx.packSections, tracking, events);
  const allItems = coverage?.kind === "verified";
  const itemCount = coverage?.kind === "verified" ? coverage.itemCount : 0;
  const itemsWord = itemCount === 1 ? "the purchased item" : `all ${count(itemCount)} purchased items`;
  const opened = ctx.disputeOpenedAt ? Date.parse(ctx.disputeOpenedAt) : NaN;
  const predates = !Number.isNaN(opened) && Date.parse(deliveredAt) < opened;

  // COPY RULE (maintainer, 2026-09-25): every fact is stated ONCE, where it
  // belongs, and the prose refers back to it. The page header carries the
  // order number; the opening line the carrier and the two dates; the card
  // the tracking number, shipped and delivered times; the table the amounts;
  // the timeline every dated event. The prose carries the ARGUMENT — no
  // order number, no tracking number, no timestamps, the carrier named once
  // (in the opening line) and "the carrier" after.

  // ── Executive summary ──
  const summary = [
    `The merchant contests this${amount ? ` ${amount}` : ""} non-receipt chargeback.`,
    allItems
      ? "Linked order, fulfilment and carrier records connect the purchased goods to the tracked shipment and its delivery event, an affirmative basis to contest the claim in full."
      : "Linked order, fulfilment and carrier records connect the order to the tracked shipment and its delivery event, an affirmative basis to contest the claim.",
  ].join(" ");

  // ── Shipping & Delivery (under the card) ──
  const link1 = allItems
    ? `The fulfilment record places ${itemsWord} in the single shipment shown above, and the carrier then recorded that shipment as delivered${signed ? ", with a signature" : ""}.`
    : coverage?.kind === "history"
      ? `The order history records ${coverage.actor} marking ${coverage.markedCount} ${coverage.markedCount === 1 ? "item" : "items"} as fulfilled in the shipment shown above, and the carrier then recorded that shipment as delivered${signed ? ", with a signature" : ""}.`
      : `The carrier recorded the shipment shown above as delivered${signed ? ", with a signature" : ""}.`;
  const why =
    "This distinction matters. The merchant does not rely only on its own record that the order was dispatched: " +
    "the carrier's record reports the delivery itself, which is the event a non-receipt claim puts in issue.";
  const shipping = [link1, why, url ? `Carrier tracking record: ${url}` : null]
    .filter((p): p is string => !!p)
    .join("\n\n");

  // ── Order Line Items (under the table) ──
  // Only what the table cannot show: that the shipment holds every item.
  // The table's rows and Total already do the arithmetic — restating the
  // numbers in prose is clutter (maintainer, 2026-09-25).
  const lineItemsProse = allItems
    ? "The fulfilment record accounts for each product above, in the quantity ordered, within that one shipment. The delivery evidence therefore covers the complete order, not one item or a partial shipment."
    : "";

  // ── Chronology (above the timeline) ──
  const sequence = predates
    ? "As the timeline below shows, the carrier-recorded delivery is dated before the dispute was opened."
    : null;
  const orderEmail = ctx.customerEmail ? ctx.customerEmail.toLowerCase() : null;
  const confirmation = events.find((e) => classifyChronologyEvent(e.text) === "shipping_confirmation");
  const notice = events.find((e) => classifyChronologyEvent(e.text) === "delivery_notification");
  const mailed = [confirmation, notice].filter((e): e is { at: string; text: string } => !!e);
  const sameAddress = !!orderEmail && mailed.length > 0 && mailed.every((e) => emailIn(e.text) === orderEmail);
  const updates =
    confirmation && notice
      ? "shipping and delivery notifications"
      : confirmation
        ? "a shipping notification"
        : notice
          ? "a delivery notification"
          : null;
  const emails = updates
    ? `The order history also records ${updates} sent to the ${sameAddress ? "customer's recorded email address" : "customer"}. These document the updates sent; the evidence of delivery remains the carrier's record.`
    : null;
  const chronology = [sequence, emails].filter((p): p is string => !!p).join("\n\n");

  // ── Conclusion (reasoning; the request line follows it) ──
  const conclusion = allItems
    ? `The order and fulfilment records place the disputed goods in the tracked shipment, and the carrier records that shipment as delivered. These records support the merchant's position that the complete purchase was delivered.`
    : `The order and fulfilment records connect the order to the tracked shipment, and the carrier records that shipment as delivered.`;

  const record = (text: string): NarrativeSection => ({ text, usedFactIds: text ? factIds : [], source: "record" });
  const keep = new Set(["transactionOverviewArgument", "chronologyArgument", "conclusion"]);
  const omitted = (narrative.omittedSections ?? []).filter((o) => !keep.has(o.sectionKey));
  if (!lineItemsProse) omitted.push({ sectionKey: "transactionOverviewArgument", reason: "The line items are set out in the table." });
  if (!chronology) omitted.push({ sectionKey: "chronologyArgument", reason: "The dated events are listed in the timeline." });
  return {
    ...narrative,
    executiveSummary: record(summary),
    // Printed under the Order Line Items table (DefencePackageDocument.tsx).
    transactionOverviewArgument: record(lineItemsProse),
    chronologyArgument: record(chronology),
    fulfillmentArgument: record(shipping),
    conclusion: record(conclusion),
    omittedSections: omitted,
  };
}
