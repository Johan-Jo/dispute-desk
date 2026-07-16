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
 *   - "delivered"          → handed to the recipient at their address
 *   - "collected_at_pickup"→ the CUSTOMER collected the parcel at a
 *                            service point / ombud (in SE/Nordics this
 *                            requires photo ID or BankID — confirmed
 *                            customer receipt, STRONG for INR, but never
 *                            an "delivered to their address" claim)
 *   - "delivered_to_pickup"→ arrived at a service point, parcel locker,
 *                            ombud, point relais — awaiting collection.
 *                            The customer may never collect it (real
 *                            case: two return-to-sender cycles).
 *   - "returned"           → returned to sender (NOT delivered)
 *   - "failed"             → delivery attempt failed / could not deliver
 *   - "other"              → in transit, label, notification, etc.
 *
 * Collection is detected two ways:
 *   1. EXPLICIT phrasing ("Picked up by receiver", "uthämtad av
 *      mottagaren") — COLLECTED_ROOTS, per event.
 *   2. CONTEXT (PostNord emits a bare "Försändelsen har levererats." when
 *      the customer collects at an ombud): a final "delivered" event that
 *      follows a "delivered_to_pickup" arrival with NO new out-for-
 *      delivery attempt and NO return between them is a collection, not a
 *      doorstep delivery — applied by classifyDeliveryTimeline.
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
  | "collected_at_pickup"
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
   *  delivered / collected_at_pickup / delivered_to_pickup / returned.
   *  "other"/"failed"-only timelines resolve to null (undelivered). */
  finalCategory:
    | "delivered"
    | "collected_at_pickup"
    | "delivered_to_pickup"
    | "returned"
    | null;
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

/** Roots that indicate the CUSTOMER COLLECTED the parcel at a pickup
 *  point — confirmed customer receipt (SE/Nordic servicepoints require
 *  photo ID / BankID at the counter). Distinct from PICKUP_ROOTS (arrival
 *  at the point, collection still pending) and from DELIVERED (doorstep).
 *  Confirmed live 2026-07-16 on the DHL Freight #12809 acceptance
 *  shipment: terminal event "Picked up by receiver", statusCode
 *  "delivered", product "DHL Servicepoint Domestic". Checked before
 *  PICKUP and DELIVERED. */
const COLLECTED_ROOTS = [
  // en
  "picked up by receiver",
  "picked up by recipient",
  "picked up by the receiver",
  "picked up by the recipient",
  "collected by receiver",
  "collected by recipient",
  "collected by the receiver",
  "collected by the recipient",
  // sv
  "uthämtad av mottagaren",
  "uthämtat av mottagaren",
  "hämtats av mottagaren",
  "hämtat av mottagaren",
  // no
  "hentet av mottaker",
  "hentet av mottakeren",
  // da
  "afhentet af modtager",
  "afhentet af modtageren",
  // de
  "vom empfänger abgeholt",
  "vom empfaenger abgeholt",
  "durch empfänger abgeholt",
  "empfänger hat die sendung abgeholt",
  // nl
  "opgehaald door de ontvanger",
  "afgehaald door de ontvanger",
  "door ontvanger opgehaald",
  // fr
  "retiré par le destinataire",
  "retire par le destinataire",
  "récupéré par le destinataire",
  "recupere par le destinataire",
  // es
  "recogido por el destinatario",
  "retirado por el destinatario",
  // pt
  "levantado pelo destinatário",
  "levantado pelo destinatario",
  "retirado pelo destinatário",
  "retirado pelo destinatario",
];

/** Roots that indicate the parcel is OUT FOR (home) DELIVERY. Used only
 *  by the timeline context rule: a bare "delivered" that follows a
 *  pickup-point arrival is a COLLECTION unless a new out-for-delivery
 *  attempt happened in between (i.e. the carrier redirected the parcel
 *  back onto a van for a doorstep delivery). */
const OUT_FOR_DELIVERY_ROOTS = [
  // en
  "out for delivery",
  // sv (PostNord: "Lastad på bil, utkörning påbörjad.")
  "utkörning",
  "utkorning",
  "lastad på bil",
  "lastad pa bil",
  "ut för leverans",
  // no / da
  "på vei til deg",
  "ute til levering",
  "under udbringning",
  "til levering",
  // de
  "in zustellung",
  "zustellung heute",
  "zustellfahrzeug",
  // nl
  "in bezorging",
  "wordt bezorgd",
  // fr
  "en cours de livraison",
  "en cours d'acheminement pour livraison",
  // es
  "en reparto",
  "salida a reparto",
  // pt
  "saiu para entrega",
  "em distribuição",
  "em distribuicao",
];

/** Roots that indicate FINAL DELIVERY to the recipient. Checked last, and
 *  only after RETURNED/COLLECTED/PICKUP have been ruled out for that event. */
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
    // Explicit customer collection ("Picked up by receiver", "uthämtad av
    // mottagaren") — confirmed receipt, checked before PICKUP so the
    // arrival wording never masks the collection.
    if (containsAny(msg, COLLECTED_ROOTS)) return "collected_at_pickup";
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
  // READY_FOR_PICKUP enum → the parcel is at a pickup point awaiting
  // collection. Trusted even with an unmatched message: PostNord's
  // collection-notification event reads "Avisering skickad via APP. -
  // Sista hämtningsdag: …" (no pickup root) with status
  // READY_FOR_PICKUP — and Shopify's synced stream may LACK the
  // serviceställe-arrival event entirely (real case: cay order #12121,
  // 2026-07-16), so this marker is what lets the timeline context rule
  // recognize the final bare "levererats" as a customer COLLECTION.
  // Safe direction: worst case a stale enum yields the weaker
  // "awaiting collection" state, never a delivery claim.
  if ((event.status ?? "").toUpperCase() === "READY_FOR_PICKUP") {
    return "delivered_to_pickup";
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
  const classified = (events ?? []).map((e) => ({
    cat: classifyDeliveryEvent(e),
    at: e.happenedAt ?? null,
    msg: (e.message ?? "").toLowerCase(),
  }));

  let finalCategory: DeliveryTimelineResult["finalCategory"] = null;
  let finalAt: string | null = null;
  for (const e of classified) {
    if (
      e.cat !== "delivered" &&
      e.cat !== "collected_at_pickup" &&
      e.cat !== "delivered_to_pickup" &&
      e.cat !== "returned"
    ) {
      continue;
    }
    const at = e.at ?? "";
    // Later event (by ISO timestamp) wins. A dated event always beats an
    // undated one; among undated, last-seen wins (stable order preserved).
    const currentAt = finalAt ?? "";
    if (finalCategory === null || at >= currentAt) {
      finalCategory = e.cat;
      finalAt = e.at;
    }
  }

  // CONTEXT RULE (collection at a pickup point): PostNord et al. emit a
  // bare "levererats"/"delivered" when the CUSTOMER collects at the
  // service point. If the final "delivered" event follows a pickup-point
  // arrival and the parcel was never sent back out for a doorstep attempt
  // (no out-for-delivery marker, no return) between the two, the delivery
  // is a collection — confirmed customer receipt, but NOT delivery to
  // their address. Applied only to dated events (undated events cannot be
  // ordered, so we stay conservative and leave "delivered" as-is).
  if (finalCategory === "delivered" && finalAt) {
    const pickupBefore = classified
      .filter((e) => e.cat === "delivered_to_pickup" && e.at && e.at < finalAt!)
      .sort((a, b) => (a.at! < b.at! ? 1 : -1))[0];
    if (pickupBefore) {
      const intervening = classified.some(
        (e) =>
          e.at &&
          e.at > pickupBefore.at! &&
          e.at < finalAt! &&
          (e.cat === "returned" || containsAny(e.msg, OUT_FOR_DELIVERY_ROOTS)),
      );
      if (!intervening) finalCategory = "collected_at_pickup";
    }
  }

  return { finalCategory, finalAt };
}
