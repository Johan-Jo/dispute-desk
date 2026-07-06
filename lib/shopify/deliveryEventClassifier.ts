/**
 * Delivery-status classification from native Shopify FulfillmentEvent
 * message text.
 *
 * WHY THIS EXISTS (2026-07-06, cay-collective / PostNord):
 * Carrier integrations that sync PostNord (and other EU carriers) into
 * Shopify's native `Fulfillment.events` stream do NOT reliably use the
 * `FulfillmentEventStatus` enum. On a real cay-collective order the parcel
 * was delivered — event message "Försändelsen har levererats." — yet:
 *   - `fulfillment.deliveredAt` was null
 *   - `fulfillment.displayStatus` was NOT_DELIVERED
 *   - the event `status` was FAILURE (a stale label from an earlier
 *     return-to-sender, never reset)
 * The ONLY trustworthy delivery signal was the free-text `message`.
 *
 * So we classify delivery from the MESSAGE TEXT, not the status enum, and
 * we walk the whole event timeline (a parcel can be returned-to-sender and
 * then re-delivered) taking the LATEST delivery-relevant event as the
 * fulfillment's true final state.
 *
 * Categories (deliberately distinct — the distinctions are chargeback-
 * critical; "delivered to a pickup point" is NOT "customer received it",
 * and "returned to sender" must never read as delivered):
 *   - "delivered"          → handed to the recipient / final delivery
 *   - "delivered_to_pickup"→ arrived at / collected at a service point,
 *                            parcel locker, ombud, point relais, etc.
 *   - "returned"           → returned to sender (NOT delivered)
 *   - "failed"             → delivery attempt failed / could not deliver
 *   - "other"              → in transit, label, notification, etc.
 *
 * Matching is substring/root based and case-insensitive, tuned to the
 * confirmed PostNord Swedish strings plus the common delivery roots across
 * the 6 active locales (en/sv/de/es/fr/pt) and the Nordic languages
 * PostNord/Bring cover (no/da). Accuracy is prioritized over recall: a
 * miss just leaves delivery unconfirmed (safe); a false "delivered" on a
 * returned parcel would poison chargeback evidence (unsafe). RETURNED and
 * PICKUP are therefore checked BEFORE plain DELIVERED so a compound phrase
 * ("levererats till ett serviceställe", "returned to sender") is never
 * misread as final delivery.
 */

export type DeliveryEventCategory =
  | "delivered"
  | "delivered_to_pickup"
  | "returned"
  | "failed"
  | "other";

export interface DeliveryEventLike {
  status: string | null;
  happenedAt: string | null;
  message: string | null;
}

export interface DeliveryTimelineResult {
  /** Final classification = the latest (by happenedAt) event that is
   *  delivered / delivered_to_pickup / returned. "other"/"failed"-only
   *  timelines resolve to null (undelivered). */
  finalCategory: "delivered" | "delivered_to_pickup" | "returned" | null;
  /** happenedAt of the event that set `finalCategory`. */
  finalAt: string | null;
}

/** Roots that indicate RETURN TO SENDER. Checked first — a returned
 *  parcel's message often still contains a "delivered"/"levererats" verb
 *  elsewhere in the timeline, so the return must win when it is the later
 *  event. Roots are lowercased substrings.
 *
 *  Multilingual roots confirmed via carrier-docs research 2026-07-06
 *  (PostNord, DHL, DPD, GLS, UPS, FedEx, PostNL, Colissimo). */
