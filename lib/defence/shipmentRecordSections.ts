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

import type { DefenceNarrativeOutput, EvidenceFact, NarrativeSection } from "./types";

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

function hasCarrierRecord(s: Shipment): boolean {
  return (
    s.proofType === "in_transit" ||
    s.proofType === "delivered_confirmed" ||
    s.proofType === "signature_confirmed"
  );
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

/** Dated records only, oldest first — a true order, never an inferred one. */
function chronology(shipments: Shipment[]): string {
  const rows: Array<{ at: number; text: string }> = [];
  for (const s of shipments) {
    const items = itemsOf(s);
    const carrier = str(s.carrier) ?? "The carrier";
    const push = (iso: unknown, text: string) => {
      const t = typeof iso === "string" ? Date.parse(iso) : NaN;
      if (!Number.isNaN(t)) {
        rows.push({ at: t, text: `${day(iso)}: ${text.charAt(0).toUpperCase()}${text.slice(1)}` });
      }
    };
    // Dates and events only — identifiers and links appear once, in the
    // fulfilment section.
    if (s.proofType === "signature_confirmed" || s.proofType === "delivered_confirmed") {
      push(s.deliveredAt, `${carrier} records delivery of ${items}.`);
    } else if (s.proofType === "in_transit") {
      push(s.inTransitSince, `${carrier}'s tracking record shows ${items} in transit.`);
    } else {
      push(s.fulfilledAt, `the merchant shipped ${items}${str(s.carrier) ? ` (${str(s.carrier)})` : ""}.`);
    }
  }
  return rows
    .sort((a, b) => a.at - b.at)
    .map((r) => r.text)
    .join(" ");
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** One clause per parcel for the summary: what its record shows, no
 *  identifiers or links (the fulfilment section carries those, once). */
function summaryClause(s: Shipment): string {
  const items = itemsOf(s);
  const carrier = str(s.carrier) ?? "the carrier";
  if (s.proofType === "signature_confirmed" || s.proofType === "delivered_confirmed") {
    const when = day(s.deliveredAt);
    return `${items}, which ${carrier}'s record shows delivered${when ? ` on ${when}` : ""}`;
  }
  if (s.proofType === "in_transit") {
    const since = day(s.inTransitSince);
    return since
      ? `${items}, which ${carrier}'s tracking record first shows in transit on ${since}`
      : `${items}, which ${carrier}'s tracking record shows in transit`;
  }
  const fulfilled = day(s.fulfilledAt);
  return `${items}, shipped by the merchant${fulfilled ? ` on ${fulfilled}` : ""}`;
}

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
): DefenceNarrativeOutput {
  const basis = shipmentBasis(approvedFacts);
  if (!basis) return narrative;
  const { shipments, factIds } = basis;
  const n = shipments.length;
  const accounts = shipments.map(parcelAccount);
  const clauses = shipments.map(summaryClause);
  const listed =
    clauses.length === 2
      ? `${clauses[0]}; and ${clauses[1]}`
      : `${clauses.slice(0, -1).join("; ")}; and ${clauses[clauses.length - 1]}`;
  const recorded = shipments.filter(hasCarrierRecord).map((s) => str(s.carrier)).filter(Boolean);

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
    (o) => o.sectionKey !== "transactionOverviewArgument" && o.sectionKey !== "chronologyArgument",
  );
  return {
    ...narrative,
    executiveSummary: section(`The order was sent in ${count(n)} parcels: ${listed}.`, factIds),
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
    conclusion: section(
      recorded.length > 0
        ? `The request rests on ${recorded.length === 1 ? `${recorded[0]}'s tracking record` : "the carriers' tracking records"} and the merchant's shipping records set out above.`
        : "The request rests on the merchant's shipping records set out above.",
      factIds,
    ),
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
    ],
  };
}
