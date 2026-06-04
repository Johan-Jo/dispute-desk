import { describe, it, expect } from "vitest";
import {
  parseRedditUrl,
  parseDuckDuckGoLite,
  hitToItem,
  type SearchHit,
} from "../reddit-search";

const NOW = "2026-06-04T12:00:00.000Z";

describe("parseRedditUrl", () => {
  it("derives the t3 fullname and subreddit from a thread permalink", () => {
    expect(
      parseRedditUrl(
        "https://www.reddit.com/r/shopify/comments/1abc234/shopify_held_my_payout/"
      )
    ).toEqual({ externalId: "t3_1abc234", subreddit: "r/shopify" });
  });

  it("returns null for non-thread Reddit URLs", () => {
    expect(parseRedditUrl("https://www.reddit.com/r/shopify/")).toBeNull();
    expect(parseRedditUrl("https://www.reddit.com/user/someone")).toBeNull();
    expect(parseRedditUrl("https://example.com/r/shopify/comments/x/y")).toBeNull();
  });
});

describe("parseDuckDuckGoLite", () => {
  // Minimal reproduction of DDG lite's real markup: single-quoted classes,
  // a //duckduckgo.com/l/?uddg= redirect wrapper, and a result-snippet <td>.
  const html = `
    <table>
      <tr><td>
        <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reddit.com%2Fr%2Fshopify%2Fcomments%2F1abc234%2Fshopify_held_my_payout%2F&amp;rut=deadbeef" class='result-link'>Shopify held my payout after chargebacks : r/shopify - Reddit</a>
      </td></tr>
      <tr><td class='result-snippet'>Shopify Payments put a rolling reserve on my store after two chargebacks and I&#x27;m looking to switch providers.</td></tr>
      <tr><td>
        <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reddit.com%2Fr%2Faskcarsales%2Fcomments%2Fzzz999%2Fchargeback_on_loan%2F&amp;rut=cafe" class='result-link'>Chargeback on a car loan : r/askcarsales - Reddit</a>
      </td></tr>
      <tr><td class='result-snippet'>How is the chargeback to dealers calculated when a loan is paid off early?</td></tr>
    </table>`;

  it("extracts decoded URL, clean title, and snippet for each result", () => {
    const hits = parseDuckDuckGoLite(html);
    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe(
      "https://www.reddit.com/r/shopify/comments/1abc234/shopify_held_my_payout/"
    );
    expect(hits[0].title).toContain("Shopify held my payout after chargebacks");
    expect(hits[0].snippet).toContain("rolling reserve");
    expect(hits[0].snippet).toContain("'"); // &#x27; decoded to apostrophe
  });
});

describe("hitToItem", () => {
  const shopifyHit: SearchHit = {
    title: "Shopify held my payout after chargebacks : r/shopify - Reddit",
    url: "https://www.reddit.com/r/shopify/comments/1abc234/shopify_held_my_payout/",
    snippet:
      "Shopify Payments put a rolling reserve on my store after chargebacks and I'm switching.",
    publishedIso: "2026-06-01T09:00:00.000Z",
  };

  it("maps a Shopify chargeback result to a reddit item with t3 externalId", () => {
    const item = hitToItem(shopifyHit, NOW);
    expect(item).not.toBeNull();
    expect(item!.platform).toBe("reddit");
    expect(item!.externalId).toBe("t3_1abc234");
    expect(item!.subreddit).toBe("r/shopify");
    // Title is cleaned of the " : r/shopify - Reddit" suffix.
    expect(item!.title).toBe("Shopify held my payout after chargebacks");
    // Provider date is preserved.
    expect(item!.postedAt).toBe("2026-06-01T09:00:00.000Z");
    expect(item!.author).toBeNull();
  });

  it("stamps nowIso when the provider supplies no date", () => {
    const item = hitToItem({ ...shopifyHit, publishedIso: null }, NOW);
    expect(item!.postedAt).toBe(NOW);
  });

  it("drops off-topic non-Shopify results via the Shopify-context gate", () => {
    const carHit: SearchHit = {
      title: "Chargeback on a car loan : r/askcarsales - Reddit",
      url: "https://www.reddit.com/r/askcarsales/comments/zzz999/chargeback_on_loan/",
      snippet: "How is the chargeback to dealers calculated when a loan is paid off?",
      publishedIso: null,
    };
    expect(hitToItem(carHit, NOW)).toBeNull();
  });

  it("keeps implicit-context subreddit threads even without the word shopify", () => {
    const chargebacksHit: SearchHit = {
      title: "Won my first representment : r/chargebacks",
      url: "https://www.reddit.com/r/chargebacks/comments/abc111/won_my_first_representment/",
      snippet: "Submitted compelling evidence and the issuer ruled in my favor.",
      publishedIso: null,
    };
    const item = hitToItem(chargebacksHit, NOW);
    expect(item).not.toBeNull();
    expect(item!.subreddit).toBe("r/chargebacks");
  });

  it("returns null for non-thread Reddit URLs", () => {
    expect(
      hitToItem(
        { title: "r/shopify", url: "https://www.reddit.com/r/shopify/", snippet: "shopify chargeback", publishedIso: null },
        NOW
      )
    ).toBeNull();
  });

  it("drops on-topic-subreddit Shopify chatter with no dispute vocabulary (pain gate)", () => {
    // Brave's relevance ranking drags in popular Shopify content (stock picks,
    // inventory sync) that mentions "shopify" but no chargeback/dispute/reserve
    // term — the search-adapter pain gate must drop it even from r/shopify.
    const stockHit: SearchHit = {
      title: "Is Shopify actually a buy after the selloff? : r/shopify",
      url: "https://www.reddit.com/r/shopify/comments/buy123/is_shopify_a_buy/",
      snippet:
        "Shopify provides complete business infrastructure; the platform combines inventory management and shipping services.",
      publishedIso: null,
    };
    expect(hitToItem(stockHit, NOW)).toBeNull();
  });
});