const RETURNED_ROOTS = [
  // EN
  "returned to sender",
  "return to sender",
  "returned to shipper",
  "return to origin",
  // SV / NO / DA
  "returnerats till avsändaren",
  "returnerad",
  "returneres",
  "retur til avsender",
  "til avsender",
  // DE
  "zurückgesendet",
  "rücksendung",
  "an den absender",
  "zum absender",
  "zum versender",
  "retourniert",
  "weg zum absender",
  // ES
  "devuelto al remitente",
  "devuelto",
  // FR
  "retour à l'expéditeur",
  "retour a l'expediteur",
  "retourné à l'expéditeur",
  "renvoyé à l'expéditeur",
  // NL
  "retour afzender",
  "teruggestuurd",
  // PT
  "devolvido ao remetente",
  "devolvido",
  // Bring machine enum — DELIVERED_SENDER means RETURNED to sender, NOT
  // delivered. Must be caught here before the DELIVERED root test.
  "delivered_sender",
];

/** Roots for delivery to a NEIGHBOUR / left in a safe place. Confirmed
 *  across DHL / GLS: the message says "delivered / zugestellt" but to a
 *  neighbour or a safe drop — NOT into the cardholder's own hands. For a
 *  chargeback "customer received it" test this must NOT count as final
 *  delivery, so we bucket it with pickup (delivered_to_pickup) — a real,
 *  weaker signal, never a strong into-hands "Delivered". Checked before
 *  DELIVERED for the same reason as PICKUP. */
const NEIGHBOUR_SAFE_ROOTS = [
  "neighbour",
  "neighbor",
  "beim nachbarn",
  "nachbarn",
  "nachbar",
  "au voisin",
  "voisin",
  "bij de buren",
  "safe place",
  "left safe",
  "al vecino",
];

/** Roots that indicate arrival at / collection from a PICKUP POINT
 *  (service point, parcel locker, ombud, relais, carrier access point).
 *  NOT final delivery to the customer's own address. Checked before plain
 *  DELIVERED because PostNord's phrase is literally "levererats till ett
 *  serviceställe" AND UPS's is literally "Delivered to a UPS Access Point"
 *  — both contain a delivered-root but are pickup, not final delivery.
 *  (Confirmed traps, UPS/FedEx research 2026-07-06.) */
const PICKUP_ROOTS = [
  // PostNord / Nordic
  "serviceställe",
  "servicepoint",
  "service point",
  "utlämningsställe",
  "utlamningsstalle",
  "ombud",
  "hentested",
  "utleveringssted",
  "klar til å hentes",
  "klar til henting",
  "klar til afhentning",
  "afhentningssted",
  "udleveringssted",
  "pakkeshop",
  "post i butikk",
  // GLS ParcelShop / PaketShop (delivered-worded but at a shop)
  "paketshop",
  "parcelshop",
  "parcel shop",
  "deposited at",
  // NL PostNL points
  "postnl-punt",
  "postnl punt",
  "afhaalpunt",
  "pakketpunt",
  // PT CTT / BR Correios pickup
  "ponto de recolha",
  "ponto ctt",
  "em loja",
  "cacifo",
  "locky",
  "disponível para levantamento",
  "disponivel para levantamento",
  "disponível para retirada",
  "aguardando retirada",
  // ES pickup / office
  "a disposición del destinatario",
  "en delegación",
  "en oficina",
  "punto de acceso",
  "depositado en",
  // UPS / FedEx carrier pickup points (the "Delivered to a UPS Access
  // Point" trap + FedEx hold-at-location)
  "access point",
  "hold at location",
  "held at location",
  "held for pickup",
  "held for you",
  "awaiting customer pickup",
  "at a local fedex facility",
  "at local fedex facility",
  "ready for pickup",
  "ready to be picked up",
  "available for pickup",
  "available for collection",
  "pickup available",
  // Generic
  "pickup point",
  "pick-up point",
  "collection point",
  "parcel locker",
  "paketbox",
  "paketautomat",
  "abholstation",
  "packstation",
  "paketstation",
  "zur abholung bereit",
  "aufbewahr",
  "filiale",
  "point relais",
  "point de retrait",
  "prêt à être récupéré",
  "retenu à un",
  "punto de recogida",
  "recoger",
  "retenido",
  "ponto de recolha",
];

