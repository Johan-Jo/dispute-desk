/**
 * Monitor assertion contract — plan §7 and §8.
 * Divergence (we lied) is kept distinct from stranded (we told the truth and
 * the case is still stuck).
 */
import { describe, expect, it } from "vitest";
import { assertProjection, findingKey, type CaseProjection } from "../claimAssertions";
import { mayPromiseAutomaticWork } from "../resolveAvailability";
import { suppressesAutomaticRecoveryPromise } from "../resolveBuildAttempt";
import type { ArtifactObservation } from "../resolveArtifact";
import type { BuildAttempt } from "../resolveBuildAttempt";

const attempt = (state: BuildAttempt["state"]): BuildAttempt => ({
  state,
  identity: { packageId: null, version: null, jobId: null },
  cause: null,
  causeRecognised: true,
});

const present: ArtifactObservation = {
  state: "present",
  identity: { packageId: "p", version: 3, sourcePackId: null, contentRevision: "rev-3" },
  freshness: "fresh",
  validation: "passed",
  reasonCodes: [],
};

function proj(over: Partial<CaseProjection> = {}): CaseProjection {
  return {
    disputeId: "d1",
    artifact: present,
    attempt: attempt("succeeded"),
    automation: { kind: "may_run" },
    claimsPrepared: false,
    claimsAutomaticRecovery: false,
    deadlinePassed: false,
    hasPriorTransmittedResponse: false,
    ...over,
  };
}

describe("claim assertions — divergence", () => {
  it("a defensible projection produces no findings", () => {
    expect(assertProjection(proj({ claimsPrepared: true }))).toEqual([]);
  });

  it("prepared claim with no document is a divergence", () => {
    // PROD: the eight-case cohort — status 'ready', pdf_path null.
    const f = assertProjection(proj({ artifact: { state: "absent" }, claimsPrepared: true }));
    expect(f.map((x) => x.code)).toContain("prepared_without_document");
    expect(f[0].kind).toBe("divergence");
  });

  it("prepared claim on a FAILED READ is reported separately", () => {
    // Distinguished from a data defect: this is infrastructure, and
    // conflating them would send someone hunting the wrong bug.
    const f = assertProjection(
      proj({ artifact: { state: "unknown", reason: "read_failed" }, claimsPrepared: true }),
    );
    expect(f.map((x) => x.code)).toContain("claim_on_unknown_read");
  });

  it("prepared claim with a document that FAILED validation is a divergence", () => {
    const f = assertProjection(
      proj({ artifact: { ...present, validation: "failed" }, claimsPrepared: true }),
    );
    expect(f.map((x) => x.code)).toContain("prepared_without_document");
  });

  it("automatic-recovery promise with auto-build off is a divergence", () => {
    // PROD: Mein Maison's "nothing is needed from you".
    const f = assertProjection(
      proj({ automation: { kind: "will_not_run", blockers: ["auto_build_off"] }, claimsAutomaticRecovery: true }),
    );
    expect(f.map((x) => x.code)).toContain("recovery_promised_without_automation");
  });

  it("automatic-recovery promise over a failed attempt is a divergence", () => {
    const f = assertProjection(proj({ attempt: attempt("failed"), claimsAutomaticRecovery: true }));
    expect(f.map((x) => x.code)).toContain("recovery_promised_over_blocker");
  });

  it("making no claim is never a divergence, whatever the facts", () => {
    expect(
      assertProjection(proj({ artifact: { state: "absent" }, attempt: attempt("failed") })).filter(
        (x) => x.kind === "divergence",
      ),
    ).toEqual([]);
  });
});

