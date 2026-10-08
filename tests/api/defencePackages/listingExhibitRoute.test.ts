/**
 * The in-app letter view shows the same product-listing exhibit the PDF
 * prints — and only when the package's own facts cite a collected listing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
const build = vi.fn();
vi.mock("@/lib/defence/productListingExhibit", () => ({ buildProductListingExhibits: (a: unknown) => build(a) }));

import { getServiceClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/defence-packages/[id]/listing-exhibit/route";

const params = { params: Promise.resolve({ id: "pkg-1" }) };
const req = () => new NextRequest("https://x.test/api/defence-packages/pkg-1/listing-exhibit");

function client(pkg: unknown, item: unknown) {
  const q = (row: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: row });
    return c;
  };
  vi.mocked(getServiceClient).mockReturnValue({
    from: (t: string) => q(t === "defence_packages" ? pkg : item),
  } as never);
}

const cited = [{ category: "product_listing", value: { collected: true } }];

beforeEach(() => {
  build.mockReset();
  build.mockResolvedValue([{ title: "x", images: ["data:image/jpeg;base64,AA"] }]);
});

describe("GET /api/defence-packages/:id/listing-exhibit", () => {
  it("returns the exhibit when the facts cite a collected listing", async () => {
    client({ source_pack_id: "p1", facts_json: cited }, { source: "shopify_product", payload: { listings: [] } });
    const res = await GET(req(), params);
    expect((await res.json()).exhibits).toHaveLength(1);
    expect(build.mock.calls[0][0]).toMatchObject({ listingCited: true });
  });

  it("returns nothing when the letter does not cite the listing", async () => {
    client({ source_pack_id: "p1", facts_json: [] }, { source: "shopify_product", payload: {} });
    expect((await (await GET(req(), params)).json()).exhibits).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it("404s for a package outside the shop", async () => {
    client(null, null);
    expect((await GET(req(), params)).status).toBe(404);
  });
});
