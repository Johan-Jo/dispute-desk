/**
 * Release check: ensure NEXT_PUBLIC_SHOPIFY_APP_STORE_URL returns HTTP success when set.
 * Loads .env.local like other scripts. Exits 0 if unset (fallback sign-up is used in app).
 *
 * Usage: npm run verify:app-store-url
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim();
if (!url) {
  console.log(
    "NEXT_PUBLIC_SHOPIFY_APP_STORE_URL is unset — skipping (app uses /auth/sign-up fallback)."
  );
  process.exit(0);
}

const res = await fetch(url, {
  method: "GET",
  redirect: "follow",
  headers: { "user-agent": "DisputeDesk-verify-app-store-url/1.0" },
});

if (!res.ok) {
  console.error(`FAIL: ${url} → ${res.status} ${res.statusText}`);
  process.exit(1);
}

console.log(`OK: ${url} → ${res.status}`);
process.exit(0);