/** Roots that indicate FINAL DELIVERY to the recipient. Checked last, and
 *  only after RETURNED/PICKUP have been ruled out for that event. */
const DELIVERED_ROOTS = [
  "delivered",
  "levererats",
  "levererad",
  "levert",
  "leveret",
  "zugestellt",
  "geliefert",
  "entregado",
  "entregada",
  "livré",
  "livree",
  "livrée",
  "entregue",
];

/** Roots that indicate a FAILED / undeliverable attempt (not a return). */
const FAILED_ROOTS = [
  "could not be delivered",
  "delivery failed",
  "gick inte att leverera",
  "kunde inte levereras",
  "zustellung nicht möglich",
  "nicht zustellbar",
  "no se pudo entregar",
  "échec de livraison",
  "n'a pas pu être livré",
  "não foi possível entregar",
];

function containsAny(haystack: string, roots: string[]): boolean {
  for (const r of roots) {
    if (haystack.includes(r)) return true;
  }
  return false;
}

/** Classify a single event's message text into a delivery category.
 *  Order of checks matters: RETURNED and PICKUP win over DELIVERED so a
 *  compound message is never misread as final delivery. The status enum
 *  is intentionally ignored for delivery (it is unreliable — a stale
 *  FAILURE persists across re-delivery); it is used only as a weak
 *  fallback signal for an explicit DELIVERED enum with no message. */
export function classifyDeliveryEvent(
  event: DeliveryEventLike,
): DeliveryEventCategory {
  const msg = (event.message ?? "").toLowerCase();
  if (msg) {
    if (containsAny(msg, RETURNED_ROOTS)) return "returned";
    // Pickup point AND neighbour/safe-place both bucket as
    // "delivered_to_pickup": the parcel left the carrier's control but did
    // NOT reach the cardholder's own hands. Both must win over a bare
    // DELIVERED root ("delivered at the neighbour's", "im PaketShop
    // zugestellt", "Delivered to a UPS Access Point").
    if (containsAny(msg, PICKUP_ROOTS)) return "delivered_to_pickup";
    if (containsAny(msg, NEIGHBOUR_SAFE_ROOTS)) return "delivered_to_pickup";
    if (containsAny(msg, DELIVERED_ROOTS)) return "delivered";
    if (containsAny(msg, FAILED_ROOTS)) return "failed";
  }
  // Fallback: trust an explicit DELIVERED enum only when there is no
  // message to classify (some carriers set the enum and leave message
  // null). We never trust FAILURE to mean "not delivered" — see file
  // header — so FAILURE falls through to "other".
  if (!msg && (event.status ?? "").toUpperCase() === "DELIVERED") {
    return "delivered";
  }
  return "other";
}

/** Walk a fulfillment's event timeline and return the FINAL delivery
 *  state — the latest (by happenedAt) event classified as delivered /
 *  delivered_to_pickup / returned. This correctly handles a parcel that
 *  was returned-to-sender and then re-shipped and delivered: the last
 *  delivery-relevant event wins. Events with null happenedAt are treated
 *  as oldest (they can't reorder a dated later event). */
export function classifyDeliveryTimeline(
  events: DeliveryEventLike[] | null | undefined,
): DeliveryTimelineResult {
  let finalCategory: DeliveryTimelineResult["finalCategory"] = null;
  let finalAt: string | null = null;
  for (const e of events ?? []) {
    const cat = classifyDeliveryEvent(e);
    if (cat !== "delivered" && cat !== "delivered_to_pickup" && cat !== "returned") {
      continue;
    }
    const at = e.happenedAt ?? "";
    // Later event (by ISO timestamp) wins. A dated event always beats an
    // undated one; among undated, last-seen wins (stable order preserved).
    const currentAt = finalAt ?? "";
    if (finalCategory === null || at >= currentAt) {
      finalCategory = cat;
      finalAt = e.happenedAt ?? null;
    }
  }
  return { finalCategory, finalAt };
}
