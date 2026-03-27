/**
 * Search engine notification after content is published.
 * - IndexNow: instant notification to Bing, Yandex, Seznam, Naver.
 * - Google: sitemap ping to trigger re-crawl.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://disputedesk.app";
const INDEXNOW_KEY = process.env.INDEXNOW_KEY;

const LOCALE_PREFIXES: Record<string, string> = {
  "en-US": "",
  "de-DE": "/de",
  "fr-FR": "/fr",
  "es-ES": "/es",
  "pt-BR": "/pt",
  "sv-SE": "/sv",
};

function buildArticleUrl(slug: string, locale: string): string {
  const prefix = LOCALE_PREFIXES[locale] ?? "";
  return `${BASE_URL}${prefix}/resources/${slug}`;
}

async function pingIndexNow(url: string): Promise<void> {
  if (!INDEXNOW_KEY) return;

  try {
    const host = new URL(BASE_URL).host;
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${BASE_URL}/api/indexnow?key=${INDEXNOW_KEY}`,
        urlList: [url],
      }),
    });
    console.log(`[seo] IndexNow pinged for ${url}`);
  } catch (err) {
    console.warn("[seo] IndexNow ping failed:", err instanceof Error ? err.message : err);
  }
}

async function pingGoogleSitemap(): Promise<void> {
  try {
    const sitemapUrl = encodeURIComponent(`${BASE_URL}/sitemap.xml`);
    await fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`);
    console.log("[seo] Google sitemap ping sent");
  } catch (err) {
    console.warn("[seo] Google sitemap ping failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Notify search engines about a newly published article.
 * Non-blocking — failures are logged but don't propagate.
 */
export async function notifySearchEngines(slug: string, locale: string = "en-US"): Promise<void> {
  const url = buildArticleUrl(slug, locale);

  await Promise.allSettled([
    pingIndexNow(url),
    pingGoogleSitemap(),
  ]);
}
