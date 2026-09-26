/**
 * The parts of a counsel letter that code writes (cost refactor §3.1, §3.3).
 *
 * The Shipping pair, the carrier-record sentence and the conclusion follow
 * directly from ledger claims, so they are rendered here instead of generated.
 * The wording is the letter filed as v12 for #352543 (package caa70bf2),
 * which the maintainer reviewed. The model writes only the executive summary
 * (generate.ts).
 *
 * The theory of the case is picked by code too: the playbook lists theories
 * in order of force, and the first one whose claims are all in the ledger is
 * the theory.
 */

import type { CounselSection, EvidenceSectionKey, LedgerClaim, Playbook } from "./types";

export interface Theory {
  name: string;
  shape: string;
  /** The claims the summary must carry for this theory. */
  claims: string[];
}

/** Used when no playbook theory has all its claims (e.g. delivery + dispute date only). */
const DEFAULT_THEORY: Theory = {
  name: "carrier_delivered",
  shape: "The carrier recorded delivery of the order the cardholder says never arrived. Lead with the carrier's delivery against the claim.",
  claims: ["carrier_delivered"],
};

export function pickTheory(ledger: readonly LedgerClaim[], playbook: Playbook): Theory {
  const ids = new Set(ledger.map((c) => c.id));
  const t = playbook.theories.find((x) => x.requiresClaims.every((id) => ids.has(id)));
  if (!t) return DEFAULT_THEORY;
  // A multi-parcel summary names every parcel: each is its own claim.
  const parcels = ledger.filter((c) => c.parcel).map((c) => c.id);
  return { name: t.name, shape: t.shape, claims: [...t.requiresClaims, ...parcels] };
}

export interface RecordSections {
  evidenceSections: Array<CounselSection & { key: EvidenceSectionKey }>;
  conclusion: CounselSection;
}

export function buildRecordSections(ledger: readonly LedgerClaim[]): RecordSections {
  if (ledger.some((c) => c.parcel)) return buildMultiParcelSections(ledger);
  const byId = new Map(ledger.map((c) => [c.id, c]));
  const has = (id: string) => byId.has(id);

  // Shipping & Delivery: the record is the carrier's own; the whole order in
  // one parcel. The delivery date is on the card above, so it is not restated.
  const shipping: string[] = [];
  const shippingIds: string[] = ["carrier_delivered"];
  if (has("carrier_is_third_party")) {
    shipping.push(
      "The delivery shown on the card above is the carrier's own scan, published on its public tracking page; the issuer can open it with the link below.",
    );
    shippingIds.push("carrier_is_third_party");
  } else {
    shipping.push("The delivery shown on the card above is the carrier's own scan.");
  }
  if (has("signed_for")) {
    shipping.push("The carrier also recorded a signature on delivery.");
    shippingIds.push("signed_for");
  }
  const whole = byId.get("whole_order_in_shipment");
  if (whole) {
    const n = Number(whole.specifics.itemCount);
    shipping.push(
      n === 1
        ? "The item listed under Order Line Items was in this single tracked shipment."
        : n === 2
          ? "Both items listed under Order Line Items were in this single tracked shipment."
          : `All ${whole.specifics.itemCountWord} items listed under Order Line Items were in this single tracked shipment.`,
      "There was no partial or second shipment, so no part of the non-receipt claim falls outside this delivery.",
    );
    shippingIds.push("whole_order_in_shipment");
  }

  // No Chronology prose (as filed in v12): the timeline exhibit prints
  // regardless, and the summary carries the intervals that matter.

  // Conclusion: the strongest facts restated without dates or numbers, then
  // the one-line answer. The fixed request line follows it on the page.
  const later = byId.get("later_order");
  const conclusion = [
    `The carrier recorded delivery of the ${whole ? "entire " : ""}order${has("signed_for") ? ", with a signature" : ""}.`,
    later ? `After that delivery, the same customer placed a new order${later.specifics.paidWith ? " with the same payment method" : ""}.` : null,
    "The non-receipt claim is not supported by the record.",
  ].filter((x): x is string => !!x);

  const evidenceSections: RecordSections["evidenceSections"] = [
    { key: "shipping", paragraphs: [shipping.join(" ")], claimIds: shippingIds },
  ];

  return {
    evidenceSections,
    conclusion: {
      paragraphs: [conclusion.join(" ")],
      claimIds: ["carrier_delivered", ...(whole ? ["whole_order_in_shipment"] : []), ...(later ? ["later_order"] : [])],
    },
  };
}

