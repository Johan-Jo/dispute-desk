/**
 * Apify Reddit adapter — primary production source.
 *
 * Reddit aggressively blocks Vercel/AWS/GCP egress IPs. Apify's Reddit
 * Scraper actor handles IP rotation, captchas, and Reddit's anti-bot
 * for us, returning clean JSON via their dataset API.
 *
 * Default actor: trudax~reddit-scraper-lite (free actor, low cost).
 * Override via APIFY_REDDIT_ACTOR_ID env if you want to swap to the
 * paid trudax~reddit-scraper for richer data (full comments, etc.).
 *
 * Cost note: ~$0.025 per 250-item run on the lite actor → ~$18/mo at
 * hourly cadence. Free Apify trial credits cover the first ~$5.
 */
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

const APIFY_API = "https://api.apify.com/v2";
const DEFAULT_ACTOR_ID = "trudax~reddit-scraper-lite";

/**
 * Reddit search queries — replace the old subreddit /new strategy. Reddit's
 * /new for off-topic subs (r/Entrepreneur, r/smallbusiness, even r/ecommerce)
 * was 90%+ generic ecommerce chatter; the gate filtered most of it to nothing.
 * Search-based ingest finds Shopify-specific content wherever it appears,
 * including posts in subs we don't ingest directly.
 *
 * Each query is run via a Reddit search URL (sort=new, t=month). The Apify
 * lite actor accepts these as startUrls; if the user upgrades to the paid
 * trudax/reddit-scraper actor via APIFY_REDDIT_ACTOR_ID env, the same input
 * shape works.
 */
const SHOPIFY_PAIN_QUERIES: string[] = [
  "shopify chargeback",
  "shopify dispute",
  "shopify reserve",
  "shopify payouts",
  "shopify payments fraud",
  "chargeflow",
  "disputifier",
  "chargepay",
  "alternative chargeflow",
  "alternative disputifier",
];

/**
 * Per-run cap. The gate drops most items, so we ingest more raw to end up
 * with a usable harvest. ~150 items split across ~10 queries takes ~60-90s
 * on the lite actor.
 */
const MAX_ITEMS = 150;
/** Server-side (Apify) timeout in seconds — Apify aborts if its run exceeds this. */
const APIFY_RUN_TIMEOUT_SECS = 50;

interface ApifyRedditItem {
  id?: string;
  parsedId?: string;
  postId?: string;
  dataType?: string;
  isComment?: boolean;
  parentId?: string;
  postUrl?: string;
  url?: string;
  permalink?: string;
  title?: string;
  body?: string;
  text?: string;
  selftext?: string;
  username?: string;
  user?: string;
  author?: string;
  parsedCommunityName?: string;
  community?: string;
  communityName?: string;
  subreddit?: string;
  createdAt?: string;
  created?: string;
  createdAtIso?: string;
  upVotes?: number;
  numberOfupvotes?: number;
  score?: number;
  numberOfComments?: number;
  [key: string]: unknown;
}

