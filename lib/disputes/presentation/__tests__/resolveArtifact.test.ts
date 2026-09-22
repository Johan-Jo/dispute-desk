/**
 * Acceptance scenarios for dimension 5 (artifact observation).
 * Spec: docs/plans/label-fact-divergence.plan.md §8.
 *
 * Each case names the plan row it discharges. Several are regressions against
 * REAL production rows observed 2026-09-05 / 2026-09-08.
 */
import { describe, expect, it } from "vitest";
import {
  canClaimPrepared,
  resolveArtifact,
  type ObservedPackageRow,
} from "../resolveArtifact";

function row(over: Partial<ObservedPackageRow> = {}): ObservedPackageRow {
  return {
    id: "pkg-1",
    version: 1,
    sourcePackId: "pack-1",
    contentRevision: "rev-1",
    pdfPath: "shop/case/defence/v1/doc.pdf",
    validationStatus: "ok",
    failureCode: null,
    ...over,
  };
}

describe("resolveArtifact", () => {
  it("successful read, no package -> absent (no prepared/PDF claim)", () => {
    const r = resolveArtifact({ readOk: true, rows: [], freshness: "unknown" });
    expect(r.state).toBe("absent");
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("FAILED READ -> unknown, never absent", () => {
    // The central rule. `absent` is a positive claim; a dropped connection
    // must never be able to produce it.
    const r = resolveArtifact({ readOk: false, rows: [], freshness: "unknown" });
    expect(r).toEqual({ state: "unknown", reason: "read_failed" });
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("a failed read is unknown even when rows are supplied", () => {
    const r = resolveArtifact({ readOk: false, rows: [row()], freshness: "fresh" });
    expect(r.state).toBe("unknown");
  });

  it("validation failure with completeness 97 -> absent, score never substitutes", () => {
    // PROD REGRESSION: caffd60d / 8524c706 (Mein Maison, 2026-09-05).
    // pack.status='ready', completeness 97, newest package validation_failed
    // with pdf_path NULL. The UI said "Pack prepared".
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ version: 2, pdfPath: null, validationStatus: "failed", failureCode: "validation_failed" })],
      freshness: "unknown",
    });
    expect(r.state).toBe("absent");
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("present but validation failed -> document exists, NOT prepared", () => {
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ validationStatus: "failed", failureCode: "composed:narrative global" })],
      freshness: "fresh",
    });
    expect(r.state).toBe("present");
    if (r.state !== "present") throw new Error("unreachable");
    expect(r.validation).toBe("failed");
    expect(r.reasonCodes).toEqual(["composed:narrative global"]);
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("present with UNKNOWN validation -> not prepared (no positive claim from unknown)", () => {
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ validationStatus: null })],
      freshness: "fresh",
    });
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("stale document is still present; freshness is a SEPARATE verdict", () => {
    // PROD: v1 of caffd60d is stale with a real PDF. Existence and
    // eligibility are different questions.
    const r = resolveArtifact({ readOk: true, rows: [row()], freshness: "stale" });
    expect(r.state).toBe("present");
    if (r.state !== "present") throw new Error("unreachable");
    expect(r.freshness).toBe("stale");
    // Existence + passing validation licenses "prepared"; the FILING gate
    // still refuses on staleness. resolveArtifact never claims eligibility.
    expect(canClaimPrepared(r)).toBe(true);
  });

  it("ambiguous candidate versions -> unknown, no arbitrary selection", () => {
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ id: "a", version: 3 }), row({ id: "b", version: 3 })],
      freshness: "fresh",
    });
    expect(r).toEqual({ state: "unknown", reason: "ambiguous_identity" });
  });

  it("uninterpretable metadata -> unknown", () => {
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ version: Number.NaN })],
      freshness: "fresh",
    });
    expect(r).toEqual({ state: "unknown", reason: "uninterpretable_metadata" });
  });

  it("empty-string pdf_path is absent, not present", () => {
    const r = resolveArtifact({ readOk: true, rows: [row({ pdfPath: "" })], freshness: "fresh" });
    expect(r.state).toBe("absent");
  });

  it("valid fresh document -> present, prepared, identity pinned", () => {
    const r = resolveArtifact({
      readOk: true,
      rows: [row({ id: "pkg-9", version: 4, contentRevision: "rev-9" })],
      freshness: "fresh",
    });
    expect(r.state).toBe("present");
    if (r.state !== "present") throw new Error("unreachable");
    expect(r.identity).toEqual({
      packageId: "pkg-9",
      version: 4,
      sourcePackId: "pack-1",
      contentRevision: "rev-9",
    });
    expect(canClaimPrepared(r)).toBe(true);
  });

  it("save_failed semantics: pack status cannot license prepared", () => {
    // Plan §3.2 — PACK_PREPARED membership removed as proof. resolveArtifact
    // takes NO pack status input at all, so a `save_failed` (or `ready`) pack
    // with no document resolves absent by construction.
    const r = resolveArtifact({ readOk: true, rows: [row({ pdfPath: null })], freshness: "unknown" });
    expect(r.state).toBe("absent");
    expect(canClaimPrepared(r)).toBe(false);
  });

  it("newest row wins; an older valid PDF does not rescue a failed rebuild", () => {
    // Plan §3.4: never search past the newest candidate for an older
    // passing package.
    const r = resolveArtifact({
      readOk: true,
      rows: [
        row({ id: "v2", version: 2, pdfPath: null, validationStatus: "failed" }),
        row({ id: "v1", version: 1, pdfPath: "old.pdf", validationStatus: "ok" }),
      ],
      freshness: "unknown",
    });
    expect(r.state).toBe("absent");
  });
});

/* ── Rung 4 gating (design-alignment §9) ────────────────────────────────── */
describe("pack_prepared requires a verified document, not a pack status", () => {
  it("canClaimPrepared is the field §9 asked for and never got", () => {
    // §9: "the mere existence of a draft record do[es] not prove a completed,
    // ready package. Do not infer pack_prepared" — the rung was to be SKIPPED
    // until a verified backend state existed. It shipped reading pack status
    // alone, which is how eight prod disputes rendered "Pack prepared" with
    // pdf_path IS NULL, three at completeness 97.
    const noDocument = resolveArtifact({
      readOk: true,
      rows: [row({ pdfPath: null, validationStatus: "failed", failureCode: "validation_failed" })],
      freshness: "unknown",
    });
    expect(canClaimPrepared(noDocument)).toBe(false);

    const declined = resolveArtifact({ readOk: true, rows: [], freshness: "unknown" });
    expect(canClaimPrepared(declined)).toBe(false);

    const real = resolveArtifact({ readOk: true, rows: [row()], freshness: "fresh" });
    expect(canClaimPrepared(real)).toBe(true);
  });

  it("an unread artifact never licenses the claim either", () => {
    // A caller that has not resolved the artifact passes null and keeps the
    // old behaviour; a caller that HAS resolved it and found nothing must not
    // be able to fall back to the pack status.
    const unknown = resolveArtifact({ readOk: false, rows: [], freshness: "unknown" });
    expect(canClaimPrepared(unknown)).toBe(false);
  });
});
