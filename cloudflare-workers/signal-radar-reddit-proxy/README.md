# Signal Radar — Reddit Proxy (Cloudflare Worker)

Reddit blocks Vercel/AWS/GCP datacenter IPs on its public `.json` endpoints.
This tiny Worker runs on Cloudflare's CDN edge (different IP class) and
proxies our requests through. Vercel calls the Worker; the Worker
calls Reddit; Reddit answers.

## Two ways to deploy

### Option 1 — Cloudflare dashboard (no CLI, ~3 minutes)

1. Go to <https://dash.cloudflare.com/> → **Workers & Pages** → **Create**.
2. Choose **Hello World**. Name it `signal-radar-reddit-proxy`. Click **Deploy**.
3. After deploy: click **Edit code**.
4. Delete the placeholder code, paste the contents of `worker.js` from this folder, click **Deploy**.
5. **Settings → Variables → Variables and Secrets** → **Add variable**:
   - Type: **Secret** (encrypted)
   - Name: `PROXY_SECRET`
   - Value: a long random string (e.g. `openssl rand -hex 32`)
   - Click **Save and deploy**.
6. Copy the Worker URL (looks like `https://signal-radar-reddit-proxy.<your-account>.workers.dev`).

### Option 2 — Wrangler CLI

```bash
cd cloudflare-workers/signal-radar-reddit-proxy
npx wrangler login
npx wrangler secret put PROXY_SECRET   # paste your random secret when prompted
npx wrangler deploy
```

The deploy command prints the Worker URL.

## Wire it up to DisputeDesk

Set these on **Vercel** (Production + Preview environments):

```
REDDIT_PROXY_URL=https://signal-radar-reddit-proxy.<your-account>.workers.dev
REDDIT_PROXY_SECRET=<the same random string you set as PROXY_SECRET in Cloudflare>
```

The `REDDIT_USER_AGENT` env is optional (defaults to a hard-coded UA in
`lib/signal-radar/sources/reddit.ts`).

After Vercel redeploys, click **Refresh now** on `/admin/signal-radar`.
You should see non-zero `fetched_submissions` / `fetched_comments` in the
status banner. If you still get 403s, the `X-Upstream-Status` header on
the Worker response will tell you what Reddit returned.

## Test the Worker directly

```bash
curl -H "Authorization: Bearer <your-secret>" \
  "https://signal-radar-reddit-proxy.<your-account>.workers.dev/?path=/r/shopify/new.json?limit=5&raw_json=1"
```

Should return Reddit's listing JSON. Status 200 = working. 403 with HTML body = Cloudflare's IPs are blocked too (rare); fall back to Apify.

## Cost

Cloudflare Workers free tier covers 100,000 requests/day. Signal Radar
uses ≤300/day worst-case. **Free.**
