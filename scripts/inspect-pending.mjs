#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
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

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("signal_sources").select("id,platform,posted_at,analysis_attempts,analysis_last_error,title").eq("analysis_status", "pending").order("posted_at", { ascending: false });
console.log(`pending count: ${data?.length ?? 0}`);
const now = Date.now();
for (const r of data ?? []) {
  const ageDays = ((now - new Date(r.posted_at).getTime()) / 86400000).toFixed(1);
  const stale = Number(ageDays) > 30 ? " STALE" : "";
  console.log(`  ${r.platform} age=${ageDays}d attempts=${r.analysis_attempts}${stale} err=${(r.analysis_last_error ?? "").slice(0, 80)} ttl=${(r.title ?? "").slice(0, 60)}`);
}
