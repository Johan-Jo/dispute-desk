/**
 * Acceptance scenarios for dimension 6 (latest build attempt).
 * Spec: docs/plans/label-fact-divergence.plan.md §3.3 and §8.
 */
import { describe, expect, it } from "vitest";
import {
  isInFlight,
  resolveBuildAttempt,
  suppressesAutomaticRecoveryPromise,
  type ObservedAttemptRow,
} from "../resolveBuildAttempt";

function row(over: Partial<ObservedAttemptRow> = {}): ObservedAttemptRow {
  return {
    id: "pkg-1",
    version: 1,
    status: "final",
    validationStatus: "ok",
    failureCode: null,
    hasValidatedArtifact: true,
    ...over,
  };
}

const base = { readOk: true, jobReadOk: true, activeJob: null } as const;

describe("resolveBuildAttempt", () => {
  it("failed package read -> unknown, never none", () => {
    const a = resolveBuildAttempt({ ...base, readOk: false, rows: [] });
    expect(a.state).toBe("unknown");
    expect(a.cause).toBe("read_failed");
  });

  it("successful empty read -> none", () => {
    expect(resolveBuildAttempt({ ...base, rows: [] }).state).toBe("none");
  });

  it("verified active job outranks a settled row", () => {
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "failed", validationStatus: "failed", hasValidatedArtifact: false })],
      activeJob: { id: "job-9", status: "running" },
    });
    expect(a.state).toBe("running");
    expect(a.identity.jobId).toBe("job-9");
    expect(isInFlight(a)).toBe(true);
  });

  it("a draft row alone does NOT prove a worker is running", () => {
    // Plan §3.3 — incomplete draft, no verified job => unknown, not building.
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "draft", validationStatus: null, hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("unknown");
    expect(a.cause).toBe("incomplete_attempt");
    expect(isInFlight(a)).toBe(false);
  });

  it("a FAILED job read cannot license an in-flight claim", () => {
    const a = resolveBuildAttempt({
      ...base,
      jobReadOk: false,
      rows: [row({ status: "draft", validationStatus: null, hasValidatedArtifact: false })],
      activeJob: { id: "job-1", status: "running" },
    });
    expect(isInFlight(a)).toBe(false);
  });

  it("daily_cap_reached -> capped, tested BEFORE generic failure", () => {
    // PROD REGRESSION: 067b6998 (Mein Maison) is status='failed' with
    // failureCode='daily_cap_reached'. Reporting "build failed" would be wrong.
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "failed", failureCode: "daily_cap_reached", hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("capped");
    expect(a.cause).toBe("daily_cap_reached");
  });

  it("validation_failed -> failed with cause", () => {
    // PROD REGRESSION: caffd60d / 8524c706, composed:narrative global.
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "failed", validationStatus: "failed", failureCode: "validation_failed", hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("failed");
    expect(a.cause).toBe("validation_failed");
    expect(suppressesAutomaticRecoveryPromise(a)).toBe(true);
  });

  it.each(["llm_error", "pdf_render_failed"] as const)("%s -> failed with accurate cause", (code) => {
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "failed", failureCode: code, hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("failed");
    expect(a.cause).toBe(code);
    expect(a.causeRecognised).toBe(true);
  });

  it("skipped + covered_shopify -> not_required, NOT a no-argument claim", () => {
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "skipped", validationStatus: "skipped", failureCode: "covered_shopify", hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("not_required");
    expect(a.cause).toBe("covered_shopify");
  });

  it("skipped + no_bank_eligible_facts -> declined for that snapshot", () => {
    // PROD REGRESSION: b47f312a / fd702c44 / c1b4e60d (Cay Collective).
    // The engine correctly found no bank-eligible argument; the UI called
    // it "Pack prepared, ready".
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "skipped", validationStatus: "skipped", failureCode: "no_bank_eligible_facts", hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("declined");
    expect(a.cause).toBe("no_bank_eligible_facts");
    expect(suppressesAutomaticRecoveryPromise(a)).toBe(true);
  });

  it("covered and declined are NEVER the same state", () => {
    const mk = (code: string) =>
      resolveBuildAttempt({
        ...base,
        rows: [row({ status: "skipped", failureCode: code, hasValidatedArtifact: false })],
      }).state;
    expect(mk("covered_shopify")).not.toBe(mk("no_bank_eligible_facts"));
  });

  it("unrecognised skip cause -> neutral and flagged, no invented reason", () => {
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ status: "skipped", failureCode: "some_future_cause", hasValidatedArtifact: false })],
    });
    expect(a.state).toBe("not_required");
    expect(a.causeRecognised).toBe(false);
    expect(a.cause).toBe("some_future_cause");
  });

  it("completed validated artifact -> succeeded", () => {
    expect(resolveBuildAttempt({ ...base, rows: [row()] }).state).toBe("succeeded");
  });

  it("terminal-looking status without a validated artifact is NOT success", () => {
    const a = resolveBuildAttempt({ ...base, rows: [row({ status: "final", hasValidatedArtifact: false })] });
    expect(a.state).not.toBe("succeeded");
    expect(a.state).toBe("unknown");
  });

  it("ambiguous versions -> unknown, no arbitrary selection", () => {
    const a = resolveBuildAttempt({
      ...base,
      rows: [row({ id: "a", version: 3 }), row({ id: "b", version: 3 })],
    });
    expect(a.state).toBe("unknown");
    expect(a.cause).toBe("ambiguous_identity");
  });

  it("failure states suppress automatic-recovery promises", () => {
    // Plan §4 precedence: a blocker suppresses "we'll reassess automatically".
    for (const s of ["failed", "capped", "declined", "unknown"] as const) {
      expect(suppressesAutomaticRecoveryPromise({ state: s, identity: { packageId: null, version: null, jobId: null }, cause: null, causeRecognised: true })).toBe(true);
    }
    expect(suppressesAutomaticRecoveryPromise({ state: "succeeded", identity: { packageId: null, version: null, jobId: null }, cause: null, causeRecognised: true })).toBe(false);
  });
});
