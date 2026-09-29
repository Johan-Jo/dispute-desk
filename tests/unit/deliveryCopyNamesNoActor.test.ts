/**
 * Delivery-line copy states the carrier's record, never who received the
 * parcel or that anyone's identity was checked (non-receipt plan §6.3, D6).
 *
 * The strings this closes: "Collected by customer at pickup point" and
 * "Collected at the pickup point {date} — ID required at collection". The
 * second was PostNord's general pickup policy presented as a fact about this
 * parcel; a collection status does not identify who collected it. The bank
 * side is already guarded by the item-not-received validator (P0 (c)); this
 * pins the merchant side, in every locale, for every `deliveryProof` string —
 * the class, not the two keys.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The actor nouns themselves, not just "by the customer": "awaiting customer
 * collection" names who is expected to collect just as surely. */
const ACTOR_OR_IDENTITY: Record<string, RegExp> = {
  en: /\b(?:customers?|cardholders?|recipients?|buyers?)\b|\bID required\b|\bidentit(?:y|ies)\b|\bidentification\b/i,
  de: /\b(?:Kunde|Kunden|Empfänger|Käufer)\b|Karteninhaber|Ausweis|Identität/i,
  es: /\b(?:cliente|titular|destinatario|comprador)\b|identificación|identidad/i,
  fr: /\b(?:client|titulaire|destinataire)\b|pièce d'identité|identité/i,
  pt: /\b(?:cliente|titular|destinatário|comprador)\b|identificação|identidade/i,
  sv: /\b(?:kund|kunden|kortinnehavare\w*|mottagare\w*)\b|legitimation|identitet/i,
};

function strings(o: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof o === "string") out.push([path, o]);
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) strings(v, `${path}.${k}`, out);
  }
}

describe("deliveryProof copy names no actor and no identity check", () => {
  for (const [locale, pattern] of Object.entries(ACTOR_OR_IDENTITY)) {
    it(locale, () => {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
      ) as { disputes: { deliveryProof: unknown } };
      const all: Array<[string, string]> = [];
      strings(messages.disputes.deliveryProof, "disputes.deliveryProof", all);
      expect(all.length).toBeGreaterThan(10);
      /* Returned-to-sender copy says the parcel came BACK ("the customer never
       * took delivery"). That is not a receipt or identity claim, and the
       * gate that owns it (`returnedToSender.ts`) is a different subject. */
      const offenders = all.filter(
        ([key, s]) => !/ReturnedToSender/.test(key) && pattern.test(s),
      );
      expect(offenders).toEqual([]);
    });
  }
});
