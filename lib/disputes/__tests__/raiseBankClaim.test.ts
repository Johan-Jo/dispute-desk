/**
 * raiseBankClaimIfNeeded — the merchant email is behind
 * BANK_CLAIM_EMAILS_ENABLED (off by default); the task is raised regardless.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/disputes/dispatchOnce", () => ({
  withEffectDedup: vi.fn(async (a: { effect: () => Promise<unknown> }) => ({ ran: true, result: await a.effect() })),
}));
vi.mock("@/lib/email/sendBankClaimNeededAlert", () => ({
  sendBankClaimNeededAlert: vi.fn(async () => ({ sent: true })),
}));

import { raiseBankClaimIfNeeded } from "@/lib/disputes/raiseBankClaim";
import { withEffectDedup } from "@/lib/disputes/dispatchOnce";
import { sendBankClaimNeededAlert } from "@/lib/email/sendBankClaimNeededAlert";

const FUTURE = new Date(Date.now() + 3 * 86400_000).toISOString();

function client() {
  const updates: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.or = vi.fn(() => q);
    if (table === "disputes") {
      q.maybeSingle = vi.fn(async () => ({
        data: { status: "needs_response", due_at: FUTURE, closed_at: null, final_outcome: null, response_cycle: 2, reason: "GENERAL", network_reason_code: null },
        error: null,
      }));
      q.update = vi.fn((row: Record<string, unknown>) => {
        updates.push(row);
        const u: Record<string, unknown> = {};
        u.eq = vi.fn(() => u);
        u.or = vi.fn(() => u);
        u.select = vi.fn(async () => ({ data: [{ id: "d1" }], error: null }));
        return u;
      });
    }
    if (table === "dispute_bank_claims") q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    return q;
  });
  return { sb: { from } as never, updates };
}

describe("raiseBankClaimIfNeeded", () => {
  const prev = process.env.BANK_CLAIM_EMAILS_ENABLED;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    if (prev === undefined) delete process.env.BANK_CLAIM_EMAILS_ENABLED;
    else process.env.BANK_CLAIM_EMAILS_ENABLED = prev;
  });

  it("switch off (default): raises the task, sends no email, burns no dedupe claim", async () => {
    delete process.env.BANK_CLAIM_EMAILS_ENABLED;
    const { sb, updates } = client();
    const r = await raiseBankClaimIfNeeded({ shopId: "s1", disputeId: "d1", client: sb });
    expect(r).toMatchObject({ needed: true, trigger: "reopened", marked: true, emailed: false });
    expect(updates[0]).toMatchObject({ attention_reason: "bank_claim_needed", needs_attention: true });
    expect(withEffectDedup).not.toHaveBeenCalled();
    expect(sendBankClaimNeededAlert).not.toHaveBeenCalled();
  });

  it("switch on: emails once through the per-cycle dedupe key", async () => {
    process.env.BANK_CLAIM_EMAILS_ENABLED = "true";
    const { sb } = client();
    const r = await raiseBankClaimIfNeeded({ shopId: "s1", disputeId: "d1", client: sb });
    expect(r.emailed).toBe(true);
    expect(vi.mocked(withEffectDedup).mock.calls[0]![0]).toMatchObject({ eventKey: "d1:BANK_CLAIM_NEEDED:c2" });
  });

  it("switch on but backfill/historical: no email", async () => {
    process.env.BANK_CLAIM_EMAILS_ENABLED = "true";
    const { sb } = client();
    await raiseBankClaimIfNeeded({ shopId: "s1", disputeId: "d1", client: sb, suppressEmail: true });
    expect(sendBankClaimNeededAlert).not.toHaveBeenCalled();
  });
});
