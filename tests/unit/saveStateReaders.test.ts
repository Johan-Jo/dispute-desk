/**
 * Track S — the other readers of pack status know `saving` and `save_failed`,
 * and a leftover `submission_failed` never hides a merchant task.
 */
import { describe, it, expect, vi } from "vitest";
import { deriveNormalizedStatus } from "@/lib/disputeEvents/normalizeStatus";
import { dueReminderHint, dueReminderStrings } from "@/lib/email/sendDueReminder";
import { packStatusTone } from "@/app/(embedded)/app/disputes/[id]/components/utils";
import { markBankClaimNeeded } from "@/lib/disputes/bankClaim";

describe("deriveNormalizedStatus", () => {
  it("save_failed is action_needed with a save action — not 'no pack yet / generate_pack'", () => {
    const r = deriveNormalizedStatus("needs_response", "save_failed", "not_saved" as never, false);
    expect(r.normalizedStatus).toBe("action_needed");
    expect(r.nextActionType).toBe("save_evidence");
    expect(r.needsAttention).toBe(true);
  });

  it("saving stays in_progress", () => {
    expect(
      deriveNormalizedStatus("needs_response", "saving", "not_saved" as never, false).normalizedStatus,
    ).toBe("in_progress");
  });
});

describe("dueReminderHint", () => {
  it.each(["en", "es", "pt", "fr", "de", "sv"])("%s: save_failed has its own text and needs action", (loc) => {
    const s = dueReminderStrings(loc);
    expect(s.packSaveFailed.length).toBeGreaterThan(10);
    expect(dueReminderHint(s, "save_failed", "auto")).toEqual({ text: s.packSaveFailed, actionNeeded: true });
    expect(s.packSaveFailed).not.toBe(s.packNotStarted);
  });

  it("saving counts as a pack in hand (not 'not started')", () => {
    const s = dueReminderStrings("en");
    expect(dueReminderHint(s, "saving", "auto")).toEqual({ text: s.autoNoAction, actionNeeded: false });
  });
});

describe("packStatusTone", () => {
  it("knows the new statuses", () => {
    expect(packStatusTone("save_failed")).toBe("warning");
    expect(packStatusTone("saving")).toBe("info");
  });
});

describe("markBankClaimNeeded", () => {
  it("is allowed to overwrite a leftover submission_failed (a merchant task outranks it)", async () => {
    let orArg = "";
    const q: Record<string, unknown> = {};
    q.update = () => q;
    q.eq = () => q;
    q.or = (a: string) => {
      orArg = a;
      return q;
    };
    q.select = async () => ({ data: [{ id: "d1" }] });
    const sb = { from: vi.fn(() => q) };
    await markBankClaimNeeded(sb as never, "d1", { trigger: "reopened" as never, cycle: 2 });
    expect(orArg).toContain("attention_reason.is.null");
    expect(orArg).toContain("attention_reason.eq.bank_claim_needed");
    expect(orArg).toContain("attention_reason.eq.submission_failed");
  });
});
