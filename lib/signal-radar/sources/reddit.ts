import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

/**
 * Tier 1 Reddit views — broad ingestion of dispute-relevant subreddits.
 * r/shopify is implicitly Shopify-context. The other subs (chargeback,
 * Stripe, Etsy) are implicitly DISPUTE-context — every thread there is
 * about chargebacks/payments/disputes by definition. The classifier
 * still vets each item and the dashboard streams filter on dispute_relevance.
 *
 * For r/shopify we crawl new/hot/top (4 views) for breadth. For the
 * smaller dispute-focused subs, /new alone is enough volume.
 */
const SHOPIFY_VIEWS: string[] = [
  // r/shopify breadth — /new + /hot + /top day/week/month catches both
  // freshly-posted pain (e.g. "got my first chargeback today") and
  // older-but-trending posts. r/shopify gets ~25 new posts every few hours,
  // so without /top?t=month any post older than ~24h that didn't trend
  // would never appear in our window.
  "/r/shopify/new.json",
  "/r/shopify/hot.json",
  "/r/shopify/top.json?t=day",
  "/r/shopify/top.json?t=week",
  "/r/shopify/top.json?t=month",
  // r/shopify search — catches dispute-pain posts that didn't trend at all
  // (low engagement, posted at off-hours, drowned by volume). restrict_sr=1
  // keeps us inside r/shopify; sort=new + t=month bounds at 30 days. These
  // are the posts users mean when they say "I can find lots of chargeback
  // posts in r/shopify why aren't they here?".
  "/r/shopify/search.json?q=chargeback&restrict_sr=1&sort=new&t=month",
  "/r/shopify/search.json?q=dispute&restrict_sr=1&sort=new&t=month",
  "/r/shopify/search.json?q=reserve&restrict_sr=1&sort=new&t=month",
  "/r/shopify/search.json?q=payout&restrict_sr=1&sort=new&t=month",
  "/r/shopify/search.json?q=fraud&restrict_sr=1&sort=new&t=month",
  // r/chargeback was banned by Reddit; r/chargebacks (plural) is the surviving sub.
  "/r/chargebacks/new.json",
  "/r/chargebacks/top.json?t=week",
  "/r/chargebacks/top.json?t=month",
  "/r/Stripe/new.json",
  "/r/Stripe/top.json?t=week",
  "/r/paypal/new.json",
  "/r/paypal/top.json?t=week",
  "/r/Etsy/top.json?t=week",
];

const SUBMISSIONS_PER_VIEW = 25;
const COMMENTS_PER_SUBMISSION = 5;
const REDDIT_PUBLIC_BASE = "https://www.reddit.com";
const DEFAULT_USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (admin-only Shopify-merchant intelligence; contact: oi@johan.com.br)";

/**
 * Reddit's unauthenticated .json endpoint rate-limits per source IP. The
 * Cloudflare Worker proxy uses a small CDN egress pool, so 11 rapid hits
 * trip 429s on most calls. 1500ms between listings keeps us under the
 * limit; comments use 500ms (they're cheaper and Reddit cares less).
 */
const LISTING_DELAY_MS = 1500;
const COMMENT_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
}

/**
 * Cloudflare's Worker reads its secret from `env.PROXY_SECRET`. Operators
 * who copy that name verbatim to Vercel naturally name the var `PROXY_SECRET`
 * there too — so accept either form. `REDDIT_PROXY_SECRET` is the canonical
 * Vercel-side name; `PROXY_SECRET` is the alias.
 */
export function getProxySecret(): string | undefined {
  return process.env.REDDIT_PROXY_SECRET ?? process.env.PROXY_SECRET;
}

