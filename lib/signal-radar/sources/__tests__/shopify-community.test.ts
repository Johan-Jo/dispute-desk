import { describe, it, expect, vi, beforeEach } from "vitest";
import { shopifyCommunityAdapter } from "@/lib/signal-radar/sources/shopify-community";

const FIXTURE = {
  topic_list: {
    topics: [
      // RELEVANT — chargeback pain
      {
        id: 100001,
        title: "Lost a chargeback dispute despite providing tracking",
        slug: "lost-a-chargeback-dispute",
        excerpt:
          "I submitted shipping confirmation, AVS match, and customer email — Shopify still ruled against us. Has anyone won a chargeback recently?",
        created_at: "2026-05-08T10:00:00.000Z",
        bumped_at: "2026-05-08T11:00:00.000Z",
        last_poster_username: "merchantA",
        category_id: 4,
        tags: [],
        closed: false,
        archived: false,
        pinned: false,
        pinned_globally: false,
      },
      // RELEVANT — competitor frustration
      {
        id: 100002,
        title: "Chargeflow took 25% of recovered revenue, looking for alternatives",
        slug: "chargeflow-took-25-percent",
        excerpt:
          "We&#39;ve been using Chargeflow for six months and it&#39;s eating our margins. Anyone tried Disputifier or Justt instead?",
        created_at: "2026-05-08T09:00:00.000Z",
        bumped_at: "2026-05-08T10:00:00.000Z",
        last_poster_username: "merchantB",
        category_id: 4,
        tags: [],
        closed: false,
        archived: false,
        pinned: false,
        pinned_globally: false,
      },
      // RELEVANT — reserve fear
      {
        id: 100003,
        title: "Shopify froze my payouts after a small spike in chargebacks",
        slug: "shopify-froze-payouts",
        excerpt:
          "Three chargebacks in one week and now my rolling reserve is at 50%. Cannot make payroll. Has anyone gotten this lifted?",
        created_at: "2026-05-08T08:00:00.000Z",
        bumped_at: "2026-05-08T09:00:00.000Z",
        last_poster_username: "merchantC",
        category_id: 4,
        tags: [],
        closed: false,
        archived: false,
        pinned: false,
        pinned_globally: false,
      },
      // OFF-TOPIC — generic theme question, no pain term
      {
        id: 100004,
        title: "How do I add a custom font to my Dawn theme?",
        slug: "custom-font-dawn-theme",
        excerpt:
          "Trying to upload Inter as a custom font but it isn't showing up in the theme editor. Anyone done this before?",
        created_at: "2026-05-08T07:00:00.000Z",
        bumped_at: "2026-05-08T08:00:00.000Z",
        last_poster_username: "merchantD",
        category_id: 5,
        tags: [],
        closed: false,
        archived: false,
        pinned: false,
        pinned_globally: false,
      },
      // FILTERED — pinned/global announcement
      {
        id: 100005,
        title: "Welcome to the Community! Read this first about chargebacks",
        slug: "welcome-rules",
        excerpt: "Welcome to the forum. Please review the community guidelines.",
        created_at: "2024-01-01T00:00:00.000Z",
        bumped_at: "2024-01-01T00:00:00.000Z",
        last_poster_username: "jasonh",
        category_id: 1,
        tags: [],
        closed: false,
        archived: false,
        pinned: true,
        pinned_globally: true,
      },
      // FILTERED — closed topic
      {
        id: 100006,
        title: "[Closed] Chargeback discussion thread",
        slug: "closed-chargeback-thread",
        excerpt: "This thread has been closed.",
        created_at: "2025-01-01T00:00:00.000Z",
        bumped_at: "2025-01-01T00:00:00.000Z",
        last_poster_username: "moderator",
        category_id: 4,
        tags: [],
        closed: true,
        archived: false,
        pinned: false,
        pinned_globally: false,
      },
    ],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("shopifyCommunityAdapter", () => {
  it("ingests relevant topics and filters off-topic + pinned + closed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(FIXTURE),
      json: async () => FIXTURE,
    } as Response);

    const result = await shopifyCommunityAdapter.ingest();
    expect(result.errors).toEqual([]);

    // 3 relevant items expected (chargeback dispute, chargeflow, reserve fear).
    // Theme question is dropped (no pain term). Pinned + closed are dropped.
    // /latest.json and /top.json fixtures are the same here so dedup runs once.
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain("Lost a chargeback dispute despite providing tracking");
    expect(titles).toContain(
      "Chargeflow took 25% of recovered revenue, looking for alternatives"
    );
    expect(titles).toContain("Shopify froze my payouts after a small spike in chargebacks");
    expect(titles).not.toContain("How do I add a custom font to my Dawn theme?");
    expect(titles).not.toContain(
      "Welcome to the Community! Read this first about chargebacks"
    );
    expect(titles).not.toContain("[Closed] Chargeback discussion thread");
  });

  it("decodes HTML entities in excerpts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(FIXTURE),
      json: async () => FIXTURE,
    } as Response);

    const result = await shopifyCommunityAdapter.ingest();
    const chargeflow = result.items.find((i) =>
      (i.title ?? "").includes("Chargeflow took 25")
    );
    expect(chargeflow).toBeDefined();
    expect(chargeflow!.content).not.toContain("&#39;");
    expect(chargeflow!.content).toContain("We've been using Chargeflow");
  });

  it("emits all items with platform=shopify_community and contentType=submission", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(FIXTURE),
      json: async () => FIXTURE,
    } as Response);

    const result = await shopifyCommunityAdapter.ingest();
    for (const item of result.items) {
      expect(item.platform).toBe("shopify_community");
      expect(item.contentType).toBe("submission");
      expect(item.externalId.startsWith("sc_")).toBe(true);
      expect(item.url.startsWith("https://community.shopify.com/t/")).toBe(true);
    }
  });

  it("surfaces HTTP errors as IngestResult.errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => "Service Unavailable",
      json: async () => ({}),
    } as Response);

    const result = await shopifyCommunityAdapter.ingest();
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/HTTP 503/);
  });
});
