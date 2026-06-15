#!/usr/bin/env node
/**
 * Supabase DB target guard — preflight for any command that WRITES to a
 * Supabase project (migrations especially).
 *
 * WHY THIS EXISTS (2026-06-15 incident): the Supabase CLI's linked
 * project lives in `supabase/.temp/linked-project.json` — a single,
 * invisible, global pointer that `supabase db push` / `db query --linked`
 * inherit silently. During the published-policy work the CLI was linked
 * to PROD while we believed we were on DEV; a migration + many diagnostic
 * queries hit the wrong database before anyone noticed. The whole class
 * of bug is "a stateful target inherited without re-confirming".
 *
 * This guard removes the silent inheritance: the caller must state which
 * environment they intend (`dev` | `prod`), and the guard refuses unless
 * the currently-linked project ref matches that environment's known ref.
 * A mismatch is a hard, loud failure BEFORE any write — never a silent
 * wrong-target push.
 *
 * Usage:
 *   node scripts/guard-db-target.mjs <dev|prod>
 *
 * Exit 0 → linked ref matches the intended env; safe to proceed.
 * Exit 1 → mismatch / missing link / bad args; the caller must NOT write.
 *
 * Source of truth for refs is CLAUDE.md § "Supabase project refs". Keep
 * this list and KNOWN_PROD_PROJECT_REFS in scripts/db-push-prod.mjs in
 * sync when a project ref rotates (do it in the cutover commit).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Source of truth for project refs ──────────────────────────────────
// prod = Pro tier (post-2026-05-28 cutover); dev = dedicated Free project.
const ENV_REFS = {
  prod: ["aokhplydttxtebvbeuzc"],
  dev: ["vrpkgudqmpyunekrkpnc"],
};
// Idle / retired refs we explicitly recognize so a stale link produces a
// helpful message instead of a generic "unknown ref".
const RETIRED_REFS = {
  sddzuglxdnkhcnjmcpbj: "old Free-tier prod, retired 2026-06-04 (idle leftover, not dev)",
};

function die(msg) {
  console.error(`\n[guard-db-target] ✗ ${msg}\n`);
  process.exit(1);
}

const target = (process.argv[2] || "").toLowerCase();
if (target !== "dev" && target !== "prod") {
  die(
    `Missing/invalid target. Usage: node scripts/guard-db-target.mjs <dev|prod>\n` +
      `  This guard requires you to state the intended environment explicitly —\n` +
      `  the linked project is never trusted blindly (see 2026-06-15 incident).`,
  );
}

const linkedPath = resolve(process.cwd(), "supabase/.temp/linked-project.json");
if (!existsSync(linkedPath)) {
  die(
    `No linked Supabase project found (supabase/.temp/linked-project.json missing).\n` +
      `  Link the intended ${target} project first:\n` +
      `    npx supabase link --project-ref ${ENV_REFS[target][0]}`,
  );
}

let linkedRef;
try {
  linkedRef = JSON.parse(readFileSync(linkedPath, "utf8")).ref;
} catch (e) {
  die(`Could not parse ${linkedPath}: ${e.message}`);
}

const expected = ENV_REFS[target];
const otherEnv = target === "dev" ? "prod" : "dev";

if (expected.includes(linkedRef)) {
  console.log(
    `[guard-db-target] ✓ intended=${target} — linked project ref ${linkedRef} matches. Safe to proceed.`,
  );
  process.exit(0);
}

// Mismatch — build the most helpful possible message.
let detail;
if (ENV_REFS[otherEnv].includes(linkedRef)) {
  detail = `it is the ${otherEnv.toUpperCase()} project. You asked for ${target.toUpperCase()}. This is exactly the dev/prod mix-up this guard exists to stop.`;
} else if (RETIRED_REFS[linkedRef]) {
  detail = `it is a RETIRED project (${RETIRED_REFS[linkedRef]}).`;
} else {
  detail = `it is not a known ${target} ref.`;
}

die(
  `Linked Supabase project ref is "${linkedRef}" — ${detail}\n` +
    `  Expected ${target} ref: ${expected.join(" or ")}\n\n` +
    `  Re-link to the ${target} project, then retry:\n` +
    `    npx supabase link --project-ref ${expected[0]}`,
);
