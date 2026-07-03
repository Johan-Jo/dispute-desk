import { describe, it, expect } from "vitest";
import { sanitizeDueAt, hasMeaningfulDueAt } from "@/lib/disputes/dueDate";

describe("sanitizeDueAt", () => {
  it("passes through a real modern due date", () => {
    expect(sanitizeDueAt("2026-06-20T23:00:00+00:00")).toBe("2026-06-20T23:00:00+00:00");
  });

  it("nulls the epoch-artifact from the bad import (1969-12-31)", () => {
    expect(sanitizeDueAt("1969-12-31T00:00:00+00:00")).toBeNull();
  });

  it("nulls Unix epoch itself", () => {
    expect(sanitizeDueAt("1970-01-01T00:00:00Z")).toBeNull();
  });

  it("nulls null / empty / undefined", () => {
    expect(sanitizeDueAt(null)).toBeNull();
    expect(sanitizeDueAt(undefined)).toBeNull();
    expect(sanitizeDueAt("")).toBeNull();
  });

  it("nulls unparseable input", () => {
    expect(sanitizeDueAt("not-a-date")).toBeNull();
  });

  it("hasMeaningfulDueAt mirrors sanitize", () => {
    expect(hasMeaningfulDueAt("2026-06-20T23:00:00Z")).toBe(true);
    expect(hasMeaningfulDueAt("1969-12-31T00:00:00+00:00")).toBe(false);
    expect(hasMeaningfulDueAt(null)).toBe(false);
  });
});
