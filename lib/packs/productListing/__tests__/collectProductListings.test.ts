/**
 * Not-as-described plan PR 3 — product-listing collection (acceptance #1–#2).
 */
import { describe, it, expect, vi } from "vitest";
import { collectProductListings, LISTING_LIMITS } from "../collectProductListings";
import type { ProductEvidenceLineItem } from "@/lib/shopify/queries/productEvidence";

const ARGS = {
  shopId: "shop-1",
  disputeId: "disp-1",
  orderGid: "gid://shopify/Order/1",
  shopDomain: "s.myshopify.com",
  accessToken: "t",
};

function lineItem(over: Partial<ProductEvidenceLineItem> & { id: string; total?: string }): ProductEvidenceLineItem {
  return {
    name: "Cushion cover",
    quantity: 1,
    originalTotalSet: { shopMoney: { amount: over.total ?? "20.00", currencyCode: "EUR" } },
    customAttributes: [],
    product: {
      id: `gid://shopify/Product/${over.id}`,
      title: "Linen cushion cover",
      description: "40 × 40 cm, stone grey, 100% linen.",
      descriptionHtml: "<p>40 × 40 cm, stone grey, 100% linen.</p>",
      updatedAt: "2026-09-01T00:00:00Z",
      onlineStoreUrl: "https://shop.example/products/cover",
      media: { nodes: [{ id: "m1", image: { url: "https://cdn.example/a.jpg", altText: null } }] },
    },
    variant: { id: `gid://shopify/ProductVariant/${over.id}`, title: "Stone grey", selectedOptions: [{ name: "Colour", value: "Stone grey" }], image: null },
    ...over,
  } as ProductEvidenceLineItem;
}

function fakeSb(opts: { insertError?: { code: string; message: string } } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const uploaded: string[] = [];
  const sb = {
    storage: {
      from: () => ({
        upload: vi.fn(async (path: string) => {
          uploaded.push(path);
          return { data: { path }, error: null };
        }),
      }),
    },
    from: (table: string) => {
      if (table !== "product_listing_snapshots") throw new Error(table);
      const q: Record<string, unknown> = {};
      q.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () =>
              opts.insertError
                ? { data: null, error: opts.insertError }
                : { data: { id: `snap-${inserted.length}` }, error: null },
          }),
        };
      };
      q.select = () => q;
      q.eq = () => q;
      q.single = async () => ({ data: { id: "snap-existing", fetched_at: "2026-09-20T00:00:00Z" }, error: null });
      return q;
    },
  };
  return { sb: sb as never, inserted, uploaded };
}

const query = (nodes: ProductEvidenceLineItem[], errors?: unknown[]) =>
  vi.fn(async () => ({
    data: { order: { id: ARGS.orderGid, lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
    errors,
  })) as never;

const image = async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });

describe("collectProductListings", () => {
  it("present: stores the image and a snapshot row, returns a citable listing", async () => {
    const { sb, inserted, uploaded } = fakeSb();
    const r = await collectProductListings(ARGS, { sb, query: query([lineItem({ id: "1" })]), fetchImage: image });
    expect(r.anyFailed).toBe(false);
    expect(r.outcomes).toEqual([{ lineItemGid: "1", outcome: "present" }]);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatch(/^shop-1\/product-listings\/disp-1\/[0-9a-f]{64}\.jpg$/);
    expect(inserted[0]).toMatchObject({ line_item_gid: "1", title: "Linen cushion cover", image_paths: uploaded });
    expect(inserted[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.listings[0]).toMatchObject({ snapshotId: "snap-1", title: "Linen cushion cover", variantTitle: "Stone grey" });
  });

  it("identical content already stored: reuses the existing snapshot (unique key)", async () => {
    const { sb } = fakeSb({ insertError: { code: "23505", message: "duplicate" } });
    const r = await collectProductListings(ARGS, { sb, query: query([lineItem({ id: "1" })]), fetchImage: image });
    expect(r.listings[0].snapshotId).toBe("snap-existing");
    expect(r.listings[0].fetchedAt).toBe("2026-09-20T00:00:00Z");
  });

  it("custom item, deleted product and empty listing get their own outcomes", async () => {
    const { sb } = fakeSb();
    const r = await collectProductListings(ARGS, {
      sb,
      query: query([
        lineItem({ id: "c", product: null, variant: null }),
        lineItem({ id: "d", product: null }),
        lineItem({ id: "e", product: { id: "p", title: null, description: null, descriptionHtml: null, updatedAt: null, onlineStoreUrl: null, media: null } }),
      ]),
      fetchImage: image,
    });
    expect(r.outcomes.map((o) => o.outcome)).toEqual(["custom_item", "deleted", "absent"]);
    expect(r.listings).toEqual([]);
    expect(r.anyFailed).toBe(false);
  });

  it("missing read_products scope → inaccessible, not retried", async () => {
    const { sb } = fakeSb();
    const r = await collectProductListings(ARGS, {
      sb,
      query: query([], [{ message: "Access denied for product field.", extensions: { code: "ACCESS_DENIED" } }]),
      fetchImage: image,
    });
    expect(r.outcomes).toEqual([{ lineItemGid: null, outcome: "inaccessible" }]);
    expect(r.anyFailed).toBe(false);
  });

  it("a thrown / timed-out query → failed, retriable", async () => {
    const { sb } = fakeSb();
    const r = await collectProductListings(ARGS, {
      sb,
      query: vi.fn(async () => {
        throw new Error("timeout");
      }) as never,
      fetchImage: image,
    });
    expect(r).toMatchObject({ anyFailed: true, outcomes: [{ outcome: "failed" }] });
  });

  it("an image over the limit is skipped, the listing is still collected", async () => {
    const { sb, uploaded } = fakeSb();
    const r = await collectProductListings(ARGS, {
      sb,
      query: query([lineItem({ id: "1" })]),
      fetchImage: async () => null,
    });
    expect(uploaded).toEqual([]);
    expect(r.outcomes[0].outcome).toBe("present");
    expect(LISTING_LIMITS.imageMaxBytes).toBe(1_000_000);
  });

  it("orders listings highest-value line item first (the representative)", async () => {
    const { sb } = fakeSb();
    const r = await collectProductListings(ARGS, {
      sb,
      query: query([lineItem({ id: "cheap", total: "5.00" }), lineItem({ id: "dear", total: "80.00" })]),
      fetchImage: image,
    });
    expect(r.listings.map((l) => l.lineItemGid)).toEqual(["dear", "cheap"]);
  });
});
