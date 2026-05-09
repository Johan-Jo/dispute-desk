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
 * Subreddit list. r/Entrepreneur and r/smallbusiness were in v1 but they're
 * 90%+ off-topic for Shopify-merchant pain — the topic gate filters most of
 * their output anyway, just at the cost of wasted Apify calls. r/shopify and
 * r/ecommerce remain because they have direct chargeback/reserve threads;
 * r/Dropship occasionally has fraud/dispute discussion that's relevant.
 */
const SUBREDDITS = [
  "shopify",
  "ecommerce",
  "Dropship",
];

/**
 * Per-run cap. The topic gate drops most items, so we ingest more raw to
 * end up with a usable harvest. ~150 items takes ~60-90s on the lite actor.
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

/**
 * Topic gate: only ingest content that mentions at least one Shopify-pain
 * term. Without this gate, the classifier wastes API calls (and the dashboard
 * fills) with generic ecommerce chatter — sales, shipping, TikTok Shop fees,
 * spreadsheets — which has zero strategic value to DisputeDesk.
 *
 * Word-boundary matched, case-insensitive. Very generous with synonyms and
 * common misspellings since Reddit posters write casually. False positives
 * (like the literal word "shopify" alone) are tolerated because they're rare
 * outside genuine Shopify-merchant context, and the classifier catches them.
 */
const SHOPIFY_PAIN_TERMS: RegExp[] = [
  // Disputes / chargebacks
  /\bchargeback(s|ed|ing)?\b/i,
  /\bcharge[- ]back(s|ed|ing)?\b/i,
  /\bdispute(s|d|ing)?\b/i,
  /\brepresentment\b/i,
  /\bfriendly[- ]?fraud\b/i,
  /\binquiry\b/i,
  /\bretrieval\b/i,
  // Shopify Payments mechanics
  /\b(shopify[- ]?)?payouts?\b/i,
  /\b(rolling[- ])?reserve(s)?\b/i,
  /\bfunds (held|frozen|on hold)\b/i,
  /\bhigh[- ]?risk\b/i,
  /\bpayout (hold|frozen|delayed)\b/i,
  /\bshopify protect\b/i,
  // Evidence / representment vocabulary
  /\bevidence pack\b/i,
  /\bavs\b/i,
  /\bcvv\b/i,
  /\b3[- ]?d[- ]?secure\b/i,
  /\b3ds\b/i,
  /\bissuer (rejected|won|lost)\b/i,
  // INR / fulfillment
  /\bitem not received\b/i,
  /\bINR\b/,
  /\bproduct not received\b/i,
  /\bnot as described\b/i,
  // Competitor mentions
  /\bchargeflow\b/i,
  /\bdisputifier\b/i,
  /\bchargepay\b/i,
  /\bjustt\b/i,
  /\bmidigator\b/i,
  /\bsignifyd\b/i,
  /\briskified\b/i,
  /\bnofraud\b/i,
  // Generic dispute-tooling intent
  /\bchargeback (app|tool|software|service|management|prevention|automation)\b/i,
  /\bfraud (prevention|detection|filter)\b/i,
  /\bdispute (app|tool|software|service|management)\b/i,
];

function passesShopifyPainGate(text: string): boolean {
  if (!text) return false;
  return SHOPIFY_PAIN_TERMS.some((re) => re.test(text));
}

/**
 * Shopify context gate. Per user direction, every ingested item must be
 * unambiguously about Shopify — either by explicit literal mention in the
 * text, or by being posted in an unambiguously-Shopify subreddit
 * (r/shopify). r/ecommerce and r/Dropship posts pass only when they
 * mention Shopify literally; otherwise they're generic ecommerce chatter
 * that happens to discuss disputes.
 */
const SHOPIFY_LITERAL = /\bshopify\b/i;
const SHOPIFY_SUBREDDIT = /^r\/shopify$/i;

function isShopifyContext(
  text: string,
  subreddit: string | null
): boolean {
  if (subreddit && SHOPIFY_SUBREDDIT.test(subreddit)) return true;
  return SHOPIFY_LITERAL.test(text);
}

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

  // Quality filters — intentional drops, not errors. The classifier's
  // source_confidence_score catches low-signal content downstream too,
  // but cheap pre-filtering at ingest reduces classifier API spend.
  const author = pickString(d, ["username", "user", "author"]);
  if (author && BOT_AUTHORS.has(author)) return { kind: "filtered" };
  if (looksLikeAutomod(title ?? "")) return { kind: "filtered" };
  if (looksLikeAutomod(content)) return { kind: "filtered" };

  // Truly empty content is useless. Short snippets ("$50k/mo", "same here")
  // can still be informative, so the threshold is intentionally low.
  if (!isComment && !title && content.trim().length < 4) return { kind: "filtered" };
  if (isComment && content.trim().length < 4) return { kind: "filtered" };

  // Note: no upvote-score filter for comments. Reddit's vote-count fuzzing
  // shows 0/1 for most fresh content, and minority-opinion comments often
  // sit at 0–1 even when they carry the most useful pain signal. Let the
  // classifier sort signal from noise.

  // Shopify context gate — must mention Shopify literally OR be posted in
  // r/shopify. Without this, r/ecommerce posts about Stripe chargebacks etc.
  // would slip through.
  const topicBlob = `${title ?? ""}\n${content}`;
  if (!isShopifyContext(topicBlob, subreddit)) return { kind: "filtered" };

  // Topic gate — drop generic Shopify chatter (sales/shipping/etc.) that
  // doesn't mention any Shopify-merchant-pain term. Saves classifier API
  // spend and stops the dashboard filling with off-topic noise.
  if (!passesShopifyPainGate(topicBlob)) return { kind: "filtered" };

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
