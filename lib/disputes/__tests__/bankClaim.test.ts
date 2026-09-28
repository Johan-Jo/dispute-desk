/**
 * The bank's claim (lib/disputes/bankClaim.ts, plan
 * docs/plans/bank-claim-capture.plan.md): when it is needed, how an answer is
 * read, the filing gate, and the targeted email.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));

import {
  bankClaimTrigger,
  bankClaimBlocksFiling,
  loadBankClaimAnswer,
  type BankClaimDisputeInput,
} from "@/lib/disputes/bankClaim";
import { renderBankClaimNeededEmail } from "@/lib/email/sendBankClaimNeededAlert";
import { buildLlmFactPayload } from "@/lib/defence/narrativeWriter";
import type { NarrativeInput } from "@/lib/defence/types";

const FUTURE = new Date(Date.now() + 5 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

const base: BankClaimDisputeInput = {
  status: "needs_response",
  dueAt: FUTURE,
  closedAt: null,
  finalOutcome: null,
  responseCycle: 1,
  reason: "FRAUDULENT",
  networkReasonCode: "10.4",
};

describe("bankClaimTrigger", () => {
  it("a first-round dispute with a mapped reason does not need it", () => {
    expect(bankClaimTrigger(base)).toBeNull();
  });
  it("a reopened dispute needs it", () => {
    expect(bankClaimTrigger({ ...base, responseCycle: 2 })).toBe("reopened");
  });
  it("GENERAL with no network code needs it; GENERAL with a code does not", () => {
    expect(bankClaimTrigger({ ...base, reason: "GENERAL", networkReasonCode: null })).toBe("general_reason");
    expect(bankClaimTrigger({ ...base, reason: "general", networkReasonCode: "" })).toBe("general_reason");
    expect(bankClaimTrigger({ ...base, reason: "GENERAL", networkReasonCode: "13.1" })).toBeNull();
  });
  it("never for a dispute that is not currently asking for a response", () => {
    const reopened = { ...base, responseCycle: 2 };
    expect(bankClaimTrigger({ ...reopened, status: "under_review" })).toBeNull();
    expect(bankClaimTrigger({ ...reopened, closedAt: PAST })).toBeNull();
    expect(bankClaimTrigger({ ...reopened, finalOutcome: "lost" })).toBeNull();
    expect(bankClaimTrigger({ ...reopened, dueAt: PAST })).toBeNull();
    expect(bankClaimTrigger({ ...reopened, dueAt: null })).toBeNull();
  });
});

function claimClient(row: Record<string, unknown> | null) {
  const eqs: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn((k: string, v: unknown) => {
    eqs.push([k, v]);
    return q;
  });
  q.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  return { sb: { from: vi.fn(() => q) } as never, eqs };
}

describe("loadBankClaimAnswer / bankClaimBlocksFiling", () => {
  it("reads the answer for the CURRENT cycle only", async () => {
    const { sb, eqs } = claimClient({ claim_text: "Buyer says item never arrived", no_claim_shown: false, response_cycle: 2, answered_at: "2026-09-27T10:00:00Z" });
    const a = await loadBankClaimAnswer(sb, "d1", 2);
    expect(a).toMatchObject({ text: "Buyer says item never arrived", noClaimShown: false, cycle: 2, answeredAt: "2026-09-27T10:00:00Z", fileName: null });
    expect(eqs).toContainEqual(["response_cycle", 2]);
  });

  it("an uploaded file is an answer even when no text could be read from it", async () => {
    const { sb } = claimClient({ claim_text: null, no_claim_shown: false, response_cycle: 2, answered_at: "t", file_path: "s/d/bank-claim-c2-1.docx", file_name: "claim.docx", file_size: 1234, text_source: null });
    const a = await loadBankClaimAnswer(sb, "d1", 2);
    expect(a).toMatchObject({ text: null, fileName: "claim.docx", fileSize: 1234 });
    expect(await bankClaimBlocksFiling(sb, "d1", { ...base, responseCycle: 2 })).toBe(false);
  });

  it("'Shopify shows no claim' is a valid answer", async () => {
    const { sb } = claimClient({ claim_text: null, no_claim_shown: true, response_cycle: 1, answered_at: "x" });
    expect((await loadBankClaimAnswer(sb, "d1", 1))?.noClaimShown).toBe(true);
  });

  it("blocks filing while needed and unanswered; clears once answered; ignores disputes that do not need it", async () => {
    const reopened = { ...base, responseCycle: 2 };
    expect(await bankClaimBlocksFiling(claimClient(null).sb, "d1", reopened)).toBe(true);
    expect(
      await bankClaimBlocksFiling(
        claimClient({ claim_text: "x", no_claim_shown: false, response_cycle: 2, answered_at: "t" }).sb,
        "d1",
        reopened,
      ),
    ).toBe(false);
    expect(await bankClaimBlocksFiling(claimClient(null).sb, "d1", base)).toBe(false);
  });
});

describe("the letter writer gets the claim as context, never as a fact", () => {
  const input = {
    packageId: "p",
    disputeId: "d",
    reasonCode: null,
    reasonCodeModule: {
      key: "generic_fallback",
      displayName: "General",
      claimType: "Unmapped chargeback claim",
      prioritize: [],
      avoid: [],
      mustNotClaim: [],
      criticalCategories: [],
      allowedFactCategories: [],
    },
    packageMode: "full",
    caseStrength: "moderate",
    approvedFacts: [],
    manualEvidence: [],
    internalOnlyFactIds: [],
    missingEvidence: [],
  } as unknown as NarrativeInput;

  it("adds bankClaimContext with a do-not-cite directive when a claim exists", () => {
    const payload = buildLlmFactPayload({ ...input, bankClaim: { text: "Customer says the item is counterfeit", noClaimShown: false } });
    const ctx = payload.bankClaimContext as { claim: string; directive: string };
    expect(ctx.claim).toBe("Customer says the item is counterfeit");
    expect(ctx.directive).toMatch(/never cite it/);
    expect(ctx.directive).toMatch(/never quote or paraphrase it back/);
    // Not smuggled in as an approved fact.
    expect(JSON.stringify(payload.approvedFacts)).not.toContain("counterfeit");
  });

  it("adds nothing without a claim, or when Shopify shows none", () => {
    expect(buildLlmFactPayload(input).bankClaimContext).toBeUndefined();
    expect(buildLlmFactPayload({ ...input, bankClaim: { text: null, noClaimShown: true } }).bankClaimContext).toBeUndefined();
  });
});

describe("renderBankClaimNeededEmail", () => {
  const args = {
    trigger: "reopened" as const,
    orderName: "#99142",
    amount: "€38.95",
    dueDate: "Oct 1, 2026",
    disputeUrl: "https://admin.shopify.com/store/x/apps/disputedesk-1?ddredirect=%2Fdisputes%2Fd1%3Fsection%3Dbank-claim",
    shopifyUrl: "https://admin.shopify.com/store/x/orders/1",
  };

  for (const locale of ["en", "es", "pt", "fr", "de", "sv"] as const) {
    it(`${locale}: links to the exact place, names the order, and offers the file upload the card has`, () => {
      const r = renderBankClaimNeededEmail({ ...args, locale });
      expect(r.html).toContain(args.disputeUrl);
      expect(r.html).toContain(args.shopifyUrl);
      expect(r.text).toContain(args.disputeUrl);
      expect(r.subject).toContain("#99142");
      expect(r.html).toContain("Oct 1, 2026");
      expect(r.html).toMatch(/PDF/);
    });
  }

  it("says why for each trigger", () => {
    expect(renderBankClaimNeededEmail({ ...args, locale: "en" }).html).toMatch(/reopened/);
    expect(renderBankClaimNeededEmail({ ...args, locale: "en", trigger: "general_reason" }).html).toMatch(
      /without a specific reason/,
    );
  });

  it("never uses the forbidden 'Shopify automatic response' phrasing or submission claims", () => {
    const r = renderBankClaimNeededEmail({ ...args, locale: "en" });
    expect(r.text).not.toMatch(/automatic response|submit\s+response|card network/i);
  });
});
