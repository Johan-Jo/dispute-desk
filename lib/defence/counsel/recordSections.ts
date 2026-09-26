/**
 * The parts of a counsel letter that code writes (cost refactor §3.1, §3.3).
 *
 * The Shipping pair, the carrier-record sentence, the chronology note and the
 * conclusion follow directly from ledger claims, so they are rendered here
 * instead of generated. The wording is the maintainer-reviewed v12 letter for
 * #352543. The model writes only the executive summary (generate.ts).
 *
 * The theory of the case is picked by code too: the playbook lists theories
 * in order of force, and the first one whose claims are all in the ledger is
 * the theory.
 */

import type { CounselSection, EvidenceSectionKey, LedgerClaim, Playbook } from "./types";

export interface Theory {
  name: string;
  shape: string;
}

/** Used when no playbook theory has all its claims (e.g. delivery + dispute date only). */
const DEFAULT_THEORY: Theory = {
  name: "carrier_delivered",
  shape: "The carrier recorded delivery of the order the cardholder says never arrived. Lead with the carrier's delivery against the claim.",
};

export function pickTheory(ledger: readonly LedgerClaim[], playbook: Playbook): Theory {
  const ids = new Set(ledger.map((c) => c.id));
  const t = playbook.theories.find((x) => x.requiresClaims.every((id) => ids.has(id)));
  return t ? { name: t.name, shape: t.shape } : DEFAULT_THEORY;
}

export interface RecordSections {
  evidenceSections: Array<CounselSection & { key: EvidenceSectionKey }>;
  conclusion: CounselSection;
}

export function buildRecordSections(ledger: readonly LedgerClaim[]): RecordSections {
  const byId = new Map(ledger.map((c) => [c.id, c]));
  const has = (id: string) => byId.has(id);

  // Shipping & Delivery: the record is the carrier's own; the whole order in
  // one parcel. The delivery date is on the card above, so it is not restated.
  const shipping: string[] = [];
  const shippingIds: string[] = ["carrier_delivered"];
  if (has("carrier_is_third_party")) {
    shipping.push(
      "The delivery shown on the card above is the carrier's own scan, published on its public tracking page; the issuer can verify it with the link below.",
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
        : `All ${whole.specifics.itemCountWord} items listed under Order Line Items were in this single tracked shipment.`,
      "There was no partial or second shipment.",
    );
    shippingIds.push("whole_order_in_shipment");
  }

  // Chronology: only what the summary does not carry. The timeline shows the
  // later order and the chargeback; the summary gives their intervals.
  const promptly = byId.get("shipped_promptly");
  const shipPart = promptly
    ? promptly.specifics.shipDays
      ? `The order shipped ${promptly.specifics.shipInterval.replace(/ after the order$/, "")} after it was placed`
      : "The order shipped the same day it was placed"
    : null;
  const noticePart = has("delivery_notice_same_day")
    ? "a delivery notification went to the email address on the order the day the carrier recorded delivery"
    : null;
  const chronologyText =
    shipPart && noticePart
      ? `${shipPart}, and ${noticePart}.`
      : shipPart
        ? `${shipPart}.`
        : noticePart
          ? `${noticePart[0].toUpperCase()}${noticePart.slice(1)}.`
          : null;
  const chronologyIds = [promptly && "shipped_promptly", noticePart && "delivery_notice_same_day"].filter(
    (x): x is string => !!x,
  );

  // Conclusion: the strongest facts restated without dates or numbers, then
  // the one-line answer. The fixed request line follows it on the page.
  const later = byId.get("later_order");
  const conclusion = [
    `The carrier recorded delivery of the ${whole ? "entire " : ""}order${has("signed_for") ? ", with a signature" : ""}.`,
    later ? `After that delivery, the same customer bought again${later.specifics.paidWith ? " with the same payment method" : ""}.` : null,
    "The non-receipt claim is not supported by the record.",
  ].filter((x): x is string => !!x);

  const evidenceSections: RecordSections["evidenceSections"] = [
    { key: "shipping", paragraphs: [shipping.join(" ")], claimIds: shippingIds },
  ];
  if (chronologyText) evidenceSections.push({ key: "chronology", paragraphs: [chronologyText], claimIds: chronologyIds });

  return {
    evidenceSections,
    conclusion: {
      paragraphs: [conclusion.join(" ")],
      claimIds: ["carrier_delivered", ...(whole ? ["whole_order_in_shipment"] : []), ...(later ? ["later_order"] : [])],
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
