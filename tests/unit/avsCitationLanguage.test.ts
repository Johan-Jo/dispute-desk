import { describe, expect, it } from "vitest";

import { classifyAvsCvv } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import { buildInternalSignalsByField } from "@/lib/argument/internalSignals";
import enMessages from "@/messages/en.json";

/**
 * PR-C3 — "matched" and "cited" are different claims, and the merchant copy
 * must not swap one for the other.
 *
 *   avsMatched (`addressVerified`)        — factual. Drives the result
 *                                            sentence and the "partially
 *                                            passed" title.
 *   avsCited   (`citableAddressVerified`) — issuer-facing authority. The ONLY
 *                                            basis for saying a result "was
 *                                            cited".
 *
 * They diverge on every `Y`/`M` outside Visa and on every partial result. The
 * outcome sentence was selected off the factual flag, so a Mastercard `Y`
 * told the merchant "the matching address was cited as evidence in the
 * dispute response" about a result the system deliberately withholds — 20 of
 * 130 prod packs.
 *
 * Both implementations are asserted against the same matrix: the server
 * `buildInternalSignalsByField` and the client `classifyAvsCvv`. They are
 * mirrors by contract, and this is where that contract is enforced.
 */

/** Key-echoing translator: reveals WHICH outcome key the client chose. */
function keyT(key: string): string {
  return key;
}

/** Real-English translator, so prose assertions run on shipped copy. */
function enT(key: string, params?: Record<string, string | number>): string {
  const parts = key.split(".");
  let node: unknown = (enMessages as Record<string, unknown>).disputes;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  let msg = typeof node === "string" ? node : key;
  for (const [k, v] of Object.entries(params ?? {})) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return msg;
}

function serverReason(payload: Record<string, unknown>): { label: string; reason: string } | null {
  const signal = (
    buildInternalSignalsByField(new Map<string, unknown>([["avs_cvv_match", payload]])).get(
      "avs_cvv_match",
    ) ?? []
  ).find((s) => s.id === "internal:avs_cvv_mismatch");
  return signal ? { label: signal.label, reason: signal.reason } : null;
}

function clientKeys(payload: Record<string, unknown>): { title: string; explanation: string } | null {
  const vm = classifyAvsCvv(payload, keyT);
  return vm ? { title: vm.title, explanation: vm.explanation } : null;
}

function clientEn(payload: Record<string, unknown>): { title: string; explanation: string } | null {
  const vm = classifyAvsCvv(payload, enT);
  return vm ? { title: vm.title, explanation: vm.explanation } : null;
}

/** Wording that asserts an issuer-facing citation of the ADDRESS result. */
const ADDRESS_CITED = /matching address was cited/i;

describe("a matched-but-not-citable address never claims it was cited", () => {
  const CASES: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: "Mastercard Y + CVV N", payload: { avsResultCode: "Y", cvvResultCode: "N", cardCompany: "Mastercard" } },
    { label: "Amex Y + CVV N", payload: { avsResultCode: "Y", cvvResultCode: "N", cardCompany: "American Express" } },
    { label: "unknown-network Y + CVV N", payload: { avsResultCode: "Y", cvvResultCode: "N" } },
    { label: "Visa W + CVV N", payload: { avsResultCode: "W", cvvResultCode: "N", cardCompany: "Visa" } },
    { label: "Mastercard M + CVV N", payload: { avsResultCode: "M", cvvResultCode: "N", cardCompany: "Mastercard" } },
  ];

  for (const c of CASES) {
    it(`server: ${c.label} — factual partial-pass title, no address-cited claim`, () => {
      const signal = serverReason(c.payload);
      expect(signal).not.toBeNull();
      // FACTUAL: the address did match, so the title says something passed.
      expect(signal?.label).toBe("Card security check partially passed");
      expect(signal?.reason).toMatch(/address matched/i);
      // AUTHORITY: it was not cited, and the copy must not claim it was.
      expect(signal?.reason).not.toMatch(ADDRESS_CITED);
      // Accurate reason for the withholding — internally useful, no sourced
      // scheme rule. NOT the "would weaken" wording.
      expect(signal?.reason).toMatch(/counts towards your case assessment/i);
      expect(signal?.reason).toMatch(/card scheme's own rules/i);
      expect(signal?.reason).not.toMatch(/would weaken/i);
    });

    it(`client: ${c.label} — same contract`, () => {
      const keys = clientKeys(c.payload);
      expect(keys?.title).toBe("internalSignals.avsCvvMismatch.titlePartial");
      expect(keys?.explanation).toContain(
        "internalSignals.avsCvvMismatch.outcomeAvsMatchedNotCitable",
      );
      expect(keys?.explanation).not.toContain("outcomeOnlyAvsCited");
      expect(keys?.explanation).not.toContain("outcomeAvsCitedClean");

      const en = clientEn(c.payload);
      expect(en?.explanation).not.toMatch(ADDRESS_CITED);
      expect(en?.explanation).not.toMatch(/would weaken/i);
      expect(en?.explanation).toMatch(/counts towards your case assessment/i);
    });
  }

  it("server and client agree on the outcome sentence, verbatim", () => {
    for (const c of CASES) {
      const server = serverReason(c.payload);
      const client = clientEn(c.payload);
      const outcome = enT("internalSignals.avsCvvMismatch.outcomeAvsMatchedNotCitable");
      expect(server?.reason).toContain(outcome);
      expect(client?.explanation).toContain(outcome);
    }
  });
});

