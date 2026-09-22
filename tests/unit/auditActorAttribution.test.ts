/**
 * INVARIANT: no request-scoped route hardcodes `actor_type: "merchant"`.
 *
 * WHY THIS FILE EXISTS. A merchant clicking a button and one of us using
 * SuperAdmin "View as merchant" reach these routes identically; the
 * impersonation cookie is the only thing that separates them. Until
 * 2026-09-15, exactly ONE of 38 write sites checked it
 * (app/api/automation/settings/route.ts, fixed after a merchant's
 * `auto_build_enabled` was found false with no way to tell who turned it
 * off). The other 37 recorded our actions as the merchant's own.
 *
 * The concrete damage: shop ea035a1b (Mein Maison) carried 14 `merchant`
 * audit rows, 8 of which were `scripts/build-one-pack.mjs` runs. Asked what
 * that merchant did, the trail answered with our own script output.
 *
 * A grep is the right shape here because the defect is a LITERAL, not a type
 * error -- `"merchant"` satisfies `AuditActorType` perfectly well. Only
 * reading the source catches a route that reintroduces it.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SKIP = ["node_modules", "__tests__", ".next"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Routes that legitimately write a non-resolved actor. Each entry must say
 * WHY the request cannot carry impersonation -- "it's fine" is not a reason.
 */
const ALLOWED: Record<string, string> = {
  // Reference implementation: resolves impersonation inline (predates
  // resolveAuditActor) and folds it into `system`, not `admin`.
  "app/api/automation/settings/route.ts":
    "resolves verifyImpersonation() inline; see logEvent.ts actor vocabulary",
};

describe("audit actor attribution", () => {
  it("no API route hardcodes a merchant actor", () => {
    const offenders: string[] = [];

    for (const file of walk(join(ROOT, "app", "api"))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (ALLOWED[rel]) continue;
      const src = readFileSync(file, "utf8");
      if (
        /actorType:\s*"merchant"/.test(src) ||
        /actor_type:\s*"merchant"/.test(src)
      ) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These routes hardcode a merchant actor, so an operator acting through ` +
        `"View as merchant" is recorded as the merchant. Use ` +
        `resolveAuditActor(req) from lib/audit/resolveActor.ts:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("scripts that write audit events identify themselves", () => {
    const offenders: string[] = [];

    for (const file of readdirSync(join(ROOT, "scripts"))) {
      if (!file.endsWith(".mjs")) continue;
      const src = readFileSync(join(ROOT, "scripts", file), "utf8");
      if (!src.includes("audit_events")) continue;
      if (/actor_type:\s*"merchant"/.test(src)) offenders.push(`scripts/${file}`);
    }

    expect(
      offenders,
      `These scripts write audit events as "merchant". A script is not a ` +
        `merchant -- use actor_type: "script" with actor_id set to the ` +
        `script filename:\n` + offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });
});
