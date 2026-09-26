/**
 * A ledger shaped like #352543 (blume-box, v12 — the letter the maintainer
 * reviewed), with an invented carrier, tracking number and URL.
 */
import type { EvidenceFact } from "../../types";
import type { CheckContext } from "../checks";
import { ITEM_NOT_RECEIVED } from "../playbooks";
import type { LedgerClaim } from "../types";

export const FACTS = [
  {
    id: "f-delivery",
    category: "delivery_proof",
    value: {
      proofType: "delivered_confirmed",
      carrier: "Northwind Post",
      trackingNumber: "NW123456789",
      trackingUrl: "https://track.northwind.example/NW123456789",
      deliveredAt: "2026-07-06T19:53:02Z",
    },
  },
] as unknown as EvidenceFact[];

export const LEDGER: LedgerClaim[] = [
  { id: "claim_is_non_receipt", statement: "The cardholder claims the order was not received.", specifics: {}, weight: "core", sources: [], mustNot: [] },
  {
    id: "carrier_delivered",
    statement: "The carrier recorded the shipment as delivered on 6 July 2026.",
    specifics: { deliveredOn: "6 July 2026", deliveredOnShort: "6 July" },
    weight: "core",
    sources: ["f-delivery"],
    mustNot: [],
  },
  { id: "carrier_is_third_party", statement: "The delivery record is the carrier's own record.", specifics: {}, weight: "core", sources: [], mustNot: [] },
  {
    id: "whole_order_in_shipment",
    statement: "All three purchased items were in that one tracked shipment.",
    specifics: { itemCount: "3", itemCountWord: "three" },
    weight: "core",
    sources: [],
    mustNot: [],
  },
  {
    id: "shipped_promptly",
    statement: "The merchant shipped the order the same day it was placed and paid for.",
    specifics: { shipInterval: "the same day", orderPlacedOn: "2 July", shippedOn: "2 July" },
    weight: "strong",
    sources: [],
    mustNot: [],
  },
  {
    id: "delivery_notice_same_day",
    statement: "On the day the carrier recorded delivery, a delivery notification was sent to the email address on the order.",
    specifics: {},
    weight: "strong",
    sources: [],
    mustNot: [],
  },
  {
    id: "dispute_after_delivery",
    statement: "The dispute was opened on 19 September 2026, after the carrier recorded delivery.",
    specifics: { disputeOpenedOn: "19 September 2026" },
    weight: "strong",
    sources: [],
    mustNot: [],
  },
  {
    id: "later_order",
    statement: "After delivery the same customer placed a further order on 5 September 2026.",
    specifics: {
      laterOrderOn: "5 September 2026",
      laterOrderOnShort: "5 September",
      laterOrderName: "#363341",
      daysAfterDelivery: "61",
      daysAfterDeliveryWord: "sixty-one",
      daysBeforeDispute: "14",
      daysBeforeDisputeWord: "fourteen",
      paidWith: "a card ending in the same four digits, through the same Apple Pay wallet",
    },
    weight: "core",
    sources: [],
    mustNot: [],
  },
];

/** The summary FILED as v12 (production narrative_json, package caa70bf2). */
export const FILED_V12_SUMMARY =
  "The cardholder claims the order was not received. The carrier recorded delivery of the complete order on 6 July 2026, and sixty-one days later " +
  "the same customer placed a new order with the same payment method — fourteen days before opening this dispute. The non-receipt claim is not " +
  "supported by the carrier's delivery record or by the customer's subsequent purchase. The merchant requests that the chargeback be reversed.";

/** A summary in the v12 shape, with the card match spelled out. */
export const V12_SUMMARY =
  "The cardholder says the order was never received. The carrier recorded delivery of the complete order on 6 July 2026. " +
  "Sixty-one days later, the same customer placed a new order — paid with a card ending in the same four digits — and fourteen days after that opened this dispute. " +
  "The non-receipt claim is not supported by the carrier's delivery record or by the customer's later purchase. The merchant requests that the chargeback be reversed.";

export const CHECK: CheckContext = {
  ledger: LEDGER,
  playbook: ITEM_NOT_RECEIVED,
  facts: FACTS,
  disputeOpenedAt: "2026-09-19T02:52:00Z",
  merchantName: "Blume",
  carrierName: "Northwind Post",
  pageIdentifiers: ["#352543", "352543", "NW123456789", "3627", "120.75", "11213897921"],
  trackingUrl: "https://track.northwind.example/NW123456789",
};
