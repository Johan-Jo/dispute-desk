# Real dispute generator (test mode)

This script creates **real** Shopify Payments test-mode orders via **storefront checkout** using Shopify’s **disputed transaction test card**. Those orders become real chargebacks in **Shopify Payments → Disputes**, so you can test evidence flows end-to-end.

**Important:**

- Run only on stores with **Shopify Payments Test Mode** enabled.
- The test card `4000…0259` is Shopify’s [disputed transaction test card](https://shopify.dev/docs/payments/shopify-payments/testing/test-mode#test-cards); the transaction will appear as a dispute.
- **Do not buy shipping labels** for these orders; they are for testing only.

## Acknowledging test mode

You must explicitly acknowledge that you are running in test mode:

- Set **`SHOPIFY_PAYMENTS_TEST_MODE_ACK=true`** in your environment, or  
- Pass **`--i-know-this-is-test-mode`** on the command line.

Without this, the script exits with a clear message.

## Requirements

- **Node 18+**
- **Puppeteer** (installed via `npm install`; see `package.json`)
- **Tagging orders** after checkout: use the same app as `seed:shopify` — put **SHOPIFY_CLIENT_ID** (or SHOPIFY_API_KEY) and **SHOPIFY_API_SECRET** in `.env.local` and have the app **installed on the store**. No separate app or token needed. Alternatively you can set `SHOPIFY_ADMIN_TOKEN` or pass `--admin-token`.
- Store must have at least one **product** (use product handle or variant ID)
- **Shopify Payments** enabled in **test mode** on the store

## Command examples

```bash
# One order, product by handle (recommended)
npm run seed:real-disputes -- --shop surasvenne.myshopify.com --product-handle my-product --i-know-this-is-test-mode

# Three orders, variant ID, visible browser
npm run seed:real-disputes -- --shop surasvenne.myshopify.com --variant-id 41234567890 --count 3 --headless false --i-know-this-is-test-mode

# With storefront password
npm run seed:real-disputes -- --shop mystore.myshopify.com --product-handle my-product --storefront-password mypass --i-know-this-is-test-mode

# Using env for ack and token (no flag)
SHOPIFY_PAYMENTS_TEST_MODE_ACK=true npm run seed:real-disputes -- --shop surasvenne.myshopify.com --product-handle seed-product-1
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--shop` | (required) | Store domain, e.g. `surasvenne.myshopify.com` |
| `--product-handle` | — | Product handle (e.g. from `/products/{handle}`). Use one of this or `--variant-id`. |
| `--variant-id` | — | Variant ID for cart permalink. Use one of this or `--product-handle`. |
| `--count` | 1 | Number of orders to place. |
| `--headless` | true | Run browser headless (`false` to see the window). |
| `--run-id` | auto | Run identifier; used in tags and artifact folder. |
| `--tag` | dd-real-dispute | Tag to add to orders (plus `dd-run:<runId>`, `dd-seq:<i>`). |
| `--quantity` | 1 | Quantity per order. |
| `--storefront-password` | (env: STOREFRONT_PASSWORD) | Password if storefront is password-protected. |
| `--i-know-this-is-test-mode` | — | Acknowledge test mode (or set `SHOPIFY_PAYMENTS_TEST_MODE_ACK=true`). |
| `--admin-token` | (env: SHOPIFY_ADMIN_TOKEN) | Admin API token for tagging. |
| `--api-version` | 2026-01 | Shopify Admin API version. |
| `--timeout-ms` | 60000 | Timeout for navigation and actions. |
| `--storefront-url` | (env: SHOPIFY_STOREFRONT_DOMAIN) | Storefront base URL for product/checkout (e.g. `https://surasvenne.myshopify.com`). If not set, uses `https://{--shop}`. |

## Artifacts

- **Run JSON:** `artifacts/real-disputes/<runId>.json`  
  Contains `runId`, `shop`, `startedAt`, `countRequested`, `results[]`, and `summary`.

- **On failure:** For each failed order the script saves:
  - `artifacts/real-disputes/<runId>/fail-<seq>.png` (screenshot)
  - `artifacts/real-disputes/<runId>/fail-<seq>.html` (page HTML)  
  The same run’s JSON includes error details and stack for failed items.

- **Step screenshots (when `--headless false`):** Saves `step-<seq>-<name>.png` at each major step in `artifacts/real-disputes/<runId>/` for debugging (e.g. after-password, product-page, after-add-to-cart, checkout-page, before-pay-button, after-pay).

## Password-protected storefronts

If the storefront is password-protected, the script submits the password on the product (or cart) page. After submit, Shopify may redirect to the homepage; the script detects this and **navigates back to the product page** so Add to cart is available. The password is re-submitted on checkout if the gate appears there.

## Order tagging

After each successful checkout, the script finds the order in the Admin API (by email and creation time) and adds tags:

- `dd-real-dispute` (or your `--tag`)
- `dd-run:<runId>`
- `dd-seq:<seq>`

Search is retried with backoff for up to ~60s if the order is not immediately visible.

## Browser stability (crashes)

**Chrome crashing is the most common issue.** The checkout page (many iframes, payment scripts) can crash the browser, especially with `--headless false` on Windows. Filling all required fields correctly (contact email, delivery address and phone, card number, expiration, security code) reduces validation errors and reflows that can trigger crashes.

**To reduce crashes:**

1. **Use installed Chrome (default)** – The script **prefers your installed [Chrome](https://www.google.com/chrome/)** over Puppeteer’s bundled Chromium. If Chrome is installed, it is used automatically; if launch fails, the script falls back to Chromium. To force bundled Chromium instead, set `USE_SYSTEM_CHROME=false` in `.env.local`.
2. **Run headless when you don’t need to watch** – `--headless true` (default) avoids GPU/window rendering and is usually more stable.
3. **One order at a time** – Use `--count 1` while debugging. When placing multiple orders, the script adds a short delay between browser runs.

The script uses stability-related launch flags (e.g. `--disable-gpu`, `--disable-dev-shm-usage`). If crashes persist, run headless or ensure contact/delivery and payment fields (including a valid test phone and expiration date) are filled so the form does not stay in a validation error state.

## Known limitations

- **Checkout UI variance:** Store themes and Shopify checkout versions differ; selectors may need adjustment for some stores.
- **CAPTCHA / 3D Secure:** If the store or payment provider shows CAPTCHA or 3DS, the script cannot complete payment automatically.
- **Iframes:** Card fields are often in iframes; the script tries common patterns but some custom checkouts may need script changes.
- **Rate limits:** Placing many orders in a short time may hit store or Shopify limits.
