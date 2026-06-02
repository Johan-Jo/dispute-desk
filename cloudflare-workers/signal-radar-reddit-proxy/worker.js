/**
 * Signal Radar — Reddit Proxy (Cloudflare Worker)
 *
 * Reddit blocks unauthenticated `.json` scraping from datacenter IPs —
 * Vercel/AWS/GCP AND, as of 2026-05, Cloudflare edge IPs too (anonymous
 * www.reddit.com/*.json now returns 403 with an HTML block page even from
 * Workers). The durable fix is to stop scraping anonymously and instead use
 * Reddit's official OAuth API: authenticated traffic to oauth.reddit.com is
 * not IP-blocked the way anonymous .json is.
 *
 * This Worker obtains an **app-only** bearer token (OAuth2 client_credentials
 * grant — no Reddit user account needed, just a registered app's id+secret),
 * caches it in-isolate until ~expiry, and forwards listing/comment requests
 * to oauth.reddit.com with that token. Vercel calls this Worker exactly as
 * before (`?path=/r/shopify/new.json?...`), so no app-side change is needed —
 * the Worker rewrites `www.reddit.com/<path>.json` → `oauth.reddit.com/<path>`.
 *
 * Auth (Vercel → Worker): shared secret in `Authorization: Bearer ...`,
 *   set as encrypted Cloudflare var `PROXY_SECRET` (mirrors Vercel's
 *   `REDDIT_PROXY_SECRET`).
 *
 * Reddit OAuth (Worker → Reddit): set encrypted Cloudflare vars
 *   `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` from a Reddit app
 *   (https://www.reddit.com/prefs/apps → "create app" → type "script" or
 *   "web app"). When these are absent the Worker falls back to the legacy
 *   anonymous www.reddit.com fetch (works only from un-blocked IPs / local).
 *
 * Path whitelist: only `/r/` and `/comments/` paths, so the Worker can't be
 * repurposed as a generic open proxy.
 */

// In-isolate token cache. Cloudflare reuses an isolate across many requests,
// so this avoids fetching a fresh token on every call. Tokens last ~1h; we
// refresh 60s early. Not shared across isolates — worst case is a few extra
// token fetches, which is fine (Reddit allows them).
let tokenCache = null; // { token: string, expiresAt: number(ms) }

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const expected = env.PROXY_SECRET;
    if (!expected) {
      return json({ error: "Worker misconfigured (no PROXY_SECRET)" }, 500);
    }
    if ((request.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const rawPath = url.searchParams.get("path");
    if (!rawPath) return json({ error: "Missing ?path=" }, 400);

    // Whitelist: only Reddit listing/comment paths.
    if (!/^\/(r|comments)\//.test(rawPath)) {
      return json({ error: "Path not allowed" }, 400);
    }

    const userAgent =
      request.headers.get("x-reddit-ua") ??
      "DisputeDesk-SignalRadar/1.0 (cloudflare-worker proxy)";

    const hasOAuth = Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);

    // ---- Legacy anonymous path (no OAuth creds configured) ----
    if (!hasOAuth) {
      return passthrough(`https://www.reddit.com${rawPath}`, userAgent, null);
    }

    // ---- OAuth path: rewrite www.reddit.com/<x>.json → oauth.reddit.com/<x> ----
    const target = `https://oauth.reddit.com${stripJsonSuffix(rawPath)}`;

    let token;
    try {
      token = await getAppToken(env, userAgent);
    } catch (err) {
      return json({ error: `Reddit OAuth token fetch failed: ${String(err)}` }, 502);
    }

    let res = await passthrough(target, userAgent, token);
    // A 401 means the cached token went stale (rotated/revoked early) — drop
    // the cache, mint a fresh one, and retry exactly once.
    if (res.status === 401) {
      tokenCache = null;
      try {
        token = await getAppToken(env, userAgent);
      } catch (err) {
        return json({ error: `Reddit OAuth re-auth failed: ${String(err)}` }, 502);
      }
      res = await passthrough(target, userAgent, token);
    }
    return res;
  },
};

/** Fetch a Reddit endpoint and stream the body back, preserving status. */
async function passthrough(targetUrl, userAgent, bearer) {
  const headers = { "User-Agent": userAgent, Accept: "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers,
      cf: { cacheTtl: 60, cacheEverything: false },
    });
  } catch (err) {
    return json({ error: `Upstream fetch failed: ${String(err)}` }, 502);
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "X-Upstream-Status": String(upstream.status),
      "X-Proxy-Mode": bearer ? "oauth" : "anonymous",
    },
  });
}

/**
 * App-only OAuth2 token (client_credentials grant). Cached in-isolate until
 * ~60s before expiry. Confidential client (id+secret) is required — this is
 * a "script" or "web app" type Reddit app, not an "installed" (public) one.
 */
async function getAppToken(env, userAgent) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("no access_token in response");
  }
  const ttlMs = (Number(data.expires_in) || 3600) * 1000;
  tokenCache = { token: data.access_token, expiresAt: now + ttlMs - 60_000 };
  return tokenCache.token;
}

/**
 * oauth.reddit.com uses the bare endpoint (no `.json` suffix); strip it from
 * the path segment while preserving the query string.
 *   /r/shopify/new.json?limit=25         → /r/shopify/new?limit=25
 *   /r/shopify/search.json?q=chargeback  → /r/shopify/search?q=chargeback
 */
function stripJsonSuffix(rawPath) {
  const qIdx = rawPath.indexOf("?");
  const pathPart = qIdx === -1 ? rawPath : rawPath.slice(0, qIdx);
  const query = qIdx === -1 ? "" : rawPath.slice(qIdx);
  return `${pathPart.replace(/\.json$/, "")}${query}`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
