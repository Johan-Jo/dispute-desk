/**
 * The due-date reminder states what happens at the deadline for this dispute —
 * it never asks the merchant to go and check their automation setting
 * (2026-10-02: blume-box, on full automation, was told "what happens then
 * depends on your automation setting").
 */
import { describe, it, expect } from "vitest";
import { dueReminderHint, dueReminderStrings } from "../sendDueReminder";

const LOCALES = ["en", "es", "pt", "fr", "de", "sv"];

describe("dueReminderHint", () => {
  const s = dueReminderStrings("en");

  it("auto mode with a pack in hand: nothing to do", () => {
    for (const status of ["ready", "building", "queued"]) {
      const h = dueReminderHint(s, status, "auto");
      expect(h).toEqual({ text: s.autoNoAction, actionNeeded: false });
    }
    expect(s.autoNoAction).toMatch(/don't need to do anything/);
  });

  it("approved review-mode dispute: nothing to do, filed on the deadline", () => {
    expect(dueReminderHint(s, "ready", "approved")).toEqual({
      text: s.approvedNoAction,
      actionNeeded: false,
    });
  });

  it("awaiting approval: says nothing is filed until approved, whatever the pack state", () => {
    for (const status of ["ready", "building", null, "failed"]) {
      expect(dueReminderHint(s, status, "awaiting_approval")).toEqual({
        text: s.awaitingApproval,
        actionNeeded: true,
      });
    }
  });

  it("no pack in auto mode asks the merchant to build one", () => {
    expect(dueReminderHint(s, null, "auto").text).toBe(s.packNotStarted);
  });

  it("already-saved packs say so regardless of mode", () => {
    expect(dueReminderHint(s, "saved_to_shopify_verified", "awaiting_approval").text).toBe(s.packSaved);
  });

  it("no locale tells the merchant it depends on their setting", () => {
    for (const l of LOCALES) {
      const t = dueReminderStrings(l);
      for (const text of [t.autoNoAction, t.approvedNoAction, t.awaitingApproval]) {
        expect(text).not.toMatch(/depends on|depende|dépend|hängt .* ab|beror på/i);
      }
      expect(t.turnOff({ setting: "X" })).toContain("X");
    }
  });
});
