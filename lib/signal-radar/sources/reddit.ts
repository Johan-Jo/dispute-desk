import type { IngestedItem, SignalSourceAdapter } from "./types";

const SUBREDDITS = [
  "shopify",
  "ecommerce",
  "dropshipping",
  "Entrepreneur",
  "smallbusiness",
];

const SUBMISSION_LIMIT = 50;
const COMMENTS_PER_SUBMISSION = 20;
const REDDIT_PUBLIC_BASE = "https://www.reddit.com";
const DEFAULT_USER_AGENT =
  "DisputeDesk-SignalRadar/1.0 (admin-only Shopify-merchant intelligence; contact: oi@johan.com.br)";

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
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

async function fetchSubmissions(sub: string): Promise<RedditSubmission[]> {
  const res = await fetch(
    `${REDDIT_PUBLIC_BASE}/r/${sub}/new.json?limit=${SUBMISSION_LIMIT}&raw_json=1`,
    {
      headers: { "User-Agent": userAgent() },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit listing ${sub} failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const children: RedditListingChild<RedditSubmission>[] =
    json?.data?.children ?? [];
  return children.filter((c) => c.kind === "t3").map((c) => c.data);
}

async function fetchTopLevelComments(
  sub: string,
  postId: string
): Promise<RedditComment[]> {
  const res = await fetch(
    `${REDDIT_PUBLIC_BASE}/r/${sub}/comments/${postId}.json?limit=${COMMENTS_PER_SUBMISSION}&depth=1&sort=top&raw_json=1`,
    {
      headers: { "User-Agent": userAgent() },
    }
  );
  if (!res.ok) return [];
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2) return [];
  const commentTree = json[1];
  const children: RedditListingChild<RedditComment>[] =
    commentTree?.data?.children ?? [];
  return children
    .filter((c) => c.kind === "t1")
    .map((c) => c.data)
    .filter((c) => {
      if (!c || typeof c.body !== "string") return false;
      if (c.body === "[deleted]" || c.body === "[removed]") return false;
      if (c.collapsed === true) return false;
      if ((c.score ?? 0) < 1) return false;
      return true;
    })
    .slice(0, COMMENTS_PER_SUBMISSION);
}

function submissionToItem(sub: RedditSubmission): IngestedItem {
  return {
    platform: "reddit",
    contentType: "submission",
    externalId: sub.name,
    parentExternalId: null,
    subreddit: `r/${sub.subreddit}`,
    url: `https://www.reddit.com${sub.permalink}`,
    author: sub.author ?? null,
    title: sub.title,
    content: sub.selftext ?? "",
    rawPayload: sub,
    postedAt: new Date(sub.created_utc * 1000).toISOString(),
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

export const redditAdapter: SignalSourceAdapter = {
  platform: "reddit",
  async ingest(): Promise<IngestedItem[]> {
    const items: IngestedItem[] = [];

    for (const sub of SUBREDDITS) {
      let submissions: RedditSubmission[] = [];
      try {
        submissions = await fetchSubmissions(sub);
      } catch (err) {
        console.warn(`[signal-radar] reddit ${sub} listing error:`, err);
        continue;
      }

      for (const s of submissions) {
        items.push(submissionToItem(s));
        try {
          const comments = await fetchTopLevelComments(sub, s.id);
          for (const c of comments) items.push(commentToItem(c));
        } catch (err) {
          console.warn(`[signal-radar] reddit ${sub}/${s.id} comments error:`, err);
        }
      }
    }

    return items;
  },
};
