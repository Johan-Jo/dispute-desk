import { appendFileSync } from "fs";
import { join } from "path";

/**
 * Debug logging for embedded production + local dev.
 * - Set DD_DEBUG_AGENT_LOG=1 on Vercel → structured lines in Runtime Logs: [DD_DEBUG_0d3fe7] {...}
 * - Local dev also appends NDJSON to debug-0d3fe7.log when NODE_ENV=development
 */
export function agentLogRuntime(payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    sessionId: "0d3fe7",
    timestamp: Date.now(),
    ...payload,
  });
  if (process.env.DD_DEBUG_AGENT_LOG === "1") {
    console.log(`[DD_DEBUG_0d3fe7] ${line}`);
  }
  if (process.env.NODE_ENV === "development") {
    try {
      appendFileSync(join(process.cwd(), "debug-0d3fe7.log"), `${line}\n`);
    } catch {
      /* ignore */
    }
  }
}