/**
 * Multi-parcel orders (#360980). The cards above print each parcel's carrier,
 * reference, dates and link; the prose says what the cards prove, parcel by
 * parcel, each from its own record — never a date against the order or the
 * dispute, never "delivered" for a parcel the carrier did not record as
 * delivered, and nothing about what a record lacks.
 */
function buildMultiParcelSections(ledger: readonly LedgerClaim[]): RecordSections {
  const byId = new Map(ledger.map((c) => [c.id, c]));
  const parcels = ledger.filter((c) => c.parcel).map((c) => ({ id: c.id, ...c.parcel! }));
  const inParcels = byId.get("order_in_parcels");
  const everyItem = inParcels?.specifics.allItemsInParcels === "yes";
  const delivered = parcels.filter((p) => p.state === "delivered" || p.state === "signed");
  const all = byId.has("all_parcels_delivered");
  const word = inParcels?.specifics.parcelCountWord ?? String(parcels.length);

  const shipping: string[] = [
    `The order was sent in ${word} parcels, shown on the cards above${everyItem ? ", and every item listed under Order Line Items was in one of them" : ""}.`,
  ];
  if (all) {
    const linked = delivered.every((p) => p.hasLink);
    shipping.push(
      `The carrier recorded each parcel as delivered${delivered.some((p) => p.state === "signed") ? ", with a signature where its card shows one" : ""}` +
        (linked ? "; each delivery is the carrier's own scan, published on its public tracking page, which the issuer can open with the link on the parcel's card." : "."),
    );
  } else {
    for (const p of parcels) {
      if (p.state === "delivered" || p.state === "signed") {
        shipping.push(
          `The parcel with ${p.items} is recorded as delivered${p.state === "signed" ? ", with a signature," : ""} by the carrier's own scan` +
            (p.hasLink ? ", which the issuer can open with the link on its card." : "."),
        );
      } else if (p.state === "in_transit") {
        shipping.push(`The carrier's tracking record shows the parcel with ${p.items} in transit.`);
      } else {
        shipping.push(`The merchant shipped the parcel with ${p.items}.`);
      }
    }
  }

  const later = byId.get("later_order");
  const conclusion = all
    ? [
        "The carrier recorded delivery of every parcel in the order.",
        later ? `After that delivery, the same customer placed a new order${later.specifics.paidWith ? " with the same payment method" : ""}.` : null,
        "The non-receipt claim is not supported by the record.",
      ]
    : [
        // Scoped to what the record proves: one parcel's delivery does not answer
        // the claim for the others (offline judge, #360980).
        `The carrier recorded delivery of the parcel with ${delivered.map((p) => p.items).join(" and of the parcel with ")}, so the non-receipt claim is not supported for those goods.`,
        ...parcels.filter((p) => p.state !== "delivered" && p.state !== "signed").map((p) =>
          p.state === "in_transit" ? `The carrier's tracking record shows the parcel with ${p.items} in transit.` : `The merchant shipped the parcel with ${p.items}.`,
        ),
      ];

  return {
    evidenceSections: [
      {
        key: "shipping",
        paragraphs: [shipping.join(" ")],
        claimIds: ["order_in_parcels", ...parcels.map((p) => p.id), ...(byId.has("carrier_is_third_party") ? ["carrier_is_third_party"] : [])],
      },
    ],
    conclusion: {
      paragraphs: [conclusion.filter((x): x is string => !!x).join(" ")],
      claimIds: [all ? "all_parcels_delivered" : "some_parcel_delivered", ...(later ? ["later_order"] : [])],
    },
  };
}


/** The code-written text as the summary writer and the reviewer see it. */
export function recordSectionsText(r: RecordSections): string {
  const titles: Record<EvidenceSectionKey, string> = {
    shipping: "Shipping & Delivery",
    lineItems: "Order Line Items",
    chronology: "Chronology of Events",
  };
  return [
    ...r.evidenceSections.map((s) => `${titles[s.key]}: ${s.paragraphs.join(" ")}`),
    `Conclusion: ${r.conclusion.paragraphs.join(" ")}`,
  ].join("\n");
}
