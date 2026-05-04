import { afterEach, describe, expect, it } from "vitest";
import { isFileEvidenceAttachmentsEnabled } from "../featureFlags";

const ORIGINAL = process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED;
  else process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED = ORIGINAL;
});

describe("isFileEvidenceAttachmentsEnabled", () => {
  it("defaults to false when env var is unset", () => {
    delete process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED;
    expect(isFileEvidenceAttachmentsEnabled()).toBe(false);
  });

  it("returns true only for the literal string 'true'", () => {
    process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED = "true";
    expect(isFileEvidenceAttachmentsEnabled()).toBe(true);
  });

  it("returns false for falsy or ambiguous values (defensive: only 'true' counts)", () => {
    for (const v of ["false", "1", "0", "yes", "TRUE", "True", " true ", ""]) {
      process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED = v;
      expect(isFileEvidenceAttachmentsEnabled(), v).toBe(false);
    }
  });
});
