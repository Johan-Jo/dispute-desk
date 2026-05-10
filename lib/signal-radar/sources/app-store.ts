/**
 * Shopify App Store reviews adapter.
 *
 * Apps.shopify.com pages are public HTML — the host doesn't IP-block Vercel
 * (it's Shopify's own product). Each app exposes its reviews at
 * /<handle>/reviews?sort_by=newest&page=N, with ~10 reviews per page.
 *
 * Reviews are wrapped in `<div id="review-{id}"...>` blocks containing:
 *   - aria-label="X out of 5 stars" → rating
 *   - <time> or "Month Day, Year" text → posted date
 *   - merchant country in a separate <div>
 *   - data-truncate-content-copy → actual review body
 *
 * Every review IS implicitly Shopify-context (Shopify App Store, Shopify
 * merchants), and every review on a chargeback/fraud app IS implicitly
 * dispute-relevant — but the classifier still vets each one and writes
 * dispute_relevance which the dashboard streams filter on.
 *
 * Apps to scrape (chargeback/fraud-prevention category — extend as needed):
 *   chargeflow, disputifier, chargepay-fight-disputes,
 *   signifyd, nofraud, riskified
 */
import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

const APP_STORE_BASE = "https://apps.shopify.com";
const USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (+https://disputedesk.app; admin-only intelligence)";

/**
 * App handles to scrape. These are Shopify-merchant chargeback/fraud apps —
 * negative reviews are the highest-density dispute-pain source we have.
 */
const APP_HANDLES: string[] = [
  "chargeflow",
  "disputifier",
  "chargepay",
  "signifyd",
  "riskified",
];

/** Pages to scrape per app per run. ~10 reviews/page; 2 pages = ~20 latest reviews. */
const PAGES_PER_APP = 2;

interface ParsedReview {
  reviewId: string;
  appHandle: string;
  rating: number;
  postedAt: string;
  country: string | null;
  appDuration: string | null;
  body: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…");
}

function stripTags(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parses one app's reviews page HTML into ParsedReview[]. */
function parsePage(html: string, appHandle: string): ParsedReview[] {
  const reviews: ParsedReview[] = [];
  // Split on review id markers — first chunk is page header, rest are reviews
  const blocks = html.split(/<div id="review-(\d+)"/);
  // blocks[0] = pre-review HTML; then alternating [id, block, id, block, ...]
  for (let i = 1; i < blocks.length; i += 2) {
    const reviewId = blocks[i];
    const block = blocks[i + 1];
    if (!reviewId || !block) continue;

    const starsMatch = block.match(/aria-label="(\d+) out of 5 stars"/);
    const rating = starsMatch ? Number(starsMatch[1]) : 0;

    // Date format: "Month DD, YYYY", embedded inside a <div> with whitespace
    const dateMatch = block.match(
      />\s*([A-Z][a-z]+ \d{1,2},?\s+\d{4})\s*</
    );
    let postedAt: string;
    if (dateMatch) {
      const d = new Date(dateMatch[1]);
      postedAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      postedAt = new Date().toISOString();
    }

    // Country line — appears in its own <div> after the merchant name area
    const countryMatch = block.match(
      /<div>([A-Z][A-Za-z .,]{1,40})<\/div>\s*<\/div>\s*<div class="tw-order-last/
    );
    const country = countryMatch ? countryMatch[1].trim() : null;

    // App-duration phrase: "Over 2 years using the app", "About 1 month using the app"
    const durMatch = block.match(
      /(?:Over|About|Less than|More than|Almost|Nearly)\s+\d+\s+\w+\s+using the app/
    );
    const appDuration = durMatch ? durMatch[0] : null;

    // Body — wrapped in data-truncate-content-copy ... </div>
    const bodyMatch = block.match(
      /data-truncate-content-copy[^>]*>([\s\S]*?)<\/div>/
    );
    const body = bodyMatch ? decodeEntities(stripTags(bodyMatch[1])) : "";

    if (body.length < 4) continue;

    reviews.push({
      reviewId,
      appHandle,
      rating,
      postedAt,
      country,
      appDuration,
      body,
    });
  }
  return reviews;
}

async function fetchPage(
  appHandle: string,
  page: number
): Promise<string | null> {
  const url = `${APP_STORE_BASE}/${encodeURIComponent(appHandle)}/reviews?sort_by=newest&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `Shopify App Store ${appHandle} page ${page} failed ${res.status}`
    );
  }
  return res.text();
}

function reviewToItem(r: ParsedReview): IngestedItem {
  // Construct a title from rating + body excerpt for classifier context
  const title = `${r.rating}/5 review of ${r.appHandle}${r.country ? " — " + r.country : ""}`;
  return {
    platform: "app_store",
    contentType: "submission",
    externalId: `as_${r.appHandle}_${r.reviewId}`,
    parentExternalId: null,
    subreddit: r.appHandle, // re-purpose subreddit field as "app context"
    url: `${APP_STORE_BASE}/${r.appHandle}/reviews?sort_by=newest`,
    author: r.country, // we don't get merchant names, use country as a coarse proxy
    title,
    content: r.body,
    rawPayload: r,
    postedAt: r.postedAt,
  };
}

export const appStoreAdapter: SignalSourceAdapter = {
  platform: "app_store",
  async ingest(): Promise<IngestResult> {
    const items: IngestedItem[] = [];
    const errors: string[] = [];

    for (const handle of APP_HANDLES) {
      for (let page = 1; page <= PAGES_PER_APP; page++) {
        let html: string | null;
        try {
          html = await fetchPage(handle, page);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[signal-radar] app-store ${handle} p${page} error:`, err);
          errors.push(`${handle} p${page}: ${msg.slice(0, 160)}`);
          continue;
        }
        if (!html) continue;
        const reviews = parsePage(html, handle);
        for (const r of reviews) {
          // Sentiment-polarity gate: 4-5 star reviews are praise, not pain.
          // Signal Radar's dashboard streams are all pain-focused; positive
          // reviews would be misclassified as support_failure / etc. just
          // because they mention chargeback keywords. Drop at ingest.
          if (r.rating >= 4) continue;
          const item = reviewToItem(r);
          // App Store reviews are implicitly Shopify-context.
          const rejected = applyIngestGates({
            author: item.author,
            title: item.title,
            content: item.content,
            implicitShopifyContext: true,
          });
          if (rejected) continue;
          items.push(item);
        }
      }
    }

    console.info(
      `[signal-radar] app-store apps=${APP_HANDLES.length} pages_each=${PAGES_PER_APP} kept=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
