/**
 * The address-delivery refusal must NAME the sentence it refused.
 *
 * ── WHY THIS IS THE FIX AND A FOURTH PROMPT VERSION IS NOT ────────────
 *
 * `narrativeWriter` already feeds validation errors back to the model on
 * retry (`retryGuidance`). On this one rule the feedback did nothing, and the
 * reason was the message: it described the RULE ("it may not state which
 * physical address received the parcel") rather than the OFFENCE. A model that
 * wrote "the shipment reached its destination" reads that, correctly observes
 * that it named no address, concludes it complied, and rewrites some other
 * sentence.
 *
 * Measured in production on 2026-08-15: two packages failed on exactly that
 * sentence AFTER a retry, at prompt 15 — the retry spent a generation and
 * changed nothing. That was the same day prompt v15 fixed the
 * summarising-section variant, and prompt v14 the `destination` noun, and
 * prompt v13 the printed examples. Three prompt versions chasing individual
 * phrasings is the signal that the feedback was wrong, not the wording list:
 * a prompt rule can only forbid the phrasings someone thought of, and the
 * model reached this one through an evidentiary gloss ("the record documents
 * that…") that none of them anticipated.
 *
 * Quoting the matched span is correct for phrasings nobody has seen yet, which
 * is the property the prompt rules cannot have.
 */

import { describe, it, expect } from "vitest";
import {
  checkAddressDeliveryAuthorization,
  findAddressDeliveryClaimSentence,
  type ClaimCapability,
} from "@/lib/defence/claimCapabilities";

const NO_CAPABILITIES: ReadonlySet<ClaimCapability> = new Set();

/**
 * The two `fulfillmentArgument` texts that failed at prompt 15, verbatim from
 * production (tracking numbers preserved — they are the shape that matters,
 * and a URL in the prose is exactly the case the URL-blindness handles).
 */
const PRODUCTION_FAILURES = [
  {
    id: "the record establishes that … reached its destination",
    text:
      "The carrier TechSHIP confirmed delivery on 10 July 2026 at 19:28 UTC " +
      "(tracking number 420774699261290416102420709274). The delivery confirmation " +
      "record establishes that the shipment reached its destination as recorded by " +
      "the carrier. Critically, following this confirmed delivery, the cardholder " +
      "has not initiated any return of the goods.",
    expectedSpan: "reached its destination",
  },
  {
    id: "this carrier record documents that … reached its destination",
    text:
      "The carrier TechSHIP confirmed delivery on 10 July 2026 " +
      "(tracking 420605439261290416102420733798). This carrier record documents " +
      "that the shipment reached its destination and was marked delivered.",
    expectedSpan: "reached its destination",
  },
];

describe("the refusal names the offending sentence", () => {
  for (const f of PRODUCTION_FAILURES) {
    it(`"${f.id}" is refused AND quoted`, () => {
      const result = checkAddressDeliveryAuthorization({
        text: f.text,
        capabilities: NO_CAPABILITIES,
      });

      expect(result.authorized).toBe(false);
      if (result.authorized) return; // narrowing

      /* The whole point: not merely refused, but refused with the span. A
       * refusal the model cannot act on is what produced these two rows. */
      expect(result.offendingSentence).not.toBeNull();
      expect(result.offendingSentence).toContain(f.expectedSpan);

      /* And it must be the OFFENDING sentence, not the whole block — the
       * correctly-worded carrier citation is a separate sentence and quoting
       * it back would tell the model to delete permitted evidence. */
      expect(result.offendingSentence).not.toContain("confirmed delivery on 10 July 2026");
    });
  }

  it("returns null when nothing offends, so no false quote is produced", () => {
    /* The permitted form, which must stay permitted. If this ever returns a
     * sentence, the retry would instruct the model to delete its own evidence. */
    const permitted =
      "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890). " +
      "The carrier recorded a signature on delivery.";
    expect(findAddressDeliveryClaimSentence(permitted)).toBeNull();
    expect(
      checkAddressDeliveryAuthorization({ text: permitted, capabilities: NO_CAPABILITIES })
        .authorized,
    ).toBe(true);
  });

  it("still authorizes when the case actually holds the capability", () => {
    /* Guard the guard: the quoting change must not have turned the capability
     * check itself into a refusal. `address_delivery` is underivable today, but
     * the branch exists and must keep working if that ever changes. */
    const held: ReadonlySet<ClaimCapability> = new Set(["address_delivery"]);
    const result = checkAddressDeliveryAuthorization({
      text: PRODUCTION_FAILURES[0].text,
      capabilities: held,
    });
    expect(result.authorized).toBe(true);
  });

  it("finds nothing in empty or whitespace prose", () => {
    expect(findAddressDeliveryClaimSentence("")).toBeNull();
    expect(findAddressDeliveryClaimSentence("   ")).toBeNull();
    expect(findAddressDeliveryClaimSentence(null)).toBeNull();
    expect(findAddressDeliveryClaimSentence(undefined)).toBeNull();
  });
});