function pickString(obj: ApifyRedditItem, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickNumber(obj: ApifyRedditItem, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

function pickBoolean(obj: ApifyRedditItem, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

function normalizePostedAt(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function normalizeSubreddit(name: string | null): string | null {
  if (!name) return null;
  return name.startsWith("r/") ? name : `r/${name}`;
}

function buildExternalId(d: ApifyRedditItem, isComment: boolean): string | null {
  const explicit = pickString(d, ["id", "parsedId"]);
  if (explicit) {
    if (isComment && !explicit.startsWith("t1_")) return `t1_${explicit}`;
    if (!isComment && !explicit.startsWith("t3_")) return `t3_${explicit}`;
    return explicit;
  }
  const url = pickString(d, ["postUrl", "url", "permalink"]);
  if (url) return `${isComment ? "t1" : "t3"}_${url}`;
  return null;
}

import { applyIngestGates } from "./utils";

const SHOPIFY_SUBREDDIT = /^r\/shopify$/i;

type MapResult =
  | { kind: "ok"; item: IngestedItem }
  | { kind: "schema_incomplete" }
  | { kind: "filtered" };

function mapItem(d: ApifyRedditItem): MapResult {
  const dataType = pickString(d, ["dataType"]);
  const isComment = d.isComment === true || dataType === "comment";

  // Schema-required fields. Missing these means the Apify actor returned
  // an unexpected shape — that's a real problem worth surfacing.
  const externalId = buildExternalId(d, isComment);
  if (!externalId) return { kind: "schema_incomplete" };

  const url = pickString(d, ["postUrl", "url", "permalink"]);
  if (!url) return { kind: "schema_incomplete" };

  const postedAt = normalizePostedAt(
    pickString(d, ["createdAt", "createdAtIso", "created"])
  );
  if (!postedAt) return { kind: "schema_incomplete" };

  const subreddit = normalizeSubreddit(
    pickString(d, ["parsedCommunityName", "community", "communityName", "subreddit"])
  );
  const title = isComment ? null : pickString(d, ["title"]);
  const content = pickString(d, ["body", "text", "selftext"]) ?? "";

  // r/shopify is implicitly Shopify-context (the entire sub is about
  // Shopify); other subreddits must mention Shopify literally. Pass the
  // flag through to the shared gate.
  const author = pickString(d, ["username", "user", "author"]);
  const implicitShopifyContext = subreddit
    ? SHOPIFY_SUBREDDIT.test(subreddit)
    : false;
  const rejected = applyIngestGates({
    author,
    title,
    content,
    implicitShopifyContext,
  });
  if (rejected) return { kind: "filtered" };

  // Note: no upvote-score filter for comments. Reddit's vote-count fuzzing
  // shows 0/1 for most fresh content, and minority-opinion comments often
  // sit at 0–1 even when they carry the most useful pain signal. Let the
  // classifier sort signal from noise.

  let parentExternalId: string | null = null;
  if (isComment) {
    const parent = pickString(d, ["parentId", "postId"]);
    if (parent) {
      parentExternalId = parent.startsWith("t3_") ? parent : `t3_${parent}`;
    }
  }

  return {
    kind: "ok",
    item: {
      platform: "reddit",
      contentType: isComment ? "comment" : "submission",
      externalId,
      parentExternalId,
      subreddit,
      url: url.startsWith("http") ? url : `https://www.reddit.com${url}`,
      author,
      title,
      content,
      rawPayload: d,
      postedAt,
    },
  };
}

/** Accept either env name — APIFY_API_TOKEN (canonical) or APIFY_API_KEY (common alias). */
function getApifyToken(): string | undefined {
  return process.env.APIFY_API_TOKEN ?? process.env.APIFY_API_KEY;
}

export { getApifyToken };

export const apifyAdapter: SignalSourceAdapter = {
  platform: "reddit",
  async ingest(): Promise<IngestResult> {
    const token = getApifyToken();
    if (!token) {
      return {
        items: [],
        errors: [
          "APIFY_API_TOKEN (or APIFY_API_KEY) not configured on this environment",
        ],
      };
    }

    const actorId = process.env.APIFY_REDDIT_ACTOR_ID ?? DEFAULT_ACTOR_ID;
    const url =
      `${APIFY_API}/acts/${actorId}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(token)}` +
      `&timeout=${APIFY_RUN_TIMEOUT_SECS}`;

    const input = {
      // Search-based ingest: each query targets a Shopify-pain narrative.
      // Reddit's global search across all subs catches Shopify-specific posts
      // wherever they happen — venting in r/Entrepreneur, advice in r/SaaS, etc.
      startUrls: SHOPIFY_PAIN_QUERIES.map((q) => ({
        url: `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=new&t=month`,
      })),
      // Some actor variants accept `searches` directly — pass both, harmless duplicate.
      searches: SHOPIFY_PAIN_QUERIES,
      maxItems: MAX_ITEMS,
      maxPostCount: MAX_ITEMS,
      maxPosts: MAX_ITEMS,
      type: "posts",
      sort: "new",
      time: "month",
      includeNSFW: false,
      proxy: { useApifyProxy: true },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { items: [], errors: [`Apify fetch failed: ${msg}`] };
    }

    if (!res.ok) {
      const body = await res.text();
      return {
        items: [],
        errors: [`Apify ${res.status}: ${body.slice(0, 300)}`],
      };
    }

    let dataset: ApifyRedditItem[];
    try {
      const parsed = await res.json();
      if (!Array.isArray(parsed)) {
        return {
          items: [],
          errors: [
            `Apify returned non-array response (got ${typeof parsed})`,
          ],
        };
      }
      dataset = parsed as ApifyRedditItem[];
    } catch {
      return {
        items: [],
        errors: ["Apify returned non-JSON response"],
      };
    }

    const items: IngestedItem[] = [];
    let schemaIncomplete = 0;
    let filtered = 0;
    for (const d of dataset) {
      const r = mapItem(d);
      if (r.kind === "ok") items.push(r.item);
      else if (r.kind === "schema_incomplete") schemaIncomplete++;
      else filtered++;
    }

    const errors: string[] = [];
    // Only flag schema mismatches as errors — they indicate the Apify actor
    // returned an unexpected shape and may need APIFY_REDDIT_ACTOR_ID tuning.
    // Quality filters (bot content, near-empty bodies) are intentional drops.
    if (dataset.length > 0 && items.length === 0) {
      errors.push(
        `Apify returned ${dataset.length} dataset items but none could be mapped — actor schema may differ from expected. Check APIFY_REDDIT_ACTOR_ID.`
      );
    } else if (schemaIncomplete > 0 && schemaIncomplete > dataset.length * 0.5) {
      errors.push(
        `Apify schema: ${schemaIncomplete}/${dataset.length} items missing required fields (id/url/createdAt). Actor schema may have shifted.`
      );
    }
    console.info(
      `[signal-radar] apify mapped=${items.length} filtered=${filtered} schema_incomplete=${schemaIncomplete}`
    );

    return { items, errors };
  },
};
