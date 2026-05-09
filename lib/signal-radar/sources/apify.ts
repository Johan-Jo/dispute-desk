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

const SUBREDDITS = [
  "shopify",
  "ecommerce",
  "dropshipping",
  "Entrepreneur",
  "smallbusiness",
];

/**
 * Per-run cap. Apify's lite actor takes ~0.3-0.5s per item; with Vercel's
 * 60-300s function timeout we need to fit within the wall clock. 50 keeps
 * sync runs under ~30s; cron + manual refresh both share this budget.
 */
const MAX_ITEMS = 50;
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

/** Reddit author handles that are bots — skip everything they post/comment. */
const BOT_AUTHORS = new Set(["AutoModerator", "automoderator", "[deleted]", "RemindMeBot"]);

/**
 * AutoModerator removal-message signatures. Reddit replaces a removed post/comment
 * body with one of these stock messages, which would otherwise pollute the
 * classifier and the phrase widget with "automatically removed", "contact moderators",
 * etc. — not merchant pain.
 */
const AUTOMOD_PATTERNS: RegExp[] = [
  /this action was performed automatically/i,
  /please contact the moderators of (this|the) subreddit/i,
  /your (post|submission|comment) has been (automatically )?removed/i,
  /you (don'?t|do not) have enough (karma|post karma|comment karma)/i,
  /^\s*\[removed\]\s*$/i,
  /^\s*\[deleted\]\s*$/i,
  /i am a bot/i,
  /this is an automated/i,
];

function looksLikeAutomod(text: string): boolean {
  if (!text) return false;
  return AUTOMOD_PATTERNS.some((re) => re.test(text));
}

function mapItem(d: ApifyRedditItem): IngestedItem | null {
  const dataType = pickString(d, ["dataType"]);
  const isComment = d.isComment === true || dataType === "comment";

  const externalId = buildExternalId(d, isComment);
  if (!externalId) return null;

  const url = pickString(d, ["postUrl", "url", "permalink"]);
  if (!url) return null;

  const subreddit = normalizeSubreddit(
    pickString(d, ["parsedCommunityName", "community", "communityName", "subreddit"])
  );

  const postedAt = normalizePostedAt(
    pickString(d, ["createdAt", "createdAtIso", "created"])
  );
  if (!postedAt) return null;

  const title = isComment ? null : pickString(d, ["title"]);
  const content = pickString(d, ["body", "text", "selftext"]) ?? "";

  // Drop bot/automod content — it's noise, not signal
  const author = pickString(d, ["username", "user", "author"]);
  if (author && BOT_AUTHORS.has(author)) return null;
  if (looksLikeAutomod(title ?? "")) return null;
  if (looksLikeAutomod(content)) return null;

  // Drop empty/near-empty submissions (link-only with no body and no title-as-context)
  if (!isComment && !title && content.trim().length < 8) return null;
  if (isComment && content.trim().length < 8) return null;

  const score = pickNumber(d, ["score", "upVotes", "numberOfupvotes"]) ?? 0;
  if (isComment && score < 1) return null;

  let parentExternalId: string | null = null;
  if (isComment) {
    const parent = pickString(d, ["parentId", "postId"]);
    if (parent) {
      parentExternalId = parent.startsWith("t3_") ? parent : `t3_${parent}`;
    }
  }

  return {
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
      startUrls: SUBREDDITS.map((s) => ({
        url: `https://www.reddit.com/r/${s}/new/`,
      })),
      maxItems: MAX_ITEMS,
      maxPostCount: MAX_ITEMS,
      maxPosts: MAX_ITEMS,
      type: "posts",
      sort: "new",
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
    let mappingFailures = 0;
    for (const d of dataset) {
      const item = mapItem(d);
      if (item) items.push(item);
      else mappingFailures++;
    }

    const errors: string[] = [];
    if (dataset.length > 0 && items.length === 0) {
      errors.push(
        `Apify returned ${dataset.length} dataset items but none could be mapped — actor schema may differ from expected. Check APIFY_REDDIT_ACTOR_ID.`
      );
    } else if (mappingFailures > items.length / 2 && mappingFailures > 5) {
      errors.push(
        `Apify mapping: ${mappingFailures}/${dataset.length} items skipped (missing required fields).`
      );
    }

    return { items, errors };
  },
};
