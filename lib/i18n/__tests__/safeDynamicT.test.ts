import { describe, it, expect } from "vitest";
import { safeDynamicT, type DynamicTranslator } from "@/lib/i18n/safeDynamicT";

/** Simulate a next-intl translator scoped to `ns`, backed by `messages`. */
function makeScopedTranslator(
  ns: string,
  messages: Record<string, string>,
): DynamicTranslator {
  const t = ((key: string) =>
    messages[key] ?? `${ns}.${key}`) as DynamicTranslator;
  t.has = (key: string) => key in messages;
  return t;
}

describe("safeDynamicT", () => {
  it("returns the translation when the key exists", () => {
    const t = makeScopedTranslator("disputes.whyText", {
      refund_record: "Proves a refund was issued",
    });
    expect(safeDynamicT(t, "refund_record")).toBe("Proves a refund was issued");
  });

  it("returns the fallback on a miss — never the key path (the #891BECCC leak)", () => {
    const t = makeScopedTranslator("disputes.whyText", {});
    // Pre-fix, the hand-rolled guard compared the miss value against the
    // SCOPED key; next-intl returns the FULL path, so the guard never fired
    // and `disputes.whyText.refund_record` rendered in the UI.
    expect(safeDynamicT(t, "refund_record", "fallback text")).toBe("fallback text");
    expect(safeDynamicT(t, "refund_record")).toBe("");
  });

  it("handles translator-like callables WITHOUT .has (root translator miss)", () => {
    const rootMiss = ((key: string) => key) as DynamicTranslator; // echoes key
    expect(safeDynamicT(rootMiss, "disputeReasons.GENERAL", "General")).toBe("General");
  });

  it("handles scoped-translator miss without .has (namespace-prefixed echo)", () => {
    const scopedMiss = ((key: string) => `packs.${key}`) as DynamicTranslator;
    expect(safeDynamicT(scopedMiss, "disputeTypeLabel.X", "fb")).toBe("fb");
  });

  it("returns the fallback when the translator throws", () => {
    const throwing = (() => {
      throw new Error("boom");
    }) as unknown as DynamicTranslator;
    expect(safeDynamicT(throwing, "any.key", "fb")).toBe("fb");
  });
});
