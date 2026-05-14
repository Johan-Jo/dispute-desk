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
      let v = m[2]; if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch {}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

const { data: cats } = await sb.from("signal_analysis")
  .select("category, signal_score, merchant_relevance, competitor")
  .order("created_at", { ascending: false });

const byCategory = {};
for (const r of cats ?? []) {
  byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
}
console.log("=== Category breakdown (all signal_analysis) ===");
for (const [c, n] of Object.entries(byCategory).sort((a,b) => b[1]-a[1])) {
  console.log("  " + c.padEnd(28) + " " + n);
}

const { data: highSignal } = await sb.from("signal_analysis")
  .select("category, signal_score, competitor, merchant_relevance, summary")
  .gte("signal_score", 5)
  .order("signal_score", { ascending: false })
  .limit(15);

console.log("\n=== Top signal_score >= 5 ===");
for (const r of highSignal ?? []) {
  console.log(`  [${r.category}] sig=${r.signal_score} relevant=${r.merchant_relevance} comp=${r.competitor ?? "-"}`);
  console.log("    " + (r.summary ?? "").slice(0, 150));
}

const { data: competitors } = await sb.from("signal_analysis")
  .select("competitor")
  .not("competitor", "is", null);
const compCount = {};
for (const r of competitors ?? []) compCount[r.competitor] = (compCount[r.competitor] ?? 0) + 1;
console.log("\n=== Competitor mentions ===");
for (const [c, n] of Object.entries(compCount).sort((a,b) => b[1]-a[1])) {
  console.log("  " + c.padEnd(20) + " " + n);
}

const { count: pending } = await sb.from("signal_sources")
  .select("*", { count: "exact", head: true })
  .eq("analysis_status", "pending");
console.log("\nstill pending: " + pending);
