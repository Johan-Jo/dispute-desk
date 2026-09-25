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
 * The same treatment for the commonest non-receipt letter: one parcel, a
 * carrier record of delivery. Reviewed on blume-box #352543 (2026-09-24):
 * the model's draft stated the delivery five times — the opening line, the
 * summary, the shipping section, again with the URL, and the conclusion,
 * which also asked for reversal twice — and added claims the record does not
 * make ("successful completion of the merchant's shipping obligation").
 *
 * EVERY PART SAYS SOMETHING NO OTHER PART SAYS (maintainer, 2026-09-24:
 * "each section should provide new information else it shouldn't be there").
 *   - opening line: carrier, delivery date, dispute date (thesisTokens.ts);
 *   - summary: the argument drawn from it — one sentence;
 *   - shipment card: carrier, tracking number, shipped, delivered;
 *   - shipping prose: only the tracking link, which nothing else prints;
 *   - timeline: the dated events, customer emails included;
 *   - conclusion: the request line alone — no body restating the record.
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
  const url = str(v.trackingUrl);
  const deliveredAt = str(v.deliveredAt) as string;
  const factIds = delivery.map((f) => f.id);

  // The one thing the card and the timeline cannot carry: the link, as text.
  const account = url ? `${carrier}'s tracking record for this shipment is available at ${url}.` : "";

  const opened = ctx.disputeOpenedAt ? Date.parse(ctx.disputeOpenedAt) : NaN;
  const predates = !Number.isNaN(opened) && Date.parse(deliveredAt) < opened;
  // The inference, not the facts: the opening line directly above states them.
  // "Contradicts" only when the record predates the dispute — a delivery
  // after it answers the claim, but it was true when it was made.
  const summary = predates
    ? "The carrier's delivery record contradicts the claim that the item was not received."
    : "The carrier's delivery record answers the claim that the item was not received.";

  const omitted = narrative.omittedSections ?? [];
  return {
    ...narrative,
    executiveSummary: section(summary, factIds),
    transactionOverviewArgument: section("", []),
    chronologyArgument: section("", []),
    fulfillmentArgument: section(account, factIds),
    // No body: the conclusion's request line is the whole conclusion.
    conclusion: section("", []),
    omittedSections: [
      ...omitted.filter(
        (o) =>
          o.sectionKey !== "transactionOverviewArgument" &&
          o.sectionKey !== "chronologyArgument" &&
          o.sectionKey !== "conclusion",
      ),
      { sectionKey: "transactionOverviewArgument", reason: "The transaction is set out in the case details." },
      { sectionKey: "chronologyArgument", reason: "The dated events are listed in the timeline." },
      { sectionKey: "conclusion", reason: CONCLUSION_REASON },
    ],
  };
}
