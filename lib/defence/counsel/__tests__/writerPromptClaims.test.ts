/**
 * The writer is offered only the claims this case's ledger holds.
 *
 * Mein Maison #100017 (prod, 2026-09-30): the not-as-described brief lists
 * `merchant_confirmed_no_request` under the shipping section, but that claim
 * is in the ledger only after the merchant confirms no return request came in.
 * The prompt listed it anyway, the writer cited it, and the checker failed the
 * letter on `shipping: unknown claim "merchant_confirmed_no_request"`.
 */
import { describe, expect, it } from "vitest";
import { writerUserPrompt } from "../constitution";
import { disputeFrame } from "../frame";
import { sectionApplies, ITEM_NOT_RECEIVED_BRIEF, NOT_AS_DESCRIBED_BRIEF, GENERAL_BRIEF, type Brief } from "../briefs";
import type { LedgerClaim } from "../types";

const claim = (id: string): LedgerClaim => ({ id, statement: `${id}.`, specifics: {}, weight: "strong", sources: [], mustNot: [] });

function promptFor(brief: Brief, ids: string[]): string {
  const ledger = ids.map(claim);
  const inLedger = new Set(ids);
  return writerUserPrompt({
    brief,
    frame: disputeFrame({ paymentFamily: "paypal", phase: "inquiry" }),
    theory: { name: "t", shape: "", claims: [] },
    ledger,
    pageContext: "",
    merchantName: "M",
    argued: brief.sections.filter((s) => !s.exhibitOnly && sectionApplies(s, inLedger)),
    exhibitOnly: brief.sections.filter((s) => s.exhibitOnly && sectionApplies(s, inLedger)),
  });
}

/** The claim ids printed on the SECTIONS TO ARGUE lines. */
function sectionClaimIds(prompt: string): string[] {
  const block = prompt.split("SECTIONS TO ARGUE")[1]?.split("\n\n")[0] ?? "";
  return block
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .flatMap((l) => (l.split(" — ").pop() ?? "").split(",").map((x) => x.trim()).filter(Boolean));
}

describe("writer prompt: section claims come from the ledger", () => {
  const base = ["claim_is_not_as_described", "carrier_delivered", "dispute_after_delivery", "no_return_recorded"];

  it("does not offer merchant_confirmed_no_request when the merchant has not confirmed (#100017)", () => {
    const ids = sectionClaimIds(promptFor(NOT_AS_DESCRIBED_BRIEF, base));
    expect(ids).toContain("carrier_delivered");
    expect(ids).not.toContain("merchant_confirmed_no_request");
  });

  it("offers it once the merchant has confirmed", () => {
    const ids = sectionClaimIds(promptFor(NOT_AS_DESCRIBED_BRIEF, [...base, "merchant_confirmed_no_request"]));
    expect(ids).toContain("merchant_confirmed_no_request");
  });

  it("never lists a claim outside the ledger, for any brief", () => {
    for (const brief of [NOT_AS_DESCRIBED_BRIEF, ITEM_NOT_RECEIVED_BRIEF, GENERAL_BRIEF]) {
      // One claim from each section: every section applies, most of its list is absent.
      const ids = [...new Set([...brief.minimumClaims, ...brief.sections.map((s) => s.requiresClaimId ?? s.claimIds[0])])];
      for (const id of sectionClaimIds(promptFor(brief, ids))) expect(ids).toContain(id);
    }
  });
});
