import { applyIngestGates, passesShopifyPainGate } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

/**
 * Reddit-via-search adapter — restores Reddit merchant-pain signal AFTER Reddit
 * walled off every direct path (2026-06): anonymous `.json` (blocked 05-28),
 * public `.rss` feeds (blocked 06-04), and API credentials (Data API now gated
 * behind the "Responsible Builder Policy" to moderation use cases only).
 *
 * The unlock: we never fetch Reddit ourselves. A web-search index that has
 * ALREADY crawled Reddit returns the thread's title + snippet + permalink, and
 * the search provider's servers — not ours — touch reddit.com. No IP block
 * reaches us. The alert-worthy signal ("Shopify put a 30% reserve on me after
 * chargebacks, looking to switch") almost always lives in the title/snippet,
 * which is exactly what the classifier scores on. We lose full post + comment
 * bodies (that needs a paid scraper) but keep detection-grade signal.
 *
 * Two providers, selected by env:
 *   1. Brave Search API (BRAVE_SEARCH_API_KEY) — the PROD path. Works from
 *      Vercel datacenter IPs (authenticated API), gives a `freshness` filter
 *      and per-result `page_age`, free tier = 2,000 queries/month.
 *   2. DuckDuckGo lite (no key) — the LOCAL-proof fallback. Free and keyless,
 *      but datacenter-IP-fragile and dateless, so only reliable from a
 *      residential IP (dev). Used to prove the plumbing before wiring Brave.
 *
 * Emits `platform: "reddit"` with the canonical `t3_<id>` externalId derived
 * from the /comments/<id>/ permalink, so items dedupe against any Reddit rows
 * ingested by the old direct adapter and flow through the same classifier and
 * alert pipeline.
 */

/**
 * Search queries. Generic `chargeback` queries pull off-topic subs
 * (r/askcarsales, r/AirBnB — verified), so EVERY query pairs "shopify" with a
 * payment-pain term. We use DOMAIN-level `site:reddit.com` (not path-scoped
 * `site:reddit.com/r/shopify`) because neither Brave nor DuckDuckGo reliably
 * honours a path-scoped `site:` — the subreddit is recovered from each result
 * URL afterwards. Requiring "shopify" also satisfies the Shopify-context gate
 * for results in mixed-context subs (r/Stripe, r/smallbusiness, etc.).
 */
const SEARCH_QUERIES: string[] = [
  "shopify chargeback dispute site:reddit.com",
  "shopify payments reserve held funds site:reddit.com",
  "shopify chargeback won lost evidence site:reddit.com",
  "shopify payout frozen high risk site:reddit.com",
  "shopify dispute representment friendly fraud site:reddit.com",
  "shopify chargeflow disputifier chargeback site:reddit.com",
  "shopify chargeback protection app site:reddit.com",
];

const RESULTS_PER_QUERY = 20;

/**
 * Hours (UTC) at which the Brave path runs. The ingest cron fires hourly, but
 * Brave's FREE tier is 1,000 queries/month, so we cap runs: 7 queries × 3
 * runs/day × 30 days = 630/month, leaving ~370 headroom for operator "Refresh
 * now" clicks (which force-fetch) and the odd test. DuckDuckGo (keyless, local)
 * ignores this gate. `freshness=pm` (past month) + cross-run dedup means 3
 * runs/day never miss a fresh thread (worst-case alert latency ~8h).
 */
const BRAVE_RUN_HOURS_UTC = new Set([0, 8, 16]);

const DEFAULT_USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (admin-only Shopify-merchant intelligence; contact: oi@johan.com.br)";

/** Spacing between search calls. Brave free tier is 1 query/sec; DDG dislikes
 *  bursts. 1200ms keeps both happy. */
const QUERY_DELAY_MS = 1200;
const FETCH_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
}

/** Implicit-Shopify subreddits — dispute-context by definition (mirror of the
 *  direct adapter's set). Items elsewhere must carry the "shopify" literal. */
