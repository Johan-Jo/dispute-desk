/**
 * GET /api/cron/prompt-module-drift — the watchdog for file-vs-DB prompt drift.
 *
 * `resolveReasonCodeModule` lets a `defence_prompt_modules` row override the
 * file default's prompt body and its five guidance lists. The row wins. So a
 * reviewed, tested, deployed change to `lib/defence/reasonCodes/*.ts` has NO
 * effect in production while a stale row sits above it — and nothing says so.
 *
 * WHY THIS ROUTE EXISTS. Measured on prod 2026-09-02, ALL SEVEN modules were
 * drifted and none was marked `intentional_override`:
 *
 *   - `product_unacceptable` still carried `criticalCategories:
 *     ["order_record"]` and delivery-second ranking, so a change shipped the
 *     previous day to make conformity lead did nothing at all. It was reported
 *     as live.
 *   - `visa_10_4_fraud` was drifted in prompt BODY across five commits and
 *     roughly seven weeks — including work that removed concrete claim examples
 *     from runtime prompts and closed prompt paths to a claim the validator
 *     refuses. Production generated fraud narratives without those guards the
 *     whole time.
 *
 * This is the second occurrence. The first, on 2026-05-16, is what
 * `scripts/reconcile-defence-prompt-modules.mts` was written for. Detection
 * already existed then too — `detectPromptModuleDrift` — rendered on an admin
 * page nobody was looking at. A detector nothing consumes is not a control.
 *
 * WHY NOT CI. CI cannot see the production database, and the drift that
 * matters is between the deployed files and the PROD rows. A build-time check
 * would either need prod credentials in CI or would verify the wrong database
 * and pass while prod stayed broken — the precise shape of the mistake this
 * exists to catch. So the check runs where the truth is, daily, and is loud.
 *
 * Remedy when it fires: run
 *   npx tsx scripts/reconcile-defence-prompt-modules.mts \
 *     --env-file .env.production.local --apply
 * Rows genuinely meant to diverge should be marked `intentional_override=true`,
 * which this route and the reconcile script both respect.
 */

import { NextRequest, NextResponse } from "next/server";

import { cronEnvGate } from "@/lib/cron/envGate";
import { detectPromptModuleDrift } from "@/lib/defence/admin-queries";
import { sendAdminEmail } from "@/lib/email/adminEmail";

export const runtime = "nodejs";

function describeDrift(row: {
  key: string;
  dbBody: string | null;
  fileBody: string;
  dbGuidance: Record<string, unknown> | null;
  fileGuidance: Record<string, unknown>;
}): string {
  if (row.dbBody === null) return "no DB row at all";
  const parts: string[] = [];
  if (row.dbBody !== row.fileBody) parts.push("body");
  const changed = Object.keys(row.fileGuidance).filter(
    (k) =>
      JSON.stringify(row.fileGuidance[k]) !==
      JSON.stringify(row.dbGuidance?.[k] ?? null),
  );
  if (changed.length > 0) parts.push(`guidance: ${changed.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "unknown";
}

export async function GET(req: NextRequest) {
  const gate = await cronEnvGate(req);
  if (gate) return gate;

  const rows = await detectPromptModuleDrift();

  // `intentional_override` is a deliberate divergence and is NOT drift. It is
  // reported separately rather than silently dropped, so a row parked as
  // intentional years ago cannot quietly become the reason a fix does nothing.
  const drifted = rows.filter((r) => r.drifted && !r.intentionalOverride);
  const intentional = rows.filter((r) => r.drifted && r.intentionalOverride);

  if (drifted.length > 0) {
    const lines = drifted.map((r) => `  - ${r.key}: ${describeDrift(r)}`);
    const text = [
      `${drifted.length} reason-code module(s) in production do not match the deployed files.`,
      "",
      "The DB row WINS, so any change to these modules is currently inert:",
      ...lines,
      "",
      intentional.length > 0
        ? `(${intentional.length} further row(s) diverge but are marked intentional_override — not counted.)`
        : "",
      "Remedy:",
      "  npx tsx scripts/reconcile-defence-prompt-modules.mts \\",
      "    --env-file .env.production.local --apply",
      "",
      "Dry-run first; it prints the target database before writing.",
    ]
      .filter(Boolean)
      .join("\n");

    await sendAdminEmail({
      subject: `[DisputeDesk] ${drifted.length} prompt module(s) drifted from the deployed files`,
      text,
      html: `<pre>${text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</pre>`,
      logTag: "prompt-module-drift",
    }).catch(() => {
      /* non-fatal — the JSON response still records the finding */
    });
  }

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    drifted: drifted.map((r) => ({ key: r.key, what: describeDrift(r) })),
    intentionalOverride: intentional.map((r) => r.key),
  });
}
