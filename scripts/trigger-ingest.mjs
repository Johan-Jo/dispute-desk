#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
for (const f of [".vercel/prod.env", ".env.local", ".env"]) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const BASE = process.env.PROD_BASE_URL ?? "https://disputedesk.app";
const url = `${BASE}/api/cron/signal-radar-reddit`;
console.log(`Hitting ${url} ...`);
const t0 = Date.now();
// Node's default fetch headers timeout is 300s; the ingest can exceed that
// with the expanded URL set, so use undici Agent with a longer timeout.
const { Agent, fetch: undiciFetch } = await import("undici");
const agent = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});
const res = await undiciFetch(url, {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  dispatcher: agent,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const text = await res.text();
console.log(`${res.status} in ${elapsed}s`);
try {
  const json = JSON.parse(text);
  console.log("by_platform:", JSON.stringify(json.by_platform));
  console.log("totals:", `fetched=${json.fetched} inserted=${json.inserted} errors=${json.errors?.length ?? 0}`);
  if (json.errors?.length) {
    console.log("errors:");
    for (const e of json.errors) console.log("  -", e.slice(0, 200));
  }
} catch {
  console.log("non-JSON body:", text.slice(0, 400));
}
