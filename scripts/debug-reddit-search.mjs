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

const proxyRaw = process.env.REDDIT_PROXY_URL;
const proxySecret = process.env.REDDIT_PROXY_SECRET ?? process.env.PROXY_SECRET;
if (!proxyRaw || !proxySecret) {
  console.error("missing REDDIT_PROXY_URL / PROXY_SECRET");
  process.exit(1);
}
let proxyUrl = proxyRaw.trim();
if (!/^https?:\/\//i.test(proxyUrl)) proxyUrl = `https://${proxyUrl}`;
proxyUrl = proxyUrl.replace(/\/$/, "");

const paths = [
  "/r/Stripe/search.json?q=chargeback&restrict_sr=1&sort=new&t=month&limit=10&raw_json=1",
  "/r/Stripe/top.json?t=month&limit=10&raw_json=1",
  "/r/Stripe/new.json?limit=10&raw_json=1",
];

for (const path of paths) {
  const url = `${proxyUrl}?path=${encodeURIComponent(path)}`;
  console.log(`\n=== ${path} ===`);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${proxySecret}`,
        "X-Reddit-UA": "DisputeDesk-debug/1.0",
      },
    });
    console.log(`HTTP ${res.status}`);
    const text = await res.text();
    if (!res.ok) {
      console.log(`body (first 300): ${text.slice(0, 300)}`);
      continue;
    }
    let json;
    try { json = JSON.parse(text); } catch { console.log("non-JSON"); continue; }
    const children = json?.data?.children ?? [];
    console.log(`got ${children.length} children`);
    for (const c of children.slice(0, 5)) {
      const d = c.data;
      const ageDays = ((Date.now() - d.created_utc * 1000) / 86400000).toFixed(1);
      console.log(`  ${d.id} [${ageDays}d] r/${d.subreddit}: ${d.title?.slice(0, 80)}`);
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
