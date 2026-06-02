# Signal Radar — Reddit Proxy (Cloudflare Worker)

Reddit blocks **unauthenticated** `.json` scraping from datacenter IPs. As of
2026-05 that block extended to Cloudflare edge IPs too — anonymous
`www.reddit.com/*.json` now returns `403` with an HTML page even from a Worker.

So this Worker no longer scrapes anonymously. It authenticates with Reddit's
official **OAuth API** (app-only `client_credentials` grant — no Reddit user
account, just a registered app's id + secret), caches the bearer token, and
forwards requests to `oauth.reddit.com`. Authenticated traffic is not
IP-blocked the way anonymous `.json` is. Vercel calls the Worker exactly as
before; the Worker rewrites `www.reddit.com/<path>.json` → `oauth.reddit.com/<path>`.

## 0. Create a Reddit app (required for OAuth)

1. Sign in to Reddit, go to <https://www.reddit.com/prefs/apps>.
2. Click **create another app…** (bottom of the page).
3. Fill in:
   - **name:** `disputedesk-signal-radar`
   - **type:** select **script** (or **web app** — both are confidential
     clients with a secret; either works with `client_credentials`).
   - **redirect uri:** `http://localhost:8080` (unused for app-only, but the
     form requires a value).
4. Click **create app**. You now have:
   - **client id** — the short string under the app name (just below "personal use script").
   - **secret** — the `secret` field.

Keep these two values for step 2.

## 1. Deploy the Worker

### Option A — Cloudflare dashboard (no CLI, ~3 minutes)

1. <https://dash.cloudflare.com/> → **Workers & Pages** → **Create**.
2. Choose **Hello World**, name it `signal-radar-reddit-proxy`, **Deploy**.
3. **Edit code** → delete placeholder → paste `worker.js` from this folder → **Deploy**.

### Option B — Wrangler CLI

```bash
cd cloudflare-workers/signal-radar-reddit-proxy
npx wrangler login
npx wrangler deploy
```

The deploy command / dashboard prints the Worker URL
(`https://signal-radar-reddit-proxy.<your-account>.workers.dev`).

## 2. Set the Worker's secrets (Cloudflare)

Add three **encrypted** variables. Dashboard:
**Settings → Variables and Secrets → Add → type Secret**. CLI shown below.

```bash
npx wrangler secret put PROXY_SECRET          # long random string, e.g. openssl rand -hex 32
npx wrangler secret put REDDIT_CLIENT_ID       # the Reddit app's client id (step 0)
npx wrangler secret put REDDIT_CLIENT_SECRET   # the Reddit app's secret (step 0)
```

> If `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are absent, the Worker falls
> back to the **legacy anonymous** `www.reddit.com` fetch — which is currently
> 403-blocked. They are required for the fix to take effect.

## 3. Wire it up to DisputeDesk (Vercel)

Set these on **Vercel** (Production + Preview). These are unchanged from before
— the OAuth lives entirely inside the Worker:

```
REDDIT_PROXY_URL=https://signal-radar-reddit-proxy.<your-account>.workers.dev
REDDIT_PROXY_SECRET=<the same random string you set as PROXY_SECRET in Cloudflare>
```

`REDDIT_USER_AGENT` is optional (defaults to a UA in
`lib/signal-radar/sources/reddit.ts`); it is forwarded to Reddit on both the
token request and the listing requests.

After Vercel redeploys, click **Refresh now** on `/admin/signal-radar`. You
should see non-zero fetched counts and new `reddit` rows.

## Test the Worker directly

```bash
curl -i -H "Authorization: Bearer <your-PROXY_SECRET>" \
  "https://signal-radar-reddit-proxy.<your-account>.workers.dev/?path=/r/shopify/new.json?limit=5&raw_json=1"
```

- `200` + Reddit listing JSON, response header `X-Proxy-Mode: oauth` = **working**.
- `X-Proxy-Mode: anonymous` = OAuth secrets aren't set on the Worker (it fell back).
- `502 Reddit OAuth token fetch failed` = bad/expired `REDDIT_CLIENT_ID/SECRET`.
- `X-Upstream-Status: 403` with `oauth` mode = the Reddit app may be suspended
  or the UA is missing; check the Reddit app status.

## Cost

Cloudflare Workers free tier covers 100,000 requests/day; Signal Radar uses
≤300/day. The added OAuth token fetch is cached in-isolate (~1/hour/isolate).
**Free.**
