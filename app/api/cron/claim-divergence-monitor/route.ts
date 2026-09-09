import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import {
  assertProjection,
  canClaimPrepared,
  findingKey,
  gatherArtifactFacts,
  mayPromiseAutomaticWork,
  resolveAutomationPromise,
  suppressesAutomaticRecoveryPromise,
  type Finding,
} from "@/lib/disputes/presentation";

/**
 * GET /api/cron/claim-divergence-monitor
 *
 * Plan §7. Hourly. Runs the REAL resolvers over the REAL facts for every open
 * dispute and reports where a projected claim is not licensed by its
 * predicate — so the ninth instance of the label-fact class is found by a
 * check rather than by a merchant, which is how the first eight were found.
 *
 * §7 is explicit that a SQL-only monitor does not satisfy this: the question
 * is not "is a column odd" but "would a surface claim something untrue". SQL
 * supplies the cohort and the facts; TypeScript supplies the verdict.
 *
 * Two categories are reported separately and must not be merged:
 *   divergence — the projection contradicts the facts (a bug in us)
 *   stranded   — the projection is honest and the case is still unfileable
 *                (an operational problem)
 *
 * A query failure is reported as MONITOR FAILURE, never as a clean zero.
 */

export const dynamic = "force-dynamic";

const BATCH = 200;

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const startedAt = new Date().toISOString();

  const { data: disputes, error: disputeErr } = await sb
    .from("disputes")
    .select("id, shop_id, due_at, submission_state, normalized_status")
    .in("normalized_status", ["needs_response", "needs_review"])
    .limit(BATCH);

  // A failed read must surface as failure. Returning ok:true with zero
  // findings would be the monitor committing the very defect it watches for.
  if (disputeErr) {
    await sendAdminEmail({
      subject: "[monitor] claim-divergence monitor FAILED",
      text: `Cohort query failed at ${startedAt}: ${disputeErr.message}`,
      html: `<p>Cohort query failed at ${startedAt}.</p><pre>${escapeHtml(disputeErr.message)}</pre>`,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: "cohort_query_failed" }, { status: 500 });
  }

  const rows = disputes ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, findings: [] });
  }

  // Group by shop so each batch stays tenant-scoped.
  const byShop = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byShop.get(r.shop_id);
    if (list) list.push(r);
    else byShop.set(r.shop_id, [r]);
  }

  const now = Date.now();
  const findings: Array<{ disputeId: string; key: string } & Finding> = [];
  let checked = 0;

  for (const [shopId, shopRows] of byShop) {
    const { data: settings } = await sb
      .from("shop_settings")
      .select("auto_build_enabled")
      .eq("shop_id", shopId)
      .maybeSingle();

    const automation = resolveAutomationPromise({
      readOk: settings != null,
      autoBuildEnabled: (settings?.auto_build_enabled as boolean | null) ?? null,
      blockers: [],
    });

    const facts = await gatherArtifactFacts(
      sb,
      shopId,
      shopRows.map((r) => r.id),
    );

    for (const r of shopRows) {
      const f = facts.get(r.id);
      if (!f) continue;
      checked += 1;

      /*
       * THE PROJECTION MUST BE READ, NOT ASSUMED.
       *
       * The first version set `claimsAutomaticRecovery` from
       * `mayPromiseAutomaticWork(automation)` — a shop-level flag with no
       * per-case knowledge — and then `assertProjection` flagged
       * `recovery_promised_over_blocker` because the attempt was declined or
       * capped. The monitor asserted the claim and then reported itself for
       * asserting it.
       *
       * It fired on four prod cases in its first run (three
       * no_bank_eligible_facts, one daily_cap_reached) and would have fired
       * on every declined or capped case every hour thereafter — noise that
       * trains the reader to ignore the alert, which is worse than no alert.
       *
       * An assumed projection cannot detect divergence. It can only
       * manufacture it. So the recovery claim is now derived the way the UI
       * derives it: the shop-level promise AND the absence of a per-case
       * blocker. A declined or capped case does not promise recovery,
       * because `suppressesAutomaticRecoveryPromise` is exactly the
       * predicate the surfaces use.
       */
      const claimsPrepared = canClaimPrepared(f.artifact);
      const claimsAutomaticRecovery =
        mayPromiseAutomaticWork(automation) &&
        !suppressesAutomaticRecoveryPromise(f.attempt);

      const projection = {
        disputeId: r.id,
        artifact: f.artifact,
        attempt: f.attempt,
        automation,
        claimsPrepared,
        claimsAutomaticRecovery,
        deadlinePassed: r.due_at ? Date.parse(r.due_at) < now : null,
        hasPriorTransmittedResponse: r.submission_state === "submitted_confirmed",
      };

      const revision =
        f.artifact.state === "present" ? f.artifact.identity.contentRevision : null;

      for (const finding of assertProjection(projection)) {
        findings.push({ ...finding, disputeId: r.id, key: findingKey(r.id, finding, revision) });
      }
    }
  }

  const divergences = findings.filter((f) => f.kind === "divergence");
  const stranded = findings.filter((f) => f.kind === "stranded");

  if (findings.length > 0) {
    await sendAdminEmail({
      subject: `[monitor] ${divergences.length} divergence, ${stranded.length} stranded`,
      text: [
        `Checked ${checked} open disputes at ${startedAt}.`,
        ...findings.map((f) => `${f.kind} ${f.disputeId} ${f.code}: ${f.detail}`),
      ].join("\n"),
      html:
        `<p>Checked ${checked} open disputes at ${startedAt}.</p>` +
        section("Divergence — a claim not licensed by its facts", divergences) +
        section("Stranded — honest label, no viable response", stranded),
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    checked,
    divergences: divergences.length,
    stranded: stranded.length,
    findings,
  });
}

function section(title: string, items: Array<{ disputeId: string; code: string; detail: string }>) {
  if (items.length === 0) return "";
  const rows = items
    .map((i) => `<li><code>${escapeHtml(i.disputeId)}</code> — ${escapeHtml(i.code)}: ${escapeHtml(i.detail)}</li>`)
    .join("");
  return `<h3>${escapeHtml(title)}</h3><ul>${rows}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