describe("a genuinely citable address keeps the cited wording", () => {
  const CASES: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: "Visa Y + CVV N", payload: { avsResultCode: "Y", cvvResultCode: "N", cardCompany: "Visa" } },
    { label: "Visa M + CVV N", payload: { avsResultCode: "M", cvvResultCode: "N", cardCompany: "Visa" } },
  ];

  for (const c of CASES) {
    it(`server: ${c.label}`, () => {
      const signal = serverReason(c.payload);
      expect(signal?.label).toBe("Card security check partially passed");
      expect(signal?.reason).toMatch(ADDRESS_CITED);
      expect(signal?.reason).not.toMatch(/counts towards your case assessment/i);
    });

    it(`client: ${c.label}`, () => {
      expect(clientKeys(c.payload)?.explanation).toContain(
        "internalSignals.avsCvvMismatch.outcomeOnlyAvsCited",
      );
      expect(clientEn(c.payload)?.explanation).toMatch(ADDRESS_CITED);
    });
  }
});

describe("the CVV-only internal notification is unchanged", () => {
  const payload = { avsResultCode: "U", cvvResultCode: "M", cardCompany: "Visa" } as const;

  it("server: U + CVV M keeps the kept-internal message", () => {
    const signal = serverReason(payload);
    expect(signal?.label).toBe("Card security check partially passed");
    expect(signal?.reason).toMatch(/did not check the address/i);
    expect(signal?.reason).toMatch(/kept as an internal record/i);
    expect(signal?.reason).not.toMatch(ADDRESS_CITED);
  });

  it("client: U + CVV M keeps the kept-internal message", () => {
    expect(clientKeys(payload)?.explanation).toContain(
      "internalSignals.avsCvvMismatch.outcomeCvvOnlyNotCited",
    );
    expect(clientEn(payload)?.explanation).toMatch(/kept as an internal record/i);
  });
});

describe("the corrected unmapped-code behaviour is preserved on both sides", () => {
  it("server: an unmapped code alone raises no mismatch signal", () => {
    expect(serverReason({ avsResultCode: "Q" })).toBeNull();
  });

  it("client: an unmapped code alone raises no mismatch signal", () => {
    expect(clientKeys({ avsResultCode: "Q" })).toBeNull();
  });

  it("both: an unmapped code with a real CVV failure reports the CVV, AVS as not checked", () => {
    const payload = { avsResultCode: "Q", cvvResultCode: "N" };
    const server = serverReason(payload);
    expect(server?.reason).toMatch(/security code did not match/i);
    expect(server?.reason).toMatch(/address was not checked/i);
    expect(server?.reason).not.toMatch(ADDRESS_CITED);

    const client = clientEn(payload);
    expect(client?.explanation).toMatch(/security code did not match/i);
    expect(client?.explanation).toMatch(/address was not checked/i);
  });

  it("both: a genuine AVS failure still reads as a failure", () => {
    const payload = { avsResultCode: "N", cvvResultCode: "M", cardCompany: "Visa" };
    expect(serverReason(payload)?.reason).toMatch(/address did not match/i);
    expect(clientEn(payload)?.explanation).toMatch(/address did not match/i);
  });
});
