/**
 * Tests for `lib/email/billingLifecycle.ts`.
 *
 * Each function follows the same shape — claim an idempotency slot,
 * resolve team email, send via Resend, log audit. We exercise:
 *
 *   1. Each function fires once and skips the second call (claim
 *      step is what differs across functions; the audit + send path
 *      is shared).
 *   2. Missing team_email skips with reason "no_team_email".
 *   3. notifications.billing === false skips with reason "opted_out".
 *   4. The cycle-renewed function dedups on the cycle_end timestamp
 *      so the same cycle never fires twice but the next cycle does.
 *
 * Resend is mocked so we never make a real HTTP call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "msg-1" }, error: null }),
    },
  })),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import {
  sendTrialStartedEmail,
  sendFirstPaidCycleEmail,
  sendCycleRenewedEmail,
  sendGraceEnteredEmail,
  sendSubscriptionExpiredEmail,
  sendCancellationEmail,
  sendTopupPurchasedEmail,
} from "../billingLifecycle";

const mockGetClient = vi.mocked(getServiceClient);
const MockedResend = vi.mocked(Resend);

const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "test_key";
});

afterEach(() => {
  process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY;
});

import { afterEach } from "vitest";

interface ClaimResult {
  claimedRow: Record<string, unknown> | null;
}

interface SbConfig {
  /** Per-function claim outcome — controls whether the conditional
   *  UPDATE returns a row (claim succeeds) or null (already sent). */
  claim?: ClaimResult;
  /** Existing entitlement row read by the grace/expired/cancelled
   *  email paths to source the stamp timestamp. */
  entitlement?: Record<string, unknown> | null;
  /** Pre-existing audit row of event_type 'billing_email_sent' for
   *  the per-event dedupe lookup used by grace/expired/cancelled/topup. */
  priorAuditRow?: { id: string } | null;
  /** Team-email setup row. */
  setupSteps?: Record<string, { payload?: Record<string, unknown> }> | null;
  /** Shop domain row. */
  shopDomain?: string;
  /** Captured side effects. */
  capture: { auditInserts: Array<Record<string, unknown>> };
}

function buildSb(cfg: SbConfig) {
  const teamPayload = (cfg.setupSteps ?? {
    team: { payload: { teamEmail: "team@example.com" } },
  });

  return {
    from: vi.fn((table: string) => {
      if (table === "plan_entitlements") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: cfg.claim?.claimedRow ?? null,
                    error: null,
                  }),
                }),
              }),
              or: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: cfg.claim?.claimedRow ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: cfg.entitlement ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "shop_setup") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { steps: teamPayload },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { shop_domain: cfg.shopDomain ?? "demo.myshopify.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "audit_events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                filter: vi.fn().mockReturnValue({
                  filter: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: cfg.priorAuditRow ?? null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation(async (row) => {
            cfg.capture.auditInserts.push(row);
            return { data: null, error: null };
          }),
        };
      }
      return {} as never;
    }),
  };
}

function getResendSend(): ReturnType<typeof vi.fn> {
  const inst = MockedResend.mock.results[0]?.value as
    | { emails: { send: ReturnType<typeof vi.fn> } }
    | undefined;
  return inst?.emails?.send ?? vi.fn();
}

/* ── 1. Trial started ──────────────────────────────────────── */

describe("sendTrialStartedEmail", () => {
  it("sends when claim succeeds + team email set", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth", trial_ends_at: "2026-06-15T00:00:00Z" } },
        capture,
      }) as never,
    );

    const out = await sendTrialStartedEmail("shop-1");
    expect("sent" in out && out.sent).toBe(true);
    expect(capture.auditInserts).toHaveLength(1);
  });

  it("skips when claim returns null (already sent)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({ claim: { claimedRow: null }, capture }) as never,
    );
    const out = await sendTrialStartedEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });

  it("skips when team email is missing", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth", trial_ends_at: null } },
        setupSteps: { team: { payload: { teamEmail: "" } } },
        capture,
      }) as never,
    );
    const out = await sendTrialStartedEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("no_team_email");
  });

  it("skips when merchant opted out of billing emails", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth", trial_ends_at: null } },
        setupSteps: {
          team: {
            payload: {
              teamEmail: "team@example.com",
              notifications: { billing: false },
            },
          },
        },
        capture,
      }) as never,
    );
    const out = await sendTrialStartedEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("opted_out");
  });
});

/* ── 2. First paid cycle ───────────────────────────────────── */

describe("sendFirstPaidCycleEmail", () => {
  it("sends when claim succeeds", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth" } },
        capture,
      }) as never,
    );
    const out = await sendFirstPaidCycleEmail("shop-1", "2026-07-01T00:00:00Z");
    expect("sent" in out && out.sent).toBe(true);
  });

  it("dedupes (claim returns null on second call)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({ claim: { claimedRow: null }, capture }) as never,
    );
    const out = await sendFirstPaidCycleEmail("shop-1", "2026-07-01T00:00:00Z");
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });
});

