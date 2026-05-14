#!/usr/bin/env node
// Hit r/Stripe/search.json?q=chargeback directly (reddit.com, no proxy)
// and look for 1srehdo + 1t61ds8 in results.
const url = "https://www.reddit.com/r/Stripe/search.json?q=chargeback&restrict_sr=1&sort=new&t=month&limit=25&raw_json=1";
console.log(`Fetching ${url}\n`);
const res = await fetch(url, { headers: { "User-Agent": "DisputeDesk-debug/1.0" } });
console.log(`HTTP ${res.status}`);
const json = await res.json();
const children = json?.data?.children ?? [];
console.log(`got ${children.length} results\n`);

const targets = new Set(["1srehdo", "1t61ds8"]);
const found = new Set();
for (const c of children) {
  const d = c.data;
  const ageDays = ((Date.now() - d.created_utc * 1000) / 86400000).toFixed(1);
  const flag = targets.has(d.id) ? " *** TARGET ***" : "";
  if (targets.has(d.id)) found.add(d.id);
  console.log(`  ${d.id} [${ageDays}d] r/${d.subreddit}: ${d.title?.slice(0, 75)}${flag}`);
}
console.log(`\nTargets found: ${[...found].join(", ") || "none"}`);
console.log(`Targets missing: ${[...targets].filter(t => !found.has(t)).join(", ") || "none"}`);
