#!/usr/bin/env node
/**
 * Show the raw_payload of a few signal_sources rows to debug Apify field shapes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch {}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { count } = await sb
  .from("signal_sources")
  .select("*", { count: "exact", head: true });
console.log(`Total signal_sources: ${count}`);

const { data: subs } = await sb
  .from("signal_sources")
  .select("content_type, author, title, content, raw_payload")
  .eq("content_type", "submission")
  .order("ingested_at", { ascending: false })
  .limit(2);
console.log("\n=== Sample submission raw_payload keys ===");
if (subs?.[0]) {
  console.log("Keys:", Object.keys(subs[0].raw_payload).sort());
  console.log("\nFull payload (first row):");
  console.log(JSON.stringify(subs[0].raw_payload, null, 2).slice(0, 3000));
}

const { data: comments } = await sb
  .from("signal_sources")
  .select("content_type, author, title, content, raw_payload")
  .eq("content_type", "comment")
  .order("ingested_at", { ascending: false })
  .limit(1);
console.log("\n=== Sample comment raw_payload keys ===");
if (comments?.[0]) {
  console.log("Keys:", Object.keys(comments[0].raw_payload).sort());
  console.log("\nFull payload:");
  console.log(JSON.stringify(comments[0].raw_payload, null, 2).slice(0, 2000));
}
