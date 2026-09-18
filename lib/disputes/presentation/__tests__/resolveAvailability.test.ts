/**
 * Acceptance scenarios for dimensions 7–9.
 * Spec: docs/plans/label-fact-divergence.plan.md §3.5 and §8.
 */
import { describe, expect, it } from "vitest";
import {
  mayPromiseAutomaticWork,
  mayRenderIntegrationGuidance,
  mayRenderLiveIntegrationCard,
  resolveAutomationPromise,
  resolveDeadlineFacts,
  resolveDelayCause,
  resolveIntegrationAvailability,
} from "../resolveAvailability";

describe("automation promise", () => {
  it("auto-build OFF -> will_not_run, no recovery promise", () => {
    // PROD REGRESSION: Mein Maison rendered "reassesses automatically —
    // nothing is needed from you" while auto_build_enabled was false and
    // every pipeline run exited at skipped_auto_build_off.
    const p = resolveAutomationPromise({ readOk: true, autoBuildEnabled: false, blockers: [] });
    expect(p.kind).toBe("will_not_run");
    expect(mayPromiseAutomaticWork(p)).toBe(false);
  });

  it("failed settings read -> unknown, promises nothing", () => {
    const p = resolveAutomationPromise({ readOk: false, autoBuildEnabled: null, blockers: [] });
    expect(p.kind).toBe("unknown");
    expect(mayPromiseAutomaticWork(p)).toBe(false);
  });

  it("null setting -> unknown even when the read succeeded", () => {
    expect(resolveAutomationPromise({ readOk: true, autoBuildEnabled: null, blockers: [] }).kind).toBe("unknown");
  });

  it("enabled but blocked -> will_not_run, blockers preserved", () => {
    const p = resolveAutomationPromise({ readOk: true, autoBuildEnabled: true, blockers: ["quota_exceeded"] });
    expect(p.kind).toBe("will_not_run");
    if (p.kind !== "will_not_run") throw new Error("unreachable");
    expect(p.blockers).toEqual(["quota_exceeded"]);
    expect(mayPromiseAutomaticWork(p)).toBe(false);
  });

  it("enabled and unblocked -> may_run (never 'scheduled')", () => {
    const p = resolveAutomationPromise({ readOk: true, autoBuildEnabled: true, blockers: [] });
    expect(p.kind).toBe("may_run");
    expect(mayPromiseAutomaticWork(p)).toBe(true);
  });
});

describe("integration availability", () => {
  it("no integrations row -> never_connected, no live card", () => {
    // PROD: only one shop has Gorgias connected; the card rendered anyway.
    const a = resolveIntegrationAvailability({ readOk: true, status: null, hasHistoricalEvidence: false });
    expect(a).toBe("never_connected");
    expect(mayRenderLiveIntegrationCard(a)).toBe(false);
    expect(mayRenderIntegrationGuidance(a)).toBe(false);
  });

  it("failed read -> unknown, not never_connected", () => {
    expect(resolveIntegrationAvailability({ readOk: false, status: null, hasHistoricalEvidence: false })).toBe("unknown");
  });

  it("connected -> live card renders", () => {
    const a = resolveIntegrationAvailability({ readOk: true, status: "connected", hasHistoricalEvidence: false });
    expect(mayRenderLiveIntegrationCard(a)).toBe(true);
  });

  it.each(["reconnect_required", "invalid_credentials"])("%s -> guidance, no live card", (status) => {
    const a = resolveIntegrationAvailability({ readOk: true, status, hasHistoricalEvidence: false });
    expect(a).toBe("reconnect_required");
    expect(mayRenderLiveIntegrationCard(a)).toBe(false);
    expect(mayRenderIntegrationGuidance(a)).toBe(true);
  });

  it("disconnected WITH history keeps its guidance rather than hiding everything", () => {
    const a = resolveIntegrationAvailability({ readOk: true, status: "disconnected", hasHistoricalEvidence: true });
    expect(a).toBe("disconnected_with_history");
    expect(mayRenderIntegrationGuidance(a)).toBe(true);
  });

  it("history with no row is contradictory -> unknown, not an invented story", () => {
    expect(resolveIntegrationAvailability({ readOk: true, status: null, hasHistoricalEvidence: true })).toBe("unknown");
  });
});

describe("processing delay cause", () => {
  const T = 30_000;

  it("below threshold -> unknown (nothing to explain yet)", () => {
    expect(resolveDelayCause({ queueReadOk: true, otherActiveJobCount: 5, elapsedMs: 1_000, thresholdMs: T })).toBe("unknown");
  });

  it("no other active jobs -> elapsed_only, NEVER a backlog claim", () => {
    // PROD REGRESSION: blume-box had zero other queued/running jobs while
    // the copy said "waiting behind other work".
    expect(resolveDelayCause({ queueReadOk: true, otherActiveJobCount: 0, elapsedMs: 120_000, thresholdMs: T })).toBe("elapsed_only");
  });

  it("failed queue read -> elapsed_only, not a guessed cause", () => {
    expect(resolveDelayCause({ queueReadOk: false, otherActiveJobCount: null, elapsedMs: 120_000, thresholdMs: T })).toBe("elapsed_only");
  });

  it("observed backlog -> queue_backlog", () => {
    expect(resolveDelayCause({ queueReadOk: true, otherActiveJobCount: 7, elapsedMs: 120_000, thresholdMs: T })).toBe("queue_backlog");
  });
});

describe("deadline facts", () => {
  it("date and countdown derive from the SAME instant", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    const f = resolveDeadlineFacts("2026-09-09T03:00:00Z", now);
    expect(f.passed).toBe(false);
    expect(f.msRemaining).toBe(15 * 3600 * 1000);
    expect(f.dueAtIso).toBe("2026-09-09T03:00:00Z");
  });

  it("a deadline just past reads as passed", () => {
    const f = resolveDeadlineFacts("2026-09-09T03:00:00Z", new Date("2026-09-09T03:00:01Z"));
    expect(f.passed).toBe(true);
    expect(f.msRemaining).toBeLessThan(0);
  });

  it("crossing a local day boundary does not change the instant", () => {
    // 03:00 UTC is the previous evening in Pacific. Both views must agree
    // on `passed` because both derive from one comparison.
    const now = new Date("2026-09-08T23:30:00Z");
    expect(resolveDeadlineFacts("2026-09-09T03:00:00Z", now).passed).toBe(false);
  });

  it("null or unparseable due date -> all facts null", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(resolveDeadlineFacts(null, now).passed).toBeNull();
    expect(resolveDeadlineFacts("not-a-date", now).msRemaining).toBeNull();
  });
});
