# Troubleshooting

## Disputes list is empty ("No disputes found")

Disputes are **per store**. The list shows only disputes for the **store currently selected** in the sidebar (e.g. "dispute-ops-test.my...").

1. **Check the store**  
   Click the store name in the sidebar. If you have multiple stores, switch to the one where you expect to see disputes. The disputes table refreshes for the selected store.

2. **Sync from Shopify**  
   Click **Sync Now** on the Disputes page. That fetches disputes from Shopify for the selected store and saves them in DisputeDesk.  
   - If the message includes a store domain (e.g. `dispute-ops-test.myshopify.com`), confirm that is the store where you expect disputes.  
   - The API only returns **Shopify Payments** disputes. Disputes from other payment providers (Stripe, PayPal, etc.) are not synced.  
   - If you see "This store isn't connected for syncing", use **Reconnect this store** (or **Clear shop & reconnect**) and re-authorize so DisputeDesk can call the Shopify API.

3. **Environment / database**  
   If you recently changed `.env` (e.g. after recovering from a lost file), confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` point to the same Supabase project as before. A different project will have different (or no) data.

---

# Recovering .env.local

If `.env.local` was overwritten (e.g. by `vercel env pull`), you can rebuild it using this checklist. **Never commit `.env.local`** — it is gitignored.

## 1. Use the template

```bash
cp .env.example .env.local
```

Then fill in values below. Optional vars can be left empty if you don’t use that feature.

## 2. Where to get each value

| Variable | Where to get it | Required |
|----------|-----------------|----------|
| **SHOPIFY_API_KEY** | Shopify Partner Dashboard → App → Client ID | Yes (for Shopify app) |
| **SHOPIFY_API_SECRET** | Shopify Partner Dashboard → App → Client secret | Yes |
| **SHOPIFY_APP_URL** | Your production URL (e.g. `https://yourapp.vercel.app`) | Yes |
| **SHOPIFY_SCOPES** | Copy from .env.example or adjust as needed | No (has default) |
| **SHOPIFY_API_VERSION** | Usually keep `2026-01` | No |
| **SUPABASE_URL** | Supabase project → Settings → API → Project URL | Yes |
| **SUPABASE_ANON_KEY** | Supabase project → Settings → API → anon public | Yes |
| **SUPABASE_SERVICE_ROLE_KEY** | Supabase project → Settings → API → service_role | Yes (server) |
| **TOKEN_ENCRYPTION_KEY_V1** | Generate 32 bytes, hex-encode (e.g. `openssl rand -hex 32`) | Yes (for auth tokens) |
| **TOKEN_ENCRYPTION_KEY** | Set to same value as TOKEN_ENCRYPTION_KEY_V1 | Yes |
| **CRON_SECRET** | Any long random string (for cron/auth) | Yes (if using cron) |
| **ADMIN_SECRET** | Your chosen password for /admin login | Optional |
| **RESEND_API_KEY** | Resend.com API key (for emails) | Optional |
| **EMAIL_FROM** | Verified sender (e.g. DisputeDesk &lt;...@mail.disputedesk.app&gt;) | Optional |
| **NEXT_PUBLIC_APP_URL** | Same as SHOPIFY_APP_URL for email links | Optional |
| **E2E_TEST_EMAIL** | Portal user email for Playwright E2E | Optional (tests only) |
| **E2E_TEST_PASSWORD** | That user’s password | Optional (tests only) |
| **LOG_LEVEL** | `debug` or `info` | Optional |
| **SENTRY_DSN** | Sentry project DSN | Optional |

Note: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are **not** set in `.env.local` — Next.js fills them from `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `next.config.js`.

## 3. Pull from Vercel (optional)

If the project is linked and you want to match production env (then add local-only overrides):

```bash
cp .env.local .env.local.backup   # backup first
vercel env pull .env.local        # overwrites .env.local with Vercel values
# Then re-add any local-only vars (e.g. E2E_TEST_*, LOG_LEVEL) from .env.local.backup
```

## 4. Avoid overwriting next time

- Before running `vercel env pull`, run: `cp .env.local .env.local.backup`
- Or keep a list of env var names and where you store the secrets (e.g. password manager) so you can recreate `.env.local` anytime.
