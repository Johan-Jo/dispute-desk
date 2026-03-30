import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/resources/queries", () => ({
  getAlternatePublishedResourceSlug: vi.fn(),
}));

import { getAlternatePublishedResourceSlug } from "@/lib/resources/queries";
import { GET } from "@/app/api/public/resources/alternate-locale-slug/route";

const mockAlternate = vi.mocked(getAlternatePublishedResourceSlug);

describe("GET /api/public/resources/alternate-locale-slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when params missing", async () => {
    const res = await GET(
      new Request("http://localhost/api/public/resources/alternate-locale-slug") as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid pillar", async () => {
    const url =
      "http://localhost/api/public/resources/alternate-locale-slug?pillar=bad&slug=a&from=en-US&to=fr-FR";
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid locale", async () => {
    const url =
      "http://localhost/api/public/resources/alternate-locale-slug?pillar=chargebacks&slug=a&from=xx-XX&to=fr-FR";
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no alternate slug", async () => {
    mockAlternate.mockResolvedValue(null);
    const url =
      "http://localhost/api/public/resources/alternate-locale-slug?pillar=chargebacks&slug=foo&from=sv-SE&to=fr-FR";
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(404);
    expect(mockAlternate).toHaveBeenCalledWith({
      pillar: "chargebacks",
      slug: "foo",
      fromLocale: "sv-SE",
      toLocale: "fr-FR",
    });
  });

  it("returns slug and pillar when found", async () => {
    mockAlternate.mockResolvedValue({
      slug: "french-slug",
      pillar: "chargebacks",
    });
    const url =
      "http://localhost/api/public/resources/alternate-locale-slug?pillar=chargebacks&slug=sv-slug&from=sv-SE&to=fr-FR";
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ slug: "french-slug", pillar: "chargebacks" });
  });
});
