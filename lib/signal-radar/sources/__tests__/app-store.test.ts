import { describe, it, expect, vi, beforeEach } from "vitest";
import { appStoreAdapter } from "@/lib/signal-radar/sources/app-store";

const FIXTURE_HTML = `
<html>
<body>
  <div id="review-1234567" class="review-block">
    <div class="tw-flex">
      <div aria-label="2 out of 5 stars" role="img"></div>
      <div class="tw-text-body-xs tw-text-fg-tertiary">
        May 9, 2026
      </div>
      <div>United States</div>
    </div>
    <div class="tw-order-last">
      <div data-merchant-review-reply></div>
    </div>
    <div data-truncate-review>
      <div data-truncate-content-copy>
        Lost a chargeback dispute despite providing AVS match and tracking. Their support never explained why.
      </div>
    </div>
    Over 2 years using the app
  </div>
  <div id="review-7654321" class="review-block">
    <div aria-label="5 out of 5 stars" role="img"></div>
    <div class="tw-text-body-xs tw-text-fg-tertiary">
      April 15, 2026
    </div>
    <div>Canada</div>
    <div data-merchant-review-reply></div>
    <div data-truncate-review>
      <div data-truncate-content-copy>
        Saved us from a major fraud wave. Best dispute app on the App Store.
      </div>
    </div>
    About 6 months using the app
  </div>
  <div id="review-99999">
    <div aria-label="3 out of 5 stars" role="img"></div>
    <div data-truncate-review>
      <div data-truncate-content-copy></div>
    </div>
  </div>
</body>
</html>
`;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("appStoreAdapter", () => {
  it("parses real review markup and extracts ratings, dates, bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => FIXTURE_HTML,
    } as Response);

    const result = await appStoreAdapter.ingest();
    expect(result.errors).toEqual([]);

    // 2 valid reviews × 5 apps × 2 pages = 20, but dedup by externalId means 2 unique
    const ids = new Set(result.items.map((i) => i.externalId));
    expect(ids.has("as_chargeflow_1234567")).toBe(true);
    expect(ids.has("as_chargeflow_7654321")).toBe(true);

    // Empty-body review (review-99999) should be filtered
    expect(ids.has("as_chargeflow_99999")).toBe(false);

    const sample = result.items.find((i) => i.externalId === "as_chargeflow_1234567");
    expect(sample).toBeDefined();
    expect(sample!.platform).toBe("app_store");
    expect(sample!.contentType).toBe("submission");
    expect(sample!.subreddit).toBe("chargeflow");
    expect(sample!.title).toContain("2/5");
    expect(sample!.title).toContain("United States");
    expect(sample!.content).toContain("Lost a chargeback dispute");
    expect(sample!.content).toContain("AVS match");
    // Date should parse to May 9 2026
    expect(sample!.postedAt.startsWith("2026-05-09")).toBe(true);
  });

  it("surfaces fetch errors as IngestResult.errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => "Not found",
    } as Response);

    const result = await appStoreAdapter.ingest();
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/404/);
  });
});
