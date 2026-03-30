import { describe, it, expect } from "vitest";
import { isBacklogRankUnavailableError } from "@/lib/resources/isBacklogRankUnavailableError";

describe("isBacklogRankUnavailableError", () => {
  it("returns true for missing column style messages", () => {
    expect(
      isBacklogRankUnavailableError({
        message: 'column content_archive_items.backlog_rank does not exist',
      }),
    ).toBe(true);
    expect(
      isBacklogRankUnavailableError({
        message: "Could not find the 'backlog_rank' column of 'content_archive_items' in the schema cache",
      }),
    ).toBe(true);
    expect(isBacklogRankUnavailableError({ message: 'column "backlog_rank" does not exist', code: '42703' })).toBe(
      true,
    );
  });

  it("returns false when backlog_rank is only mentioned in unrelated errors", () => {
    expect(isBacklogRankUnavailableError({ message: "duplicate key value violates unique constraint" })).toBe(
      false,
    );
    expect(isBacklogRankUnavailableError(null)).toBe(false);
  });
});