const IMPLICIT_CONTEXT_SUBREDDITS = /^r\/(shopify|chargebacks|Stripe|paypal)$/i;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  /** ISO date when the provider supplies one (Brave page_age); else null. */
  publishedIso: string | null;
}

/** Decode the XML/HTML entities search snippets arrive with. Run twice to
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

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Search titles carry a " : r/shopify - Reddit" / " - Reddit" suffix. Strip
 *  it so the title reads naturally and the gate/classifier see clean text. */
function cleanTitle(raw: string): string {
  let t = decodeEntities(stripTags(raw));
  t = t.replace(/\s*[-–—|]\s*Reddit\s*$/i, "");
  t = t.replace(/\s*:\s*r\/[A-Za-z0-9_]+\s*$/i, "");
  t = t.replace(/\s*:\s*r\s*\.\.\.\s*$/i, ""); // truncated " : r ..."
  return t.trim();
}

/** Pull the t3 fullname + subreddit out of a Reddit permalink. Returns null for
 *  non-thread Reddit URLs (user pages, subreddit roots, wiki, etc.). */
export function parseRedditUrl(
  url: string
): { externalId: string; subreddit: string } | null {
  const m = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i);
  if (!m) return null;
  return { externalId: `t3_${m[2]}`, subreddit: `r/${m[1]}` };
}

// ---------------------------------------------------------------------------
// Provider: Brave Search API (prod)
// ---------------------------------------------------------------------------

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
}

async function braveSearch(query: string): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      count: String(RESULTS_PER_QUERY),
      freshness: "pm", // past month — aligns with the 30-day ingest staleness gate
      result_filter: "web",
      safesearch: "off",
    });
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
        signal: ctrl.signal,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brave ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = (await res.json()) as { web?: { results?: BraveResult[] } };
    const results = json.web?.results ?? [];
    const hits: SearchHit[] = [];
    for (const r of results) {
      if (!r.url || !r.title) continue;
      const published =
        r.page_age && !Number.isNaN(Date.parse(r.page_age))
          ? new Date(r.page_age).toISOString()
          : null;
      hits.push({
        title: r.title,
        url: r.url,
        snippet: decodeEntities(stripTags(r.description ?? "")),
        publishedIso: published,
      });
    }
    return hits;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider: DuckDuckGo lite (keyless local-proof fallback)
// ---------------------------------------------------------------------------

/**
 * Parse DuckDuckGo's lite HTML. The lite layout is a flat table: each result is
 * a `<a class="result-link" href="…">title</a>` followed by a
 * `<td class="result-snippet">…</td>`. We pair each link with the nearest
 * following snippet. Regex-based (the page is small and stable); avoids an HTML
 * dep. DDG gives no post dates, so publishedIso is null (caller stamps "now").
 */
