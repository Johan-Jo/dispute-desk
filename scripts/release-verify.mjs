#!/usr/bin/env node
/**
 * Release verification runner.
 *
 * Replaces the previous `lint && tsc && test && build` chain with a
 * live-streaming runner that prints per-step banners, captures timing,
 * and shows a summary table at the end. Exits non-zero on any failure
 * — same gate semantics as the chain it replaces.
 *
 * Why a script instead of a chain:
 *   - Clear "which step is running" banners (the chain interleaves output).
 *   - Per-step timing visible in the summary.
 *   - Vitest runs in `verbose` reporter so each test name streams live —
 *     much easier to follow than the default dot reporter.
 *   - Single failure summary at the end so you don't have to scroll.
 *
 * Cross-platform: spawns with shell: true so npm scripts and npx
 * resolve correctly on PowerShell + bash.
 */

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const isTTY = Boolean(process.stdout.isTTY);
const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  green: isTTY ? "\x1b[32m" : "",
  red: isTTY ? "\x1b[31m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
};

const STEPS = [
  // Env identity — verifies dangerous dev/prod env combinations early so
  // misconfig fails before the heavier steps. Tolerant when APP_ENV is
  // unset (Phase 0 pre-activation); strict once APP_ENV is set.
  { name: "Env identity", cmd: "node", args: ["scripts/verify-env-identity.mjs"] },
  { name: "Lint", cmd: "npm", args: ["run", "lint"] },
  { name: "TypeScript", cmd: "npx", args: ["tsc", "--noEmit"] },
  // i18n guardrail — blocks hardcoded English in embedded routes.
  // See scripts/verify-i18n.mjs for the rules + escape hatches.
  { name: "i18n: hardcoded", cmd: "node", args: ["scripts/verify-i18n.mjs"] },
  // i18n key-resolution guardrail — blocks t() calls that reference
  // keys missing from messages/en.json (the bug that produces UI
  // rendering raw key paths like "disputes.sourceCaption.auto_shopify")
  // AND bans lazy `// i18n-allow TODO` markers.
  { name: "i18n: keys", cmd: "node", args: ["scripts/verify-i18n-keys.mjs"] },
  // i18n locale-parity guardrail — blocks merges that leave non-en
  // locales missing leaf strings present in en.json. The structural-
  // i18n migration removed the silent en fallback in getMessages.ts,
  // so a missing key would render the raw key path in production.
  { name: "i18n: parity", cmd: "node", args: ["scripts/verify-i18n-parity.mjs"] },
  // i18n term-equivalence guardrail — catches "same concept, different
  // translation across namespaces" bugs (e.g. FRAUDULENT rendered as
  // Bedräglig in one namespace and Obehörig transaktion in another).
  // Group definitions live in scripts/i18n/term-equivalences.json.
  { name: "i18n: equivalences", cmd: "node", args: ["scripts/verify-i18n-equivalences.mjs"] },
  // verbose reporter so each test name streams — user can follow progress
  { name: "Vitest", cmd: "npx", args: ["vitest", "run", "--reporter=verbose"] },
  { name: "Build", cmd: "npm", args: ["run", "build"] },
];

function banner(label, idx, total) {
  const line = "═".repeat(72);
  console.log("");
  console.log(`${c.cyan}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}▶ Step ${idx}/${total} — ${label}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}`);
}

function fmtSeconds(ms) {
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

function runStep(step) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(step.cmd, step.args, {
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      const elapsed = performance.now() - start;
      resolve({ ok: code === 0, code: code ?? -1, elapsedMs: elapsed });
    });
    child.on("error", (err) => {
      const elapsed = performance.now() - start;
      console.error(`${c.red}spawn error: ${err.message}${c.reset}`);
      resolve({ ok: false, code: -1, elapsedMs: elapsed });
    });
  });
}

async function main() {
  console.log("");
  console.log(`${c.bold}DisputeDesk release verification${c.reset}`);
  console.log(`${c.dim}Running ${STEPS.length} checks: ${STEPS.map((s) => s.name).join(", ")}${c.reset}`);

  const overallStart = performance.now();
  const results = [];

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    banner(step.name, i + 1, STEPS.length);
    const result = await runStep(step);
    results.push({ name: step.name, ...result });

    // Fail-fast: stop on first failure so the user doesn't wait for
    // build to finish when lint already broke.
    if (!result.ok) {
      console.log("");
      console.log(`${c.red}${c.bold}✗ ${step.name} failed (exit ${result.code}). Skipping remaining steps.${c.reset}`);
      // Push synthetic SKIPPED entries so the summary shows what didn't run.
      for (let j = i + 1; j < STEPS.length; j++) {
        results.push({ name: STEPS[j].name, ok: false, code: -2, elapsedMs: 0, skipped: true });
      }
      break;
    }
  }

  const overallMs = performance.now() - overallStart;

  // Print summary; treat skipped steps as a separate marker.
  const line = "═".repeat(72);
  console.log("");
  console.log(`${c.cyan}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}Release verification summary${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}`);

  const nameWidth = Math.max(...STEPS.map((s) => s.name.length));
  let allOk = true;
  for (const r of results) {
    let mark;
    let status;
    if (r.skipped) {
      mark = `${c.yellow}—${c.reset}`;
      status = `${c.yellow}SKIPPED${c.reset}`;
      allOk = false;
    } else if (r.ok) {
      mark = `${c.green}✓${c.reset}`;
      status = `${c.green}PASS${c.reset}`;
    } else {
      mark = `${c.red}✗${c.reset}`;
      status = `${c.red}FAIL (exit ${r.code})${c.reset}`;
      allOk = false;
    }
    const name = r.name.padEnd(nameWidth);
    const time = r.skipped ? "    —  " : fmtSeconds(r.elapsedMs).padStart(7);
    console.log(`${mark}  ${name}  ${c.dim}${time}${c.reset}  ${status}`);
  }

  console.log("");
  if (allOk) {
    console.log(`${c.green}${c.bold}✓ All checks passed${c.reset}  ${c.dim}— Total ${fmtSeconds(overallMs)}${c.reset}`);
  } else {
    const failed = results.filter((r) => !r.ok && !r.skipped).map((r) => r.name).join(", ");
    const skipped = results.filter((r) => r.skipped).map((r) => r.name);
    let line = `${c.red}${c.bold}✗ Failed: ${failed}${c.reset}`;
    if (skipped.length > 0) line += `  ${c.dim}(skipped: ${skipped.join(", ")})${c.reset}`;
    line += `  ${c.dim}— Total ${fmtSeconds(overallMs)}${c.reset}`;
    console.log(line);
  }
  console.log("");

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(`${c.red}release-verify crashed: ${err?.stack ?? err}${c.reset}`);
  process.exit(1);
});
