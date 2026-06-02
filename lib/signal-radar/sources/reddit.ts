import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

/**
 * Tier 1 Reddit views — broad ingestion of dispute-relevant subreddits.
 *
 * 2026-06-02: switched from the `.json` API to Reddit's public **RSS** feeds.
 * Reddit now returns 403 to unauthenticated `.json` requests from datacenter
 * AND Cloudflare edge IPs (so the Worker proxy stopped working on 2026-05-28),
 * and its OAuth API requires a registered app behind a Developer-Platform gate.
 * RSS (`/r/<sub>/<sort>/.rss`, `/r/<sub>/search.rss`) is the public feed-reader
 * surface and is not gated the same way. We still route through the same
 * Cloudflare Worker proxy (it just forwards whatever path it's given), so no
 * Worker redeploy and no Reddit credentials are required.
 *
 * RSS carries submissions only (no comments) and slightly less metadata than
 * JSON, but the fields the classifier needs — title, body, author, subreddit,
 * permalink, posted-at — are all present.
 */
const SHOPIFY_VIEWS: string[] = [
  // r/shopify breadth — new + hot + top day/week/month.
  "/r/shopify/new/.rss",
  "/r/shopify/hot/.rss",
  "/r/shopify/top/.rss?t=day",
  "/r/shopify/top/.rss?t=week",
  "/r/shopify/top/.rss?t=month",
  // r/shopify search — dispute-pain posts that never trended.
  "/r/shopify/search.rss?q=chargeback&restrict_sr=1&sort=new&t=month",
  "/r/shopify/search.rss?q=dispute&restrict_sr=1&sort=new&t=month",
  // r/chargebacks (plural — r/chargeback was banned).
  "/r/chargebacks/new/.rss",
  "/r/chargebacks/top/.rss?t=week",
  "/r/chargebacks/top/.rss?t=month",
  // r/Stripe — dispute-focused merchants venting Stripe-side.
  "/r/Stripe/new/.rss",
  "/r/Stripe/top/.rss?t=month",
  "/r/Stripe/search.rss?q=chargeback&restrict_sr=1&sort=new&t=month",
  // r/paypal — same logic, lighter footprint.
  "/r/paypal/new/.rss",
  "/r/paypal/top/.rss?t=month",
  "/r/paypal/search.rss?q=chargeback&restrict_sr=1&sort=new&t=month",
  "/r/Etsy/top/.rss?t=month",
];

const SUBMISSIONS_PER_VIEW = 25;
const REDDIT_PUBLIC_BASE = "https://www.reddit.com";
const DEFAULT_USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (admin-only Shopify-merchant intelligence; contact: oi@johan.com.br)";

/**
 * Reddit rate-limits per source IP. With ~17 feeds firing back-to-back we'd
 * risk 429s; 1500ms spacing keeps us under the limit.
 */
const LISTING_DELAY_MS = 1500;

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

/** Normalize a proxy URL — prepend https:// if missing, strip trailing slash. */
function normalizeProxyUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/$/, "");
}

/**
 * Per-fetch timeout. Without this, one hanging Reddit (or proxy) connection
 * can stall the loop for minutes and blow the Vercel 300s function budget.
 */
const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetches a Reddit path. Routes through the Cloudflare Worker proxy when
 * REDDIT_PROXY_URL + secret are configured (production), and falls back to
 * direct Reddit fetches otherwise (local). Reddit blocks datacenter egress
 * IPs; the Worker runs on Cloudflare's edge.
 */
