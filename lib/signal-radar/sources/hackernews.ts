/**
 * Hacker News adapter (via Algolia search API — free, no auth, no IP block).
 *
 * Lower volume than Reddit but high signal-density when present. HN
 * discussions about Shopify/Stripe chargebacks tend to be detailed,
 * substantive, and from technical operators (not casual venting). Often
 * surface stories that don't appear elsewhere — Stripe account closures,
 * chargeback rate analysis, payment-processor patterns.
 *
 * Algolia search: GET https://hn.algolia.com/api/v1/search_by_date
 *   ?query={q}&tags={comment|story}&hitsPerPage=N
 *
 * We run multiple queries to widen coverage. Each hit is mapped into the
 * common IngestedItem shape; the classifier downstream judges
 * merchant_relevance and dispute_relevance.
 */
import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

const HN_ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";

/** Search queries — each runs separately. Per-query results capped at HITS_PER_QUERY. */
const HN_QUERIES: string[] = [
  "shopify chargeback",
  "shopify dispute",
  "shopify reserve",
  "stripe chargeback",
  "stripe dispute",
  "chargeback rate",
  "friendly fraud",
];

const HITS_PER_QUERY = 30;

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  url?: string | null;
  author?: string | null;
  created_at: string;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
  nbHits?: number;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function hitToItem(hit: AlgoliaHit): IngestedItem | null {
  const isComment = hit._tags?.includes("comment") ?? false;
  const title = hit.title || hit.story_title || null;
  const rawBody = hit.comment_text || hit.story_text || "";
  const content = decodeHtmlEntities(stripHtml(rawBody));

  if (!title && content.length < 4) return null;

  const url = isComment
    ? `https://news.ycombinator.com/item?id=${hit.objectID}`
    : hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;

  return {
    platform: "hackernews",
    contentType: isComment ? "comment" : "submission",
    externalId: `hn_${hit.objectID}`,
    parentExternalId: null,
    subreddit: null,
    url,
    author: hit.author ?? null,
    title,
    content,
    rawPayload: hit,
    postedAt: hit.created_at,
  };
}

export const hackerNewsAdapter: SignalSourceAdapter = {
  platform: "hackernews",
  async ingest(): Promise<IngestResult> {
    const items: IngestedItem[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const query of HN_QUERIES) {
      const url = `${HN_ALGOLIA_BASE}?query=${encodeURIComponent(query)}&hitsPerPage=${HITS_PER_QUERY}`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`HN "${query}": ${msg.slice(0, 120)}`);
        continue;
      }
      if (!res.ok) {
        errors.push(`HN "${query}": HTTP ${res.status}`);
        continue;
      }
      let json: AlgoliaResponse;
      try {
        json = (await res.json()) as AlgoliaResponse;
      } catch {
        errors.push(`HN "${query}": non-JSON response`);
        continue;
      }
      for (const hit of json.hits ?? []) {
        if (seen.has(hit.objectID)) continue;
        seen.add(hit.objectID);
        const item = hitToItem(hit);
        if (!item) continue;
        // HackerNews is mixed-context — require literal "shopify" mention to
        // pass the gate. The classifier filters merchant_relevance and
        // dispute_relevance downstream.
        const rejected = applyIngestGates({
          author: item.author,
          title: item.title,
          content: item.content,
          implicitShopifyContext: false,
        });
        if (rejected) continue;
        items.push(item);
      }
    }

    console.info(
      `[signal-radar] hackernews queries=${HN_QUERIES.length} unique_hits=${seen.size} kept=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