/* ── 3. Cycle renewed ──────────────────────────────────────── */

describe("sendCycleRenewedEmail", () => {
  it("sends when prior cycle_end < new cycle_end (claim succeeds)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth" } },
        capture,
      }) as never,
    );
    const out = await sendCycleRenewedEmail({
      shopId: "shop-1",
      cycleEndIso: "2026-08-01T00:00:00Z",
      packsGranted: 75,
    });
    expect("sent" in out && out.sent).toBe(true);
  });

  it("skips when claim returns null (same cycle already emailed)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({ claim: { claimedRow: null }, capture }) as never,
    );
    const out = await sendCycleRenewedEmail({
      shopId: "shop-1",
      cycleEndIso: "2026-08-01T00:00:00Z",
      packsGranted: 75,
    });
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });
});

/* ── 4. Grace ──────────────────────────────────────────────── */

describe("sendGraceEnteredEmail", () => {
  it("sends when grace_entered_at is set + no prior audit", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { grace_entered_at: "2026-06-01T00:00:00Z" },
        priorAuditRow: null,
        capture,
      }) as never,
    );
    const out = await sendGraceEnteredEmail("shop-1");
    expect("sent" in out && out.sent).toBe(true);
  });

  it("skips when grace_entered_at is null (not in grace)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { grace_entered_at: null },
        capture,
      }) as never,
    );
    const out = await sendGraceEnteredEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });

  it("skips when prior audit row exists for the same grace event", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { grace_entered_at: "2026-06-01T00:00:00Z" },
        priorAuditRow: { id: "audit-1" },
        capture,
      }) as never,
    );
    const out = await sendGraceEnteredEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });
});

/* ── 5. Subscription expired ───────────────────────────────── */

describe("sendSubscriptionExpiredEmail", () => {
  it("sends when subscription_expired_at is set + no prior audit", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { subscription_expired_at: "2026-06-04T00:00:00Z" },
        priorAuditRow: null,
        capture,
      }) as never,
    );
    const out = await sendSubscriptionExpiredEmail("shop-1");
    expect("sent" in out && out.sent).toBe(true);
  });

  it("dedupes when prior audit exists for the same expiry", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { subscription_expired_at: "2026-06-04T00:00:00Z" },
        priorAuditRow: { id: "audit-1" },
        capture,
      }) as never,
    );
    const out = await sendSubscriptionExpiredEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });
});

/* ── 6. Cancelled ──────────────────────────────────────────── */

describe("sendCancellationEmail", () => {
  it("sends when cancelled_at is set + no prior audit", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { cancelled_at: "2026-06-04T00:00:00Z" },
        priorAuditRow: null,
        capture,
      }) as never,
    );
    const out = await sendCancellationEmail("shop-1");
    expect("sent" in out && out.sent).toBe(true);
  });
});

/* ── 7. Top-up purchased ───────────────────────────────────── */

describe("sendTopupPurchasedEmail", () => {
  it("sends per ledger reference (idempotent by reference)", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: {},
        priorAuditRow: null,
        capture,
      }) as never,
    );
    const out = await sendTopupPurchasedEmail({
      shopId: "shop-1",
      packs: 50,
      expiresAt: "2026-07-15T00:00:00Z",
      reference: "topup_topup_50_xyz",
    });
    expect("sent" in out && out.sent).toBe(true);
  });

  it("skips when an audit row for this reference already exists", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        priorAuditRow: { id: "audit-existing" },
        capture,
      }) as never,
    );
    const out = await sendTopupPurchasedEmail({
      shopId: "shop-1",
      packs: 50,
      expiresAt: "2026-07-15T00:00:00Z",
      reference: "topup_topup_50_xyz",
    });
    expect("skipped" in out && out.skipped).toBe("already_sent");
  });
});

/* ── Cross-cutting: RESEND_API_KEY absence ─────────────────── */

describe("RESEND_API_KEY absence", () => {
  it("returns skipped:email_disabled when the env var is unset", async () => {
    const capture = { auditInserts: [] as Array<Record<string, unknown>> };
    mockGetClient.mockReturnValue(
      buildSb({
        claim: { claimedRow: { plan_key: "growth", trial_ends_at: null } },
        capture,
      }) as never,
    );
    process.env.RESEND_API_KEY = "";
    const out = await sendTrialStartedEmail("shop-1");
    expect("skipped" in out && out.skipped).toBe("email_disabled");
    process.env.RESEND_API_KEY = "test_key";
  });
});
