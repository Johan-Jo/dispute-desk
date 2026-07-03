import { describe, it, expect } from "vitest";
import {
  isSpuriousDueDateEvent,
  isObsoletePackBlockedEvent,
  isHiddenActivityEvent,
} from "@/lib/disputeEvents/spuriousDueDate";

describe("isSpuriousDueDateEvent", () => {
  it("keeps non-due-date events", () => {
    expect(isSpuriousDueDateEvent({ event_type: "status_changed" })).toBe(false);
    expect(isSpuriousDueDateEvent({ event_type: "submission_confirmed" })).toBe(false);
  });

  it("hides an epoch-target due_date_changed (the 1969-12-31 flood)", () => {
    expect(
      isSpuriousDueDateEvent({
        event_type: "due_date_changed",
        metadata_json: { old_due_at: null, new_due_at: "1969-12-31T00:00:00.000Z" },
      }),
    ).toBe(true);
    expect(
      isSpuriousDueDateEvent({
        event_type: "due_date_changed",
        metadata_json: { old_due_at: null, new_due_at: "1970-01-01T00:00:00Z" },
      }),
    ).toBe(true);
  });

  it("hides a same-instant (timezone-only) change", () => {
    expect(
      isSpuriousDueDateEvent({
        event_type: "due_date_changed",
        metadata_json: {
          old_due_at: "2026-05-26T23:00:00Z",
          new_due_at: "2026-05-27T01:00:00+02:00", // same instant
        },
      }),
    ).toBe(true);
  });

  it("keeps a real due-date change", () => {
    expect(
      isSpuriousDueDateEvent({
        event_type: "due_date_changed",
        metadata_json: {
          old_due_at: "2026-05-26T23:00:00Z",
          new_due_at: "2026-06-02T23:00:00Z",
        },
      }),
    ).toBe(false);
  });

  it("keeps a due_date_changed with no metadata (can't prove spurious)", () => {
    expect(isSpuriousDueDateEvent({ event_type: "due_date_changed" })).toBe(false);
    expect(
      isSpuriousDueDateEvent({ event_type: "due_date_changed", metadata_json: null }),
    ).toBe(false);
  });
});

describe("isObsoletePackBlockedEvent", () => {
  it("hides the obsolete tier-gate pack_blocked (reason: feature_blocked)", () => {
    expect(
      isObsoletePackBlockedEvent({
        event_type: "pack_blocked",
        metadata_json: { reason: "feature_blocked" },
      }),
    ).toBe(true);
  });

  it("keeps legitimate pack_blocked (quota_exceeded / auto_build_off)", () => {
    expect(
      isObsoletePackBlockedEvent({
        event_type: "pack_blocked",
        metadata_json: { reason: "quota_exceeded" },
      }),
    ).toBe(false);
    expect(
      isObsoletePackBlockedEvent({
        event_type: "pack_blocked",
        metadata_json: { reason: "auto_build_off" },
      }),
    ).toBe(false);
  });

  it("keeps non-pack_blocked events", () => {
    expect(isObsoletePackBlockedEvent({ event_type: "status_changed" })).toBe(false);
  });
});

describe("isHiddenActivityEvent (combined)", () => {
  it("hides both spurious due-date and obsolete pack_blocked", () => {
    expect(
      isHiddenActivityEvent({
        event_type: "due_date_changed",
        metadata_json: { old_due_at: null, new_due_at: "1969-12-31T00:00:00Z" },
      }),
    ).toBe(true);
    expect(
      isHiddenActivityEvent({
        event_type: "pack_blocked",
        metadata_json: { reason: "feature_blocked" },
      }),
    ).toBe(true);
  });

  it("keeps everything else", () => {
    expect(isHiddenActivityEvent({ event_type: "pack_created" })).toBe(false);
  });
});
