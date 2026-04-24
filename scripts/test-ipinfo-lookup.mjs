/**
 * Quick IPinfo lookup probe — runs the same GET the collector runs.
 * Usage: node scripts/test-ipinfo-lookup.mjs <ip>
 */
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const ip = process.argv[2];
if (!ip) {
  console.error("usage: node scripts/test-ipinfo-lookup.mjs <ip>");
  process.exit(1);
}

const token = process.env.IPINFO_API_KEY;
const url = token
  ? `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`
  : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;

console.log(`GET ${token ? url.replace(token, "<redacted>") : url}`);
if (!token) {
  console.log("(unauthenticated — privacy flags will be absent; this is fine for a geo-only probe)");
}

const started = Date.now();
const res = await fetch(url, { headers: { Accept: "application/json" } });
const elapsed = Date.now() - started;
const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch { /* keep raw */ }

console.log(`\nHTTP ${res.status} (${elapsed}ms)`);
console.log("x-request-id:", res.headers.get("x-request-id"));
console.log("\nbody:");
console.log(json ? JSON.stringify(json, null, 2) : text);
