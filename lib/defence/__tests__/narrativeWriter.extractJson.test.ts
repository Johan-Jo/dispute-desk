import { describe, it, expect } from "vitest";
import { extractJsonObject } from "../narrativeWriter";

describe("extractJsonObject — the model's JSON even when it writes a preamble", () => {
  it("parses a bare JSON reply", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("finds the JSON after an analysis preamble (blume-box #360980, 2026-09-24)", () => {
    const raw =
      "I need to carefully analyze the approved facts before writing.\n\n**Facts analysis:**\n\n1. GOFO shipment — delivered.\n\n" +
      '{"executiveSummary":{"text":"x","usedFactIds":["f1"]}}';
    expect(extractJsonObject(raw)).toEqual({ executiveSummary: { text: "x", usedFactIds: ["f1"] } });
  });

  it("reads a fenced block", () => {
    expect(extractJsonObject('Here it is:\n```json\n{"a":{"b":2}}\n```\nDone.')).toEqual({ a: { b: 2 } });
  });

  it("returns null when there is no JSON object", () => {
    expect(extractJsonObject("I cannot write this letter.")).toBeNull();
    expect(extractJsonObject("[1,2]")).toBeNull();
    expect(extractJsonObject('{"a": ')).toBeNull();
  });
});