/**
 * Fetches a Reddit path. Routes through the Cloudflare Worker proxy when
 * REDDIT_PROXY_URL + REDDIT_PROXY_SECRET (or PROXY_SECRET) are configured
 * (production), and falls back to direct Reddit fetches otherwise (local).
 *
 * Reddit blocks Vercel/AWS/GCP egress IPs on .json endpoints. The Worker
 * runs on Cloudflare's CDN edge (different IP class), bypassing the block.
 * See cloudflare-workers/signal-radar-reddit-proxy/ for the Worker code.
 */
/** Normalize a proxy URL — prepend https:// if missing, strip trailing slash. */
function normalizeProxyUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/$/, "");
}

async function redditFetch(path: string): Promise<Response> {
  const rawProxyUrl = process.env.REDDIT_PROXY_URL;
  const proxySecret = getProxySecret();
  if (rawProxyUrl && proxySecret) {
    const proxyUrl = normalizeProxyUrl(rawProxyUrl);
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

/**
 * Subreddits that are implicitly Shopify-context — every thread is about
 * Shopify by definition. Other subs (r/chargeback, r/Stripe, r/Etsy) need
 * a literal "shopify" mention to pass the gate; otherwise we'd ingest pure
 * Stripe/Etsy/non-Shopify dispute pain that the merchant_relevance classifier
 * would correctly mark false anyway, just wasting API calls.
 */
const IMPLICIT_SHOPIFY_SUBREDDITS = /^r\/shopify$/i;

function passesGate(item: IngestedItem): boolean {
  const implicitShopifyContext = item.subreddit
    ? IMPLICIT_SHOPIFY_SUBREDDITS.test(item.subreddit)
    : false;
  return (
    applyIngestGates({
      author: item.author,
      title: item.title,
      content: item.content,
      implicitShopifyContext,
    }) === null
  );
}

export const redditAdapter: SignalSourceAdapter = {
  platform: "reddit",
  async ingest(): Promise<IngestResult> {
    const items: IngestedItem[] = [];
    const errors: string[] = [];
    const usingProxy = Boolean(
      process.env.REDDIT_PROXY_URL && getProxySecret()
    );

    // Fetch listings sequentially with spacing so Reddit's .json rate limit
    // doesn't 429 most of them. Dedupe submissions across views.
    const seenSubmissions = new Set<string>();
    const uniqueSubmissions: RedditSubmission[] = [];
    for (let i = 0; i < SHOPIFY_VIEWS.length; i++) {
      const view = SHOPIFY_VIEWS[i];
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
      if (i < SHOPIFY_VIEWS.length - 1) await sleep(LISTING_DELAY_MS);
    }

    // Map submissions through the gate
    for (const s of uniqueSubmissions) {
      const item = submissionToItem(s);
      if (passesGate(item)) items.push(item);
    }

    // Fetch top-level comments for each kept submission. Comments are gated
    // separately so junk doesn't ride in on the back of a relevant post.
    // Spaced to avoid Reddit's per-IP rate limit on .json endpoints.
    for (let i = 0; i < uniqueSubmissions.length; i++) {
      const s = uniqueSubmissions[i];
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
      if (i < uniqueSubmissions.length - 1) await sleep(COMMENT_DELAY_MS);
    }

    if (items.length === 0 && errors.length === SHOPIFY_VIEWS.length) {
      if (!usingProxy) {
        errors.push(
          "All Reddit fetches failed and REDDIT_PROXY_URL is not set — deploy the Cloudflare Worker proxy (cloudflare-workers/signal-radar-reddit-proxy/README.md) and configure REDDIT_PROXY_URL + REDDIT_PROXY_SECRET on Vercel."
        );
      } else {
        errors.push(
          "All Reddit fetches failed even though REDDIT_PROXY_URL is configured — verify the Worker is deployed and PROXY_SECRET inside Cloudflare matches REDDIT_PROXY_SECRET (or PROXY_SECRET) on Vercel."
        );
      }
    }

    console.info(
      `[signal-radar] reddit views=${SHOPIFY_VIEWS.length} unique_submissions=${uniqueSubmissions.length} kept_items=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
