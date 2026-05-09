/**
 * Signal Radar — Reddit Proxy (Cloudflare Worker)
 *
 * Reddit blocks Vercel/AWS/GCP datacenter IPs on public .json endpoints.
 * This Worker runs on Cloudflare's CDN edge (different IP class), which
 * Reddit treats more permissively. Vercel calls this Worker; the Worker
 * fetches Reddit; Reddit answers; the Worker returns the body.
 *
 * Auth: shared secret in `Authorization: Bearer ...` header.
 *       Set the secret via Cloudflare dashboard → Workers → Settings →
 *       Variables → Add encrypted variable `PROXY_SECRET`. The same
 *       value goes on Vercel as `REDDIT_PROXY_SECRET`.
 *
 * Usage from Vercel:
 *   GET https://<name>.<account>.workers.dev/?path=/r/shopify/new.json?limit=50&raw_json=1
 *   Authorization: Bearer ${REDDIT_PROXY_SECRET}
 *   X-Reddit-UA: <your user agent>
 *
 * Path whitelist: only `/r/` and `/comments/` Reddit paths allowed,
 * keeps the Worker from being repurposed as a generic open proxy.
 */
export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const auth = request.headers.get("authorization") ?? "";
    const expected = env.PROXY_SECRET;
    if (!expected) {
      return json({ error: "Worker misconfigured (no PROXY_SECRET)" }, 500);
    }
    if (auth !== `Bearer ${expected}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const rawPath = url.searchParams.get("path");
    if (!rawPath) return json({ error: "Missing ?path=" }, 400);

    // Whitelist: only Reddit listing/comment paths
    if (!/^\/(r|comments)\//.test(rawPath)) {
      return json({ error: "Path not allowed" }, 400);
    }

    const userAgent =
      request.headers.get("x-reddit-ua") ??
      "DisputeDesk-SignalRadar/1.0 (cloudflare-worker proxy)";

    const targetUrl = `https://www.reddit.com${rawPath}`;
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        // Cache lightly at the edge — 60s is generous given 5-min cron cadence
        cf: { cacheTtl: 60, cacheEverything: false },
      });
    } catch (err) {
      return json({ error: `Upstream fetch failed: ${String(err)}` }, 502);
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "X-Upstream-Status": String(upstream.status),
      },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