export function parseDuckDuckGoLite(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  // Split on result links; each chunk after a link holds that result's snippet.
  // DDG lite uses single-quoted class attrs and orders attributes as
  // `<a rel=… href='…' class='result-link'>`, so match href and class
  // independently of order. Quotes may be single or double.
  const linkRe =
    /<a\b[^>]*\bhref=['"]([^'"]+)['"][^>]*\bclass=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i;
  let m: RegExpExecArray | null;
  const matches: Array<{ href: string; title: string; index: number }> = [];
  while ((m = linkRe.exec(html)) !== null) {
    matches.push({ href: m[1], title: m[2], index: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const { href, title, index } = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const between = html.slice(index, nextIndex);
    const sn = between.match(snippetRe);
    let url = href;
    // DDG sometimes wraps links in a redirect: //duckduckgo.com/l/?uddg=<enc>
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    hits.push({
      title,
      url,
      snippet: sn ? decodeEntities(stripTags(sn[1])) : "",
      publishedIso: null,
    });
  }
  return hits;
}

async function duckDuckGoSearch(query: string): Promise<SearchHit[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": userAgent() }, signal: ctrl.signal }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DuckDuckGo ${res.status}: ${body.slice(0, 160)}`);
    }
    return parseDuckDuckGoLite(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function hitToItem(hit: SearchHit, nowIso: string): IngestedItem | null {
  const parsed = parseRedditUrl(hit.url);
  if (!parsed) return null;
  const title = cleanTitle(hit.title);
  const content = hit.snippet;
  const implicitShopifyContext = IMPLICIT_CONTEXT_SUBREDDITS.test(
    parsed.subreddit
  );
  const rejected = applyIngestGates({
    author: null, // search results don't carry the author reliably
    title,
    content,
    implicitShopifyContext,
  });
  if (rejected) return null;

  // Pain-term HARD gate — search-adapter-specific. The shared gate leaves
  // pain filtering to the classifier because subreddit *listings* are lossy,
  // but here we explicitly SEARCHED for pain terms, so a result with zero
  // dispute/chargeback/reserve/payout vocabulary in its title+snippet is
  // off-topic Shopify chatter (stock picks, inventory sync, "is SHOP a buy")
  // that Brave's relevance ranking dragged in. Dropping it at ingest keeps the
  // lead streams dense and saves classifier spend.
  if (!passesShopifyPainGate(`${title}\n${content}`)) return null;
  return {
    platform: "reddit",
    contentType: "submission",
    externalId: parsed.externalId,
    parentExternalId: null,
    subreddit: parsed.subreddit,
    url: hit.url.split("?")[0],
    author: null,
    title,
    content,
    rawPayload: hit,
    postedAt: hit.publishedIso ?? nowIso,
  };
}

type Provider = "brave" | "duckduckgo";

function selectProvider(): Provider {
  return process.env.BRAVE_SEARCH_API_KEY ? "brave" : "duckduckgo";
}

/** Exposed for tests / wiring decisions. */
export function redditSearchProvider(): Provider {
  return selectProvider();
}

async function runQuery(provider: Provider, query: string): Promise<SearchHit[]> {
  return provider === "brave"
    ? braveSearch(query)
    : duckDuckGoSearch(query);
}

export const redditSearchAdapter: SignalSourceAdapter = {
  platform: "reddit",
  async ingest(): Promise<IngestResult> {
    const provider = selectProvider();
    const errors: string[] = [];

    // Conserve Brave's free quota: only run on the scheduled hours. DDG is
    // keyless/local and ignores the gate. `SIGNAL_RADAR_FORCE_FETCH=1` bypasses
    // it — set by the manual "Refresh now" route (an operator click should
    // always fetch, whatever the hour) and by local tests.
    const forceFetch = process.env.SIGNAL_RADAR_FORCE_FETCH === "1";
    if (provider === "brave" && !forceFetch) {
      const hour = new Date().getUTCHours();
      if (!BRAVE_RUN_HOURS_UTC.has(hour)) {
        console.info(
          `[signal-radar] reddit-search(brave) skipped (hour ${hour} not in {0,6,12,18})`
        );
        return { items: [], errors: [] };
      }
    }

    const nowIso = new Date().toISOString();
    const seen = new Set<string>();
    const items: IngestedItem[] = [];

    for (let i = 0; i < SEARCH_QUERIES.length; i++) {
      const query = SEARCH_QUERIES[i];
      try {
        const hits = await runQuery(provider, query);
        for (const hit of hits) {
          const item = hitToItem(hit, nowIso);
          if (!item) continue;
          if (seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          items.push(item);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[signal-radar] reddit-search "${query}" error:`, msg);
        errors.push(`${query}: ${msg.slice(0, 160)}`);
      }
      if (i < SEARCH_QUERIES.length - 1) await sleep(QUERY_DELAY_MS);
    }

    if (items.length === 0 && errors.length === SEARCH_QUERIES.length) {
      if (provider === "duckduckgo") {
        errors.push(
          "All reddit-search queries failed via DuckDuckGo — DDG blocks automated queries from datacenter IPs. Set BRAVE_SEARCH_API_KEY (free 2,000/mo at brave.com/search/api) for a datacenter-safe provider."
        );
      }
    }

    console.info(
      `[signal-radar] reddit-search(${provider}) queries=${SEARCH_QUERIES.length} kept_items=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
