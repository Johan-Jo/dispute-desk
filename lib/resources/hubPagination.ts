/** Public Resources hub index: 2 featured slots on unfiltered page 1, then 10 grid articles per page. */

export const HUB_GRID_PAGE_SIZE = 10;
export const HUB_FEATURED_COUNT = 2;

export function parseHubPage(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "1"), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * DB `limit` / `offset` for `listPublishedByRoute` (same sort order as hub: featured priority + publish_at).
 */
export function hubListRange(args: {
  isFiltered: boolean;
  page: number;
  gridPageSize?: number;
  featuredCount?: number;
}): { limit: number; offset: number } {
  const grid = args.gridPageSize ?? HUB_GRID_PAGE_SIZE;
  const feat = args.featuredCount ?? HUB_FEATURED_COUNT;
  const page = args.page < 1 ? 1 : args.page;

  if (args.isFiltered) {
    return { limit: grid, offset: (page - 1) * grid };
  }
  if (page === 1) {
    return { limit: feat + grid, offset: 0 };
  }
  /** Page 1 consumes `feat + grid` rows; later pages only add grid-sized windows. */
  return { limit: grid, offset: feat + grid * (page - 1) };
}

/** Total hub pages for the latest grid (unfiltered hub only). */
export function totalHubPagesUnfiltered(totalItems: number, gridPageSize = HUB_GRID_PAGE_SIZE): number {
  if (totalItems <= 0) return 1;
  if (totalItems <= HUB_FEATURED_COUNT) return 1;
  const gridOnly = totalItems - HUB_FEATURED_COUNT;
  return Math.max(1, Math.ceil(gridOnly / gridPageSize));
}

export function totalHubPagesFiltered(totalItems: number, gridPageSize = HUB_GRID_PAGE_SIZE): number {
  if (totalItems <= 0) return 1;
  return Math.max(1, Math.ceil(totalItems / gridPageSize));
}
