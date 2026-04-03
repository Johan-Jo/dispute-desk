import { describe, expect, it } from "vitest";
import {
  HUB_FEATURED_COUNT,
  HUB_GRID_PAGE_SIZE,
  hubListRange,
  parseHubPage,
  totalHubPagesFiltered,
  totalHubPagesUnfiltered,
} from "../hubPagination";

describe("parseHubPage", () => {
  it("defaults invalid to 1", () => {
    expect(parseHubPage(undefined)).toBe(1);
    expect(parseHubPage("0")).toBe(1);
    expect(parseHubPage("-1")).toBe(1);
    expect(parseHubPage("abc")).toBe(1);
  });
  it("parses positive integers", () => {
    expect(parseHubPage("3")).toBe(3);
  });
});

describe("hubListRange", () => {
  it("filtered uses plain page windows", () => {
    expect(hubListRange({ isFiltered: true, page: 1 })).toEqual({
      limit: HUB_GRID_PAGE_SIZE,
      offset: 0,
    });
    expect(hubListRange({ isFiltered: true, page: 2 })).toEqual({
      limit: HUB_GRID_PAGE_SIZE,
      offset: HUB_GRID_PAGE_SIZE,
    });
  });

  it("unfiltered page 1 returns featured + grid window", () => {
    expect(hubListRange({ isFiltered: false, page: 1 })).toEqual({
      limit: HUB_FEATURED_COUNT + HUB_GRID_PAGE_SIZE,
      offset: 0,
    });
  });

  it("unfiltered page 2+ skips featured slots", () => {
    expect(hubListRange({ isFiltered: false, page: 2 })).toEqual({
      limit: HUB_GRID_PAGE_SIZE,
      offset: HUB_FEATURED_COUNT,
    });
    expect(hubListRange({ isFiltered: false, page: 3 })).toEqual({
      limit: HUB_GRID_PAGE_SIZE,
      offset: HUB_FEATURED_COUNT + HUB_GRID_PAGE_SIZE,
    });
  });
});

describe("totalHubPagesUnfiltered", () => {
  it("counts grid pages after featured", () => {
    expect(totalHubPagesUnfiltered(0)).toBe(1);
    expect(totalHubPagesUnfiltered(2)).toBe(1);
    expect(totalHubPagesUnfiltered(3)).toBe(1);
    expect(totalHubPagesUnfiltered(12)).toBe(1);
    expect(totalHubPagesUnfiltered(13)).toBe(2);
  });
});

describe("totalHubPagesFiltered", () => {
  it("ceil of total over page size", () => {
    expect(totalHubPagesFiltered(0)).toBe(1);
    expect(totalHubPagesFiltered(10)).toBe(1);
    expect(totalHubPagesFiltered(11)).toBe(2);
  });
});
