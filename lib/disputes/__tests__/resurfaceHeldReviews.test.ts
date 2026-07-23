import { describe, expect, it, vi, beforeEach } from "vitest";

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: (input: Record<string, unknown>) => {
    auditCalls.push(input);
    return Promise.resolve();
  },
}));

import { resurfaceHeldReviews } from "../resurfaceHeldReviews";
import { DISPUTE_ATTENTION_REASONS } from "../attentionReasons";

/**
 * Minimal fake of the Supabase query-builder chain used by
 * resurfaceHeldReviews:
 *   sb.from("disputes").select(...).eq(...).not(...).lte(...)  → { data }
 *   sb.from("disputes").update(...).eq(...).eq(...)            → { error }
 * Records every update payload so we can assert on the resurface write.
 */
function makeFakeSb(heldRows: Array<Record<string, unknown>>) {
  const updates: Array<{ payload: Record<string, unknown>; id: unknown }> = [];
  const selectChain = {
    eq() { return this; },
    not() { return this; },
    lte() { return Promise.resolve({ data: heldRows, error: null }); },
  };
  return {
    updates,
    from() {
      return {
        select() { return selectChain; },
        update(payload: Record<string, unknown>) {
          let capturedId: unknown = null;
          const chain = {
            eq(col: string, val: unknown) {
              if (col === "id") capturedId = val;
              // second .eq (review_state guard) resolves the update
              if (col === "review_state") {
                updates.push({ payload, id: capturedId });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  } as const;
}

const NOW = new Date("2026-07-23T12:00:00Z");

beforeEach(() => {
  auditCalls.length = 0;
});

describe("resurfaceHeldReviews", () => {
  it("flips a held dispute near its deadline back to needs_attention", async () => {
    const dueAt = "2026-07-24T12:00:00Z"; // 24h out — inside the 48h window
    const sb = makeFakeSb([
      { id: "d1", shop_id: "s1", review_due_at: dueAt, due_at: dueAt },
    ]);

    const res = await resurfaceHeldReviews(sb as never, NOW);

    expect(res).toEqual({ scanned: 1, resurfaced: 1 });
    expect(sb.updates).toHaveLength(1);
    const { payload } = sb.updates[0];
    expect(payload.needs_attention).toBe(true);
    expect(payload.attention_reason).toBe(
      DISPUTE_ATTENTION_REASONS.REVIEW_DEADLINE_APPROACHING,
    );
    // hold cleared so it rides the shop rule again
    expect(payload.review_state).toBeNull();
    expect(payload.review_due_at).toBeNull();
    expect((payload.attention_payload as { hours_to_deadline: number }).hours_to_deadline).toBe(24);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].eventType).toBe("review_resurfaced_by_reminder");
  });

  it("is a no-op when nothing is held", async () => {
    const sb = makeFakeSb([]);
    const res = await resurfaceHeldReviews(sb as never, NOW);
    expect(res).toEqual({ scanned: 0, resurfaced: 0 });
    expect(sb.updates).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});