describe("claim assertions — stranded", () => {
  it("open deadline with a failed build and no automation is STRANDED, not divergence", () => {
    // The distinction §7 requires: once labels are honest, this case is
    // still unfileable — an operational failure, not a lying label.
    const f = assertProjection(
      proj({
        artifact: { state: "absent" },
        attempt: attempt("failed"),
        automation: { kind: "will_not_run", blockers: ["auto_build_off"] },
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("stranded");
    expect(f[0].code).toBe("open_deadline_no_viable_response");
  });

  it("a prior transmitted response means the case is not stranded", () => {
    // The six blume-box cases: v4 filed, v5 build failed. Nothing is lost.
    const f = assertProjection(
      proj({
        artifact: { state: "absent" },
        attempt: attempt("failed"),
        automation: { kind: "will_not_run", blockers: [] },
        hasPriorTransmittedResponse: true,
      }),
    );
    expect(f).toEqual([]);
  });

  it("a passed deadline is not reported as stranded", () => {
    const f = assertProjection(
      proj({
        artifact: { state: "absent" },
        attempt: attempt("failed"),
        automation: { kind: "will_not_run", blockers: [] },
        deadlinePassed: true,
      }),
    );
    expect(f).toEqual([]);
  });

  it("automation that may still run means not yet stranded", () => {
    const f = assertProjection(
      proj({ artifact: { state: "absent" }, attempt: attempt("failed"), automation: { kind: "may_run" } }),
    );
    expect(f).toEqual([]);
  });

  it("a declined case is not stranded — the engine answered", () => {
    // no_bank_eligible_facts is a correct refusal, not a stuck case.
    const f = assertProjection(
      proj({
        artifact: { state: "absent" },
        attempt: attempt("declined"),
        automation: { kind: "will_not_run", blockers: [] },
      }),
    );
    expect(f).toEqual([]);
  });
});

describe("dedupe key", () => {
  it("keys by case, assertion and artifact revision", () => {
    const f = { kind: "divergence" as const, code: "prepared_without_document", detail: "" };
    expect(findingKey("d1", f, "rev-3")).toBe("d1|prepared_without_document|rev-3");
    expect(findingKey("d1", f, null)).toBe("d1|prepared_without_document|no-rev");
    expect(findingKey("d1", f, "rev-4")).not.toBe(findingKey("d1", f, "rev-3"));
  });
});

/* ── The monitor must READ the projection, not assume it ─────────────────
 *
 * PROD REGRESSION, 2026-09-09 12:00 UTC. The first monitor run emailed four
 * `recovery_promised_over_blocker` findings — c1b4e60d, fd702c44, b47f312a
 * (all no_bank_eligible_facts) and 067b6998 (daily_cap_reached).
 *
 * All four were false. The monitor set `claimsAutomaticRecovery` from
 * `mayPromiseAutomaticWork(automation)` — a shop-level flag with no per-case
 * knowledge — and `assertProjection` then flagged it for promising recovery
 * over a blocker. The monitor asserted the claim and reported itself.
 *
 * Left alone it would fire on every declined or capped case every hour,
 * training the reader to ignore the alert.
 */
describe("a declined or capped case does not promise recovery", () => {
  it.each(["declined", "capped", "failed"] as const)(
    "%s: the derived claim is false, so no divergence is reported",
    (state) => {
      const claims =
        mayPromiseAutomaticWork({ kind: "may_run" }) &&
        !suppressesAutomaticRecoveryPromise(attempt(state));
      expect(claims).toBe(false);

      const findings = assertProjection(
        proj({ attempt: attempt(state), claimsAutomaticRecovery: claims }),
      );
      expect(findings.filter((f) => f.code === "recovery_promised_over_blocker")).toEqual([]);
    },
  );

  it("a healthy case still promises recovery, so the check keeps its teeth", () => {
    const claims =
      mayPromiseAutomaticWork({ kind: "may_run" }) &&
      !suppressesAutomaticRecoveryPromise(attempt("succeeded"));
    expect(claims).toBe(true);
  });

  it("auto-build off still suppresses the promise regardless of attempt", () => {
    const claims =
      mayPromiseAutomaticWork({ kind: "will_not_run", blockers: ["auto_build_off"] }) &&
      !suppressesAutomaticRecoveryPromise(attempt("succeeded"));
    expect(claims).toBe(false);
  });
});
