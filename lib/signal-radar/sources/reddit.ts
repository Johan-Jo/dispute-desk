import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

/**
 * Tier 1 Reddit views — broad ingestion of r/shopify across new/hot/top.
 * Posts here are implicitly Shopify-context, so the classifier judges
 * relevance without us pre-filtering on phrasing. Multiple views catch
 * posts that scrolled off /new but are still actively discussed.
 */
const SHOPIFY_VIEWS: string[] = [
  "/r/shopify/new.json",
  "/r/shopify/hot.json",
  "/r/shopify/top.json?t=day",
  "/r/shopify/top.json?t=week",
];

const SUBMISSIONS_PER_VIEW = 25;
const COMMENTS_PER_SUBMISSION = 5;
const REDDIT_PUBLIC_BASE = "https://www.reddit.com";
const DEFAULT_USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (admin-only Shopify-merchant intelligence; contact: oi@johan.com.br)";

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
}

/**
 * Fetches a Reddit path. Routes through the Cloudflare Worker proxy when
 * REDDIT_PROXY_URL + REDDIT_PROXY_SECRET are configured (production), and
 * falls back to direct Reddit fetches otherwise (local dev).
 *
 * Reddit blocks Vercel/AWS/GCP egress IPs on .json endpoints. The Worker
 * runs on Cloudflare's CDN edge (different IP class), bypassing the block.
 * See cloudflare-workers/signal-radar-reddit-proxy/ for the Worker code.
 */
async function redditFetch(path: string): Promise<Response> {
  const proxyUrl = process.env.REDDIT_PROXY_URL;
  const proxySecret = process.env.REDDIT_PROXY_SECRET;
  if (proxyUrl && proxySecret) {
    const url = `${proxyUrl}?path=${encodeURIComponent(path)}`;
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${proxySecret}`,
        "X-Reddit-UA": userAgent(),
      },
    });
  }
  return fetch(`${REDDIT_PUBLIC_BASE}${path}`, {
    headers: { "User-Agent": userAgent() },
  });
}

interface RedditListingChild<T> {
  kind: string;
  data: T;
}

interface RedditSubmission {
  id: string;
  name: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  author: string;
  subreddit: string;
  created_utc: number;
}

interface RedditComment {
  id: string;
  name: string;
  body: string;
  permalink: string;
  author: string;
  subreddit: string;
  created_utc: number;
  score: number;
  collapsed?: boolean;
  link_id: string;
}

function withParam(path: string, key: string, value: string | number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${value}`;
}

async function fetchListing(viewPath: string): Promise<RedditSubmission[]> {
  let p = withParam(viewPath, "limit", SUBMISSIONS_PER_VIEW);
  p = withParam(p, "raw_json", 1);
  const res = await redditFetch(p);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Reddit ${viewPath} failed ${res.status}: ${body.slice(0, 200)}`
    );
  }
  const json = await res.json();
  const children: RedditListingChild<RedditSubmission>[] =
    json?.data?.children ?? [];
  return children.filter((c) => c.kind === "t3").map((c) => c.data);
}

async function fetchTopLevelComments(
  postId: string
): Promise<RedditComment[]> {
  const path =
    `/r/shopify/comments/${postId}.json` +
    `?limit=${COMMENTS_PER_SUBMISSION}&depth=1&sort=top&raw_json=1`;
  const res = await redditFetch(path);
  if (!res.ok) return [];
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2) return [];
  const commentTree = json[1];
  const children: RedditListingChild<RedditComment>[] =
    commentTree?.data?.children ?? [];
  return children
    .filter((c) => c.kind === "t1")
    .map((c) => c.data)
    .slice(0, COMMENTS_PER_SUBMISSION);
}

function submissionToItem(s: RedditSubmission): IngestedItem {
  return {
    platform: "reddit",
    contentType: "submission",
    externalId: s.name,
    parentExternalId: null,
    subreddit: `r/${s.subreddit}`,
    url: `https://www.reddit.com${s.permalink}`,
    author: s.author ?? null,
    title: s.title,
    content: s.selftext ?? "",
    rawPayload: s,
    postedAt: new Date(s.created_utc * 1000).toISOString(),
  };
}

function commentToItem(c: RedditComment): IngestedItem {
  return {
    platform: "reddit",
    contentType: "comment",
    externalId: c.name,
    parentExternalId: c.link_id,
    subreddit: `r/${c.subreddit}`,
    url: `https://www.reddit.com${c.permalink}`,
    author: c.author ?? null,
    title: null,
    content: c.body,
    rawPayload: c,
    postedAt: new Date(c.created_utc * 1000).toISOString(),
  };
}

function passesGate(item: IngestedItem): boolean {
  // r/shopify is implicitly Shopify-context — don't require a literal "shopify"
  // mention. The classifier downstream judges relevance.
  return (
    applyIngestGates({
      author: item.author,
      title: item.title,
      content: item.content,
      implicitShopifyContext: true,
    }) === null
  );
}

export const redditAdapter: SignalSourceAdapter = {
  platform: "reddit",
  async ingest(): Promise<IngestResult> {
    const items: IngestedItem[] = [];
    const errors: string[] = [];
    const usingProxy = Boolean(
      process.env.REDDIT_PROXY_URL && process.env.REDDIT_PROXY_SECRET
    );

    // Fetch all 4 r/shopify views, dedupe submissions across them.
    const seenSubmissions = new Set<string>();
    const uniqueSubmissions: RedditSubmission[] = [];
    for (const view of SHOPIFY_VIEWS) {
      try {
        const subs = await fetchListing(view);
        for (const s of subs) {
          if (seenSubmissions.has(s.id)) continue;
          seenSubmissions.add(s.id);
          uniqueSubmissions.push(s);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[signal-radar] reddit ${view} error:`, err);
        errors.push(`${view}: ${msg.slice(0, 160)}`);
      }
    }

    // Map submissions through the gate
    for (const s of uniqueSubmissions) {
      const item = submissionToItem(s);
      if (passesGate(item)) items.push(item);
    }

    // Fetch top-level comments for each kept submission. Comments are gated
    // separately so junk doesn't ride in on the back of a relevant post.
    for (const s of uniqueSubmissions) {
      try {
        const comments = await fetchTopLevelComments(s.id);
        for (const c of comments) {
          const item = commentToItem(c);
          if (passesGate(item)) items.push(item);
        }
      } catch (err) {
        // Comments are nice-to-have; don't surface per-post fetch errors as
        // top-level errors unless every fetch fails (already handled below).
        console.warn(`[signal-radar] reddit comments ${s.id} error:`, err);
      }
    }

    if (
      items.length === 0 &&
      errors.length === SHOPIFY_VIEWS.length &&
      !usingProxy
    ) {
      errors.push(
        "All r/shopify fetches failed and REDDIT_PROXY_URL is not set — deploy the Cloudflare Worker proxy (cloudflare-workers/signal-radar-reddit-proxy/README.md) and configure REDDIT_PROXY_URL + REDDIT_PROXY_SECRET on Vercel."
      );
    }

    console.info(
      `[signal-radar] reddit views=${SHOPIFY_VIEWS.length} unique_submissions=${uniqueSubmissions.length} kept_items=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
