import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","because","been","before","being","but","by","can","could",
  "did","do","does","doing","don","each","few","for","from","further","get","got","had","has",
  "have","having","he","her","here","hers","herself","him","himself","his","how","i","if","in",
  "into","is","it","its","itself","just","like","ll","me","more","most","my","myself","no","nor",
  "not","now","of","off","on","once","only","or","other","our","ours","ourselves","out","over",
  "own","re","s","same","she","should","so","some","such","t","than","that","the","their",
  "theirs","them","themselves","then","there","these","they","this","those","through","to","too",
  "under","until","up","ve","very","was","we","were","what","when","where","which","while","who",
  "whom","why","will","with","would","you","your","yours","yourself","yourselves",
  "edit","update","tldr","tl;dr","op","please","help","anyone","someone","really","actually",
  "thanks","thank","hi","hey","hello","also","still","ever","never","always","maybe","probably",
  "going","getting","make","made","makes","take","took","taken","one","two","three",
]);

const SHOPIFY_PHRASES = [
  "black box","rolling reserve","payout hold","frozen funds","frozen payouts","manual evidence",
  "losing disputes","chargeback nightmare","high risk","support useless","destroying margins",
  "shopify reserve","shopify payments","shopify protect","funds frozen","representment",
  "issuer rejected","avs match","cvv match","3d secure","fraud filter","stripe radar",
  "switching from","alternative to","moving away","better than","tried chargeflow",
  "dispute software","fraud prevention","chargeback management","evidence pack","didn't tell us",
  "no explanation","without telling",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function computeClusterKey(text: string): string {
  if (!text || text.trim().length === 0) return "";

  const tokens = tokenize(text)
    .filter((w) => w.length >= 4)
    .filter((w) => !STOPWORDS.has(w));

  if (tokens.length === 0) return "";

  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  const ranked = [...freq.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });

  const top = ranked.slice(0, 8).map((entry) => entry[0]).sort();
  if (top.length === 0) return "";

  return createHash("sha1").update(top.join("-")).digest("hex").slice(0, 16);
}

interface PhraseCount {
  phrase: string;
  count: number;
}

export function extractPhrases(
  items: Array<{ title: string | null; content: string }>,
  limit = 25
): PhraseCount[] {
  const counts = new Map<string, number>();

  const bumpPhrase = (phrase: string, weight = 1) => {
    if (phrase.length < 4) return;
    counts.set(phrase, (counts.get(phrase) ?? 0) + weight);
  };

  for (const item of items) {
    const blob = `${item.title ?? ""} ${item.content ?? ""}`.toLowerCase();

    for (const phrase of SHOPIFY_PHRASES) {
      if (blob.includes(phrase)) bumpPhrase(phrase, 3);
    }

    const tokens = tokenize(blob).filter(
      (w) => w.length >= 4 && !STOPWORDS.has(w)
    );

    for (const tok of tokens) bumpPhrase(tok, 1);

    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
      bumpPhrase(`${a} ${b}`, 2);
    }

    for (let i = 0; i < tokens.length - 2; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const c = tokens[i + 2];
      if (STOPWORDS.has(a) || STOPWORDS.has(c)) continue;
      bumpPhrase(`${a} ${b} ${c}`, 2);
    }
  }

  return [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

interface ClusterMetrics {
  size_24h: number;
  size_prior_24h: number;
  growth_rate: number | null;
}

export async function computeClusterMetrics(
  sb: SupabaseClient,
  cluster_key: string | null
): Promise<ClusterMetrics> {
  if (!cluster_key) return { size_24h: 0, size_prior_24h: 0, growth_rate: null };

  const now = Date.now();
  const t24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const t48 = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  const [{ count: size_24h }, { count: size_prior_24h }] = await Promise.all([
    sb
      .from("signal_sources")
      .select("*", { count: "exact", head: true })
      .eq("cluster_key", cluster_key)
      .gt("posted_at", t24),
    sb
      .from("signal_sources")
      .select("*", { count: "exact", head: true })
      .eq("cluster_key", cluster_key)
      .gt("posted_at", t48)
      .lte("posted_at", t24),
  ]);

  const cur = size_24h ?? 0;
  const prior = size_prior_24h ?? 0;
  const growth_rate =
    prior === 0 ? null : Math.min(9.99, Number((cur / prior).toFixed(2)));

  return { size_24h: cur, size_prior_24h: prior, growth_rate };
}
