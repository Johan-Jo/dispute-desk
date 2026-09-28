/**
 * Not-as-described PR 3b — what the PDF exhibit may carry.
 */
import { describe, it, expect } from "vitest";
import { buildProductListingExhibits, exhibitCaption, EXHIBIT_LIMITS } from "../productListingExhibit";

const JPEG = (n: number) => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; return b; };
const WEBP = () => new Uint8Array([0x52, 0x49, 0x46, 0x46]);

const section = (listings: unknown[]) => [{ source: "shopify_product", data: { listings } }];
const listing = (paths: string[], over: Record<string, unknown> = {}) => ({
  title: "Linen cushion cover",
  variantOptions: [{ name: "Colour", value: "Stone grey" }, { name: "Title", value: "Default Title" }],
  excerpt: "40 × 40 cm.",
  sourceUrl: "https://shop.example/p",
  fetchedAt: "2026-09-28T10:00:00Z",
  imagePaths: paths,
  ...over,
});

describe("buildProductListingExhibits", () => {
  it("prints nothing unless the letter cites a collected listing", async () => {
    const r = await buildProductListingExhibits({ sb: {} as never, sections: section([listing([])]), listingCited: false });
    expect(r).toEqual([]);
  });

  it("keeps JPEG/PNG only, dedupes by path, caps count and bytes", async () => {
    const files: Record<string, Uint8Array> = {
      "a.jpg": JPEG(100), "b.webp": WEBP(), "big.jpg": JPEG(EXHIBIT_LIMITS.imageBytesPerPdf),
      "c.jpg": JPEG(100), "d.jpg": JPEG(100), "e.jpg": JPEG(100), "f.jpg": JPEG(100), "g.jpg": JPEG(100), "h.jpg": JPEG(100),
    };
    const r = await buildProductListingExhibits({
      sb: {} as never,
      sections: section([listing(["a.jpg", "b.webp", "big.jpg", "a.jpg", "c.jpg"]), listing(["d.jpg", "e.jpg", "f.jpg", "g.jpg", "h.jpg"])]),
      listingCited: true,
      download: async (p) => files[p] ?? null,
    });
    const total = r.reduce((n, x) => n + x.images.length, 0);
    expect(total).toBe(EXHIBIT_LIMITS.imagesPerPdf);
    expect(r[0].images.every((s) => s.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(r[0].variantLine).toBe("Colour: Stone grey");
    expect(r[0].retrievedOn).toBe("2026-09-28");
  });

  it("the caption states provenance, never a hedge", () => {
    expect(exhibitCaption("2026-09-28")).toBe("Product listing as published in the store, retrieved 2026-09-28");
    expect(exhibitCaption("2026-09-28")).not.toMatch(/may differ|at the time of purchase|customer saw/i);
  });
});

describe("exhibit presentation (prod canary #100411)", () => {
  it("strips emoji the PDF font cannot draw, and Shopify's 'Title' option", async () => {
    const { printable } = await import("../productListingExhibit");
    expect(printable("Wärme auf Knopfdruck 🔥✨: sofort")).toBe("Wärme auf Knopfdruck : sofort");
    const r = await buildProductListingExhibits({
      sb: {} as never,
      sections: section([listing([], { variantOptions: [{ name: "Title", value: "*3.95" }], variantTitle: "*3.95" })]),
      listingCited: true,
      download: async () => null,
    });
    expect(r[0].variantLine).toBe("*3.95");
  });

  it("shortens the printed URL, keeps the link target", async () => {
    const { displayUrl } = await import("../productListingExhibit");
    const long = "https://meinmaison.de/products/thermabelle-damen-heizweste-usb-beheizte-weste-mit-infrarot-technologie-warmeregulierend";
    expect(displayUrl(long)!.length).toBeLessThanOrEqual(70);
    expect(displayUrl(long)!.startsWith("meinmaison.de/products/")).toBe(true);
  });
});
