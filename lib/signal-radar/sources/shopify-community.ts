/**
 * Shopify Community adapter — official Shopify forum at community.shopify.com.
 *
 * Powered by Discourse. Public JSON endpoints (no auth, no IP block on Vercel
 * — confirmed by spike before implementation): `/latest.json`, `/top.json`.
 * Each call returns 30 topics with title, slug, excerpt, posted_at,
 * category_id, tags, last_poster_username, etc.
 *
 * For full body text we'd need to GET /t/{slug}/{id}.json per topic, but the
 * `excerpt` field is enough for the topic gate + classifier in M1.5. Full
 * fetch is a later optimization if signal_score quality plateaus.
 *
 * The forum is implicitly Shopify-context (the entire domain is Shopify), so
 * the Shopify-literal gate is bypassed — but the pain-term gate still applies
 * to weed out generic Shopify operational chat (marketing, theme questions,
 * etc.) that has zero strategic value to DisputeDesk.
 */
import { applyIngestGates } from "./utils";
import type {
  IngestedItem,
  IngestResult,
  SignalSourceAdapter,
} from "./types";

const COMMUNITY_BASE = "https://community.shopify.com";
const USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (+https://disputedesk.app; admin-only intelligence)";

/**
 * Endpoints to harvest each run. Three views give broad coverage:
 *   latest             — newest topics (catch fresh pain)
 *   top daily          — highest-engagement today (what merchants are reacting to)
 *   top weekly         — highest-engagement this week (catches older actively-discussed)
 */
const ENDPOINTS: string[] = [
  "/latest.json",
  "/top.json?period=daily",
  "/top.json?period=weekly",
];

interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  created_at: string;
  bumped_at: string | null;
  last_poster_username: string | null;
  category_id: number;
  tags?: Array<string | { name?: string }>;
  closed: boolean;
  archived: boolean;
  pinned: boolean;
  pinned_globally: boolean;
}

interface DiscourseLatestResponse {
  topic_list?: {
    topics?: DiscourseTopic[];
  };
}

/**
 * Discourse excerpts arrive HTML-escaped with stripped formatting. Decode the
 * common entities and remove any leftover tags before passing to the gates.
 */
function decodeExcerpt(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapTopic(t: DiscourseTopic): IngestedItem | null {
  if (t.closed || t.archived) return null;
  if (t.pinned_globally) return null;

  const title = t.title;
  const content = decodeExcerpt(t.excerpt);

  const rejected = applyIngestGates({
    author: t.last_poster_username,
    title,
    content,
    implicitShopifyContext: true,
  });
  if (rejected) return null;

  return {
    platform: "shopify_community",
    contentType: "submission",
    externalId: `sc_${t.id}`,
    parentExternalId: null,
    subreddit: null,
    url: `${COMMUNITY_BASE}/t/${t.slug}/${t.id}`,
    author: t.last_poster_username,
    title,
    content,
    rawPayload: t,
    postedAt: t.created_at,
  };
}

export const shopifyCommunityAdapter: SignalSourceAdapter = {
  platform: "shopify_community",
  async ingest(): Promise<IngestResult> {
    const items: IngestedItem[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();

    for (const endpoint of ENDPOINTS) {
      let res: Response;
      try {
        res = await fetch(`${COMMUNITY_BASE}${endpoint}`, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        });
      } catch (err) {
        errors.push(
          `community ${endpoint}: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        errors.push(
          `community ${endpoint}: HTTP ${res.status}: ${body.slice(0, 200)}`
        );
        continue;
      }

      let json: DiscourseLatestResponse;
      try {
        json = (await res.json()) as DiscourseLatestResponse;
      } catch {
        errors.push(`community ${endpoint}: non-JSON response`);
        continue;
      }

      const topics = json?.topic_list?.topics ?? [];
      for (const t of topics) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const item = mapTopic(t);
        if (item) items.push(item);
      }
    }

    console.info(
      `[signal-radar] shopify-community ingested=${items.length} errors=${errors.length}`
    );

    return { items, errors };
  },
};