async function redditFetch(path: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const rawProxyUrl = process.env.REDDIT_PROXY_URL;
    const proxySecret = getProxySecret();
    if (rawProxyUrl && proxySecret) {
      const proxyUrl = normalizeProxyUrl(rawProxyUrl);
      const url = `${proxyUrl}?path=${encodeURIComponent(path)}`;
      return await fetch(url, {
        headers: {
          Authorization: `Bearer ${proxySecret}`,
          "X-Reddit-UA": userAgent(),
        },
        signal: ctrl.signal,
      });
    }
    return await fetch(`${REDDIT_PUBLIC_BASE}${path}`, {
      headers: { "User-Agent": userAgent() },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface RedditRssEntry {
  /** Reddit fullname, e.g. t3_abc123 — matches the JSON adapter's externalId. */
  id: string;
  title: string;
  url: string;
  author: string | null;
  /** Subreddit name without the leading "r/", e.g. "shopify". */
  subreddit: string;
  contentText: string;
  publishedIso: string;
}

/** Decode the common XML/HTML entities Reddit's Atom feed uses. Run twice to
 *  unwrap double-encoding (`&amp;#39;` → `&#39;` → `'`). */
function decodeEntitiesOnce(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function decodeEntities(s: string): string {
  return decodeEntitiesOnce(decodeEntitiesOnce(s));
}

/** Reddit RSS <content> is escaped HTML ending in a "submitted by … [link]
 *  [comments]" footer. Decode, strip tags, drop the footer, collapse space. */
function htmlContentToText(rawContent: string): string {
  let text = decodeEntities(rawContent);
  // The footer always begins with "submitted by"; everything after is chrome.
  const footerIdx = text.search(/submitted by/i);
  if (footerIdx !== -1) text = text.slice(0, footerIdx);
  text = text
    .replace(/<!--.*?-->/gs, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function firstMatch(block: string, re: RegExp): string | null {
  const m = block.match(re);
  return m ? m[1] : null;
}

/** Parse a Reddit Atom feed into entries. Regex-based (the feed is small and
 *  consistent); avoids pulling in an XML dependency. */
function parseAtomEntries(xml: string): RedditRssEntry[] {
  const entries: RedditRssEntry[] = [];
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const block of blocks) {
    const id = firstMatch(block, /<id>(t3_[^<]+)<\/id>/);
    if (!id) continue;
    const href = firstMatch(block, /<link[^>]*href="([^"]+)"/);
    if (!href) continue;
    const rawTitle = firstMatch(block, /<title>([\s\S]*?)<\/title>/) ?? "";
    const rawContent = firstMatch(block, /<content[^>]*>([\s\S]*?)<\/content>/) ?? "";
    const authorRaw = firstMatch(block, /<author>\s*<name>([^<]+)<\/name>/);
    const term = firstMatch(block, /<category[^>]*term="([^"]+)"/);
    const published =
      firstMatch(block, /<published>([^<]+)<\/published>/) ??
      firstMatch(block, /<updated>([^<]+)<\/updated>/);

    // Derive subreddit from the category term, else from the permalink.
    let subreddit = term ?? "";
    if (!subreddit) {
      const fromUrl = href.match(/reddit\.com\/r\/([^/]+)/i);
      subreddit = fromUrl ? fromUrl[1] : "";
    }

    entries.push({
      id,
      title: decodeEntities(rawTitle).replace(/\s+/g, " ").trim(),
      url: decodeEntities(href),
      author: authorRaw ? authorRaw.replace(/^\/u\//, "").trim() || null : null,
      subreddit,
      contentText: htmlContentToText(rawContent),
      publishedIso: published ? new Date(published).toISOString() : new Date(0).toISOString(),
    });
  }
  return entries;
}

function withParam(path: string, key: string, value: string | number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${value}`;
}

async function fetchListing(viewPath: string): Promise<RedditRssEntry[]> {
  const p = withParam(viewPath, "limit", SUBMISSIONS_PER_VIEW);
  const res = await redditFetch(p);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit ${viewPath} failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const xml = await res.text();
  return parseAtomEntries(xml);
}

function entryToItem(e: RedditRssEntry): IngestedItem {
  return {
    platform: "reddit",
    contentType: "submission",
    externalId: e.id,
    parentExternalId: null,
    subreddit: `r/${e.subreddit}`,
    url: e.url,
    author: e.author,
    title: e.title,
    content: e.contentText,
    rawPayload: e,
    postedAt: e.publishedIso,
  };
}

/**
 * Subreddits that are implicitly in-scope. r/shopify is implicitly Shopify;
 * r/chargebacks/r/Stripe/r/paypal are implicitly DISPUTE-focused — every
 * thread there is about chargebacks/payments/disputes by definition.
 *
 * The classifier still vets each item (merchant_relevance, dispute_relevance),
 * and the dashboard streams filter on those.
 */
const IMPLICIT_CONTEXT_SUBREDDITS = /^r\/(shopify|chargebacks|Stripe|paypal)$/i;

function passesGate(item: IngestedItem): boolean {
  const implicitShopifyContext = item.subreddit
    ? IMPLICIT_CONTEXT_SUBREDDITS.test(item.subreddit)
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

    // Fetch feeds sequentially with spacing so Reddit's rate limit doesn't
    // 429 most of them. Dedupe submissions across views by fullname.
    const seen = new Set<string>();
    const uniqueEntries: RedditRssEntry[] = [];
    for (let i = 0; i < SHOPIFY_VIEWS.length; i++) {
      const view = SHOPIFY_VIEWS[i];
      try {
        const entries = await fetchListing(view);
        for (const e of entries) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          uniqueEntries.push(e);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[signal-radar] reddit ${view} error:`, err);
        errors.push(`${view}: ${msg.slice(0, 160)}`);
      }
      if (i < SHOPIFY_VIEWS.length - 1) await sleep(LISTING_DELAY_MS);
    }

    for (const e of uniqueEntries) {
      const item = entryToItem(e);
      if (passesGate(item)) items.push(item);
    }

    if (items.length === 0 && errors.length === SHOPIFY_VIEWS.length) {
      if (!usingProxy) {
        errors.push(
          "All Reddit RSS fetches failed and REDDIT_PROXY_URL is not set — deploy the Cloudflare Worker proxy (cloudflare-workers/signal-radar-reddit-proxy/README.md) and configure REDDIT_PROXY_URL + REDDIT_PROXY_SECRET on Vercel."
        );
      } else {
        errors.push(
          "All Reddit RSS fetches failed even though REDDIT_PROXY_URL is configured — Reddit may now also block RSS from the Worker's IP. Check the Worker's X-Upstream-Status; if RSS is blocked, the remaining free option is Reddit's OAuth API (needs a registered Reddit app)."
        );
      }
    }

    console.info(
      `[signal-radar] reddit(rss) views=${SHOPIFY_VIEWS.length} unique_submissions=${uniqueEntries.length} kept_items=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
