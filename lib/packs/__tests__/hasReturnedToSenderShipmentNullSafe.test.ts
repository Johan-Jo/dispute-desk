/**
 * PR 0: `hasReturnedToSenderShipment` is read from PERSISTED packs as well as
 * freshly gathered ones. It used to throw on a null entry or an entry without
 * `fieldsProvided`; it must answer "nothing returned" instead. Behaviour on
 * well-formed input is unchanged (covered by contradictionGate.test.ts).
 */
import { describe, expect, it } from "vitest";
import { hasReturnedToSenderShipment } from "../contradictionGate";
import type { EvidenceSection } from "../types";

const returned = {
  type: "shipping",
  labelToken: { key: "packs.section.shipping" },
  source: "shopify_fulfillment",
  fieldsProvided: ["shipping_tracking"],
  data: { proofType: "returned_to_sender" },
} as unknown as EvidenceSection;

describe("hasReturnedToSenderShipment: malformed persisted shapes", () => {
  it("still sees a returned-to-sender shipment", () => {
    expect(hasReturnedToSenderShipment([returned])).toBe(true);
  });

  it.each([
    ["null sections", null],
    ["undefined sections", undefined],
    ["a non-array", { not: "an array" }],
    ["an empty list", []],
    ["a null entry", [null]],
    ["an undefined entry", [undefined]],
    ["an entry without fieldsProvided", [{ type: "shipping", data: { proofType: "returned_to_sender" } }]],
    ["an entry whose fieldsProvided is not an array", [{ fieldsProvided: "shipping_tracking", data: { proofType: "returned_to_sender" } }]],
    ["an entry with null data", [{ fieldsProvided: ["shipping_tracking"], data: null }]],
  ])("answers false, never throws, for %s", (_n, input) => {
    expect(() => hasReturnedToSenderShipment(input as never)).not.toThrow();
    expect(hasReturnedToSenderShipment(input as never)).toBe(false);
  });

  it("a malformed entry does not hide a well-formed returned shipment beside it", () => {
    expect(hasReturnedToSenderShipment([null, { type: "x" }, returned] as never)).toBe(true);
  });
});
