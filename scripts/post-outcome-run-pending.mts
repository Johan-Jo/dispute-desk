/**
 * Runs the post-outcome sweep (the same code as /api/cron/post-outcome-analysis)
 * from the command line, for a canary or to drain a backlog.
 *
 *   npx tsx scripts/post-outcome-run-pending.mts --env-file .env.production.local --dry-run
 *   npx tsx scripts/post-outcome-run-pending.mts --env-file .env.production.local --limit 3
 */
import { readFileSync } from "node:fs";

function arg(name: string, fallback: string | null = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const envFile = arg("--env-file")!;
if (!envFile) throw new Error("--env-file is required");
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
}
console.log(`[run-pending] ${envFile} → ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL}`);

const { findPendingAnalyses, runPendingAnalyses } = await import("../lib/postOutcome/runPendingAnalyses.ts");
if (process.argv.includes("--dry-run")) {
  const pending = await findPendingAnalyses();
  console.log(`pending: ${pending.length}`);
  console.log(pending.join("\n"));
} else {
  const r = await runPendingAnalyses({ limit: Number(arg("--limit", "100")), deadlineMs: Date.now() + 30 * 60_000 });
  console.log(JSON.stringify(r, null, 2));
}
