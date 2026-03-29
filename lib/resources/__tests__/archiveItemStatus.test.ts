import { describe, it, expect } from "vitest";
import { getArchiveItemStatusDisplay } from "@/lib/resources/archiveItemStatus";

describe("getArchiveItemStatusDisplay", () => {
  it("maps brief_ready to Brief Ready (not Idea fallback)", () => {
    const d = getArchiveItemStatusDisplay("brief_ready");
    expect(d.label).toBe("Brief Ready");
  });

  it("maps backlog and idea", () => {
    expect(getArchiveItemStatusDisplay("backlog").label).toBe("Backlog");
    expect(getArchiveItemStatusDisplay("idea").label).toBe("Idea");
  });

  it("maps converted", () => {
    expect(getArchiveItemStatusDisplay("converted").label).toBe("Converted");
  });
});
