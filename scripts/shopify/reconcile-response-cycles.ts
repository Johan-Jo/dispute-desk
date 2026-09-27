/**
 * One-off repair for response cycles (plan
 * docs/plans/mein-maison-status-and-no-return.plan.md, B3 + B4).
 *
 * Disputes that Shopify reopened (or escalated from an answered inquiry)
 * BEFORE the live detection shipped still carry the first response's "sent"
 * state: they show "Under review" with a live deadline, and nothing files
 * the new response. The live path only catches a TRANSITION into
 * needs_response, and these rows are already there.
 *
 * Two modes, run in this order (both dry-run unless --apply):
 *
 *   --mode history  Reconstruct past cycles from webhook_events payloads
 *                   (falling back to dispute_events), and stamp
 *                   escalated_from_inquiry_at. Writes every cycle through
 *                   reconcile_response_cycle(source 'webhook_history' |
 *                   'event_history').
 *
 *   --mode live     For open disputes the DB STILL believes answered, fetch
 *                   the live dispute from Shopify and repair only rows
 *                   Shopify confirms are in a new cycle: status
 *                   needs_response, a real future deadline, evidence_sent_on
 *                   null, and a prior response to anchor on
 *                   (source 'live_repair').
 *
 * Both modes go through the SAME SQL function with the SAME anchor rule as
 * the live sync (`responseAnchorKey`), so running them in either order, or
 * twice, yields one ledger row per cycle. Every dispute that is reset gets
 * the same `response_cycle_reopened` ledger event the live path emits, and a
 * rebuild through the normal pipeline (the shop's automation mode decides
 * what happens next, plan D-3).
 *
 * Usage (prod needs the production env file and the offline token):
 *   node --env-file=.env.production.local node_modules/tsx/dist/cli.mjs \
 *     scripts/shopify/reconcile-response-cycles.ts --mode history [--shop <shop_id>] [--apply]
 *   node --env-file=.env.production.local node_modules/tsx/dist/cli.mjs \
 *     scripts/shopify/reconcile-response-cycles.ts --mode live [--shop <shop_id>] [--apply]
 *
 * Always read the dry-run's printed set before --apply.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { SHOPIFY_API_VERSION } from "@/lib/shopify/client";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { RESPONSE_CYCLE_REOPENED, ESCALATED_TO_CHARGEBACK } from "@/lib/disputeEvents/eventTypes";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { normalizeMode } from "@/lib/rules/normalizeMode";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import {
  hasRealDeadline,
  reconcileResponseCycle,
  responseAnchorKey,
  type PriorResponseRow,
  type ResponseCycleSource,
  type ResponseCycleTrigger,
} from "@/lib/disputes/responseCycle";
import {
  planHistoryCyclesAgainstLedger,
  type ObservedState,
} from "@/lib/disputes/responseCycleHistory";

type Mode = "history" | "live";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const MODE = arg("--mode") as Mode | null;
const SHOP = arg("--shop");
const APPLY = process.argv.includes("--apply");
if (MODE !== "history" && MODE !== "live") {
  console.error("--mode history|live is required");
  process.exit(1);
}

const sb = getServiceClient();

interface DisputeRow extends PriorResponseRow {
  id: string;
  shop_id: string;
  order_name: string | null;
  dispute_gid: string;
  phase: string | null;
  reason: string | null;
  amount: number | null;
  closed_at: string | null;
  response_cycle: number | null;
  escalated_from_inquiry_at: string | null;
}

const BASE_COLS =
  "id, shop_id, order_name, dispute_gid, phase, reason, amount, status, due_at, submitted_at, " +
  "submission_state, evidence_saved_to_shopify_at, shopify_updated_at, closed_at";
// The cycle columns exist once migration 20260927120000 is applied. A dry
// run before that still works (it cannot --apply: the SQL function is part
// of the same migration).
let DISPUTE_COLS = BASE_COLS + ", response_cycle, escalated_from_inquiry_at";

async function loadDisputes(filter: "all" | "open_answered"): Promise<DisputeRow[]> {
  const out: DisputeRow[] = [];
  // PostgREST caps un-ranged selects at 1000 rows — page explicitly.
  for (let from = 0; ; from += 1000) {
    let q = sb.from("disputes").select(DISPUTE_COLS).order("id").range(from, from + 999);
    if (SHOP) q = q.eq("shop_id", SHOP);
    if (filter === "open_answered") {
      q = q
        .is("closed_at", null)
        .or("submitted_at.not.is.null,submission_state.in.(submitted_confirmed,saved_to_shopify)");
    }
    const { data, error } = await q;
    if (error && /response_cycle|escalated_from_inquiry_at/.test(error.message) && !APPLY && DISPUTE_COLS !== BASE_COLS) {
      console.log("(migration not applied yet — dry run without cycle columns)");
      DISPUTE_COLS = BASE_COLS;
      from -= 1000;
      continue;
    }
    if (error) throw new Error(`load disputes: ${error.message}`);
    out.push(...((data ?? []) as unknown as DisputeRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function numericId(gid: string): string | null {
  return gid.match(/\/(\d+)$/)?.[1] ?? null;
}

async function webhookHistory(d: DisputeRow): Promise<ObservedState[]> {
  const num = numericId(d.dispute_gid);
  if (!num) return [];
  const { data } = await sb
    .from("webhook_events")
    .select("received_at, payload_excerpt")
    .eq("shop_id", d.shop_id)
    .eq("shopify_object_id", num)
    .like("topic", "disputes/%")
    .order("received_at");
  return (data ?? []).map((w) => {
    const p = (w.payload_excerpt ?? {}) as Record<string, string | null>;
    return {
      at: w.received_at as string,
      status: p.status ?? null,
      type: p.type ?? null,
      evidenceDueBy: p.evidence_due_by ?? null,
      evidenceSentOn: p.evidence_sent_on ?? null,
    };
  });
}

async function eventHistory(d: DisputeRow): Promise<ObservedState[]> {
  const { data } = await sb
    .from("dispute_events")
    .select("event_type, event_at, metadata_json")
    .eq("dispute_id", d.id)
    .in("event_type", ["dispute_opened", "status_changed", "submission_confirmed"])
    .order("event_at");
  const out: ObservedState[] = [];
  let status: string | null = null;
  let type: string | null = null;
  for (const e of data ?? []) {
    const m = (e.metadata_json ?? {}) as Record<string, string | null>;
    if (e.event_type === "dispute_opened") {
      type = m.phase ?? null;
      continue;
    }
    if (e.event_type === "status_changed") status = m.new_status ?? status;
    out.push({
      at: e.event_at as string,
      status,
      type,
      evidenceSentOn: e.event_type === "submission_confirmed" ? (e.event_at as string) : null,
    });
  }
  return out;
}

async function ledgerStarts(disputeId: string): Promise<string[]> {
  const { data } = await sb
    .from("dispute_response_cycles")
    .select("started_at")
    .eq("dispute_id", disputeId);
  return (data ?? []).map((r) => r.started_at as string);
}

async function openCycle(
  d: DisputeRow,
  c: { anchorKey: string; startedAt: string; trigger: ResponseCycleTrigger },
  source: ResponseCycleSource,
): Promise<string> {
  const r = await reconcileResponseCycle(sb, d.id, { ...c, source });
  if (!r.reset) return r.inserted ? `ledger+ (older cycle) → c${r.cycle}` : `known anchor → c${r.cycle}`;

  const eventKey = `${d.id}:RESPONSE_CYCLE_REOPENED:${c.anchorKey}`;
  await emitDisputeEvent({
    disputeId: d.id,
    shopId: d.shop_id,
    eventType: RESPONSE_CYCLE_REOPENED,
    description: `Response cycle ${r.cycle} opened (${c.trigger})`,
    eventAt: c.startedAt,
    actorType: "shopify",
    sourceType: "shopify_sync",
    metadataJson: {
      trigger: c.trigger,
      cycle: r.cycle,
      anchor_key: c.anchorKey,
      repair_source: source,
      previous: r.previous ?? null,
      retired_pack_ids: r.retiredPackIds,
      retired_approvals: r.retiredApprovals,
      superseded_defence_package_ids: r.supersededDefencePackageIds,
    },
    dedupeKey: eventKey,
  });
  await updateNormalizedStatus(d.id);

  // Rebuild for the new cycle only if Shopify still wants a response now.
  let rebuilt = "no rebuild (not currently needs_response)";
  if (d.status === "needs_response" && hasRealDeadline(d.due_at) && new Date(d.due_at!).getTime() > Date.now()) {
    const phase = d.phase === "inquiry" || d.phase === "chargeback" ? d.phase : null;
    const rules = await evaluateRules({
      id: d.id,
      shop_id: d.shop_id,
      reason: d.reason,
      status: d.status,
      amount: d.amount,
      phase,
    });
    if (normalizeMode(rules.action.mode) === "review") {
      await sb.from("disputes").update({ needs_review: true }).eq("id", d.id);
    }
    const p = await runAutomationPipeline({
      id: d.id,
      shop_id: d.shop_id,
      reason: d.reason,
      phase,
      pack_template_id: rules.packTemplateId ?? rules.action.pack_template_id ?? null,
    });
    rebuilt = `pipeline: ${p.action}`;
  }
  return `RESET → c${r.cycle}; archived ${r.retiredPackIds.length} pack(s), superseded ${r.supersededDefencePackageIds.length}; ${rebuilt}`;
}

async function runHistory() {
  const disputes = await loadDisputes("all");
  let planned = 0;
  for (const d of disputes) {
    let states = await webhookHistory(d);
    let source: ResponseCycleSource = "webhook_history";
    let requireDeadline = true;
    if (states.length === 0) {
      states = await eventHistory(d);
      source = "event_history";
      requireDeadline = false;
    }
    if (states.length < 2) continue;
    const plan = planHistoryCyclesAgainstLedger(states, d, await ledgerStarts(d.id), requireDeadline);
    const escalate =
      plan.escalatedAt && !d.escalated_from_inquiry_at && d.phase === "chargeback" ? plan.escalatedAt : null;
    if (plan.cycles.length === 0 && !escalate) continue;

    planned += plan.cycles.length;
    console.log(
      `${d.order_name ?? d.id} [${d.shop_id.slice(0, 8)}] ${d.phase}/${d.status} due=${d.due_at?.slice(0, 10) ?? "-"} ` +
        `state=${d.submission_state} src=${source}` +
        (escalate ? ` escalated=${escalate}` : ""),
    );
    for (const c of plan.cycles) {
      const line = `    ${c.trigger} start=${c.startedAt} anchor=${c.anchorKey}`;
      if (!APPLY) {
        console.log(line);
        continue;
      }
      console.log(`${line} → ${await openCycle(d, c, source)}`);
    }
    if (escalate && APPLY) {
      await sb
        .from("disputes")
        .update({ escalated_from_inquiry_at: escalate })
        .eq("id", d.id)
        .is("escalated_from_inquiry_at", null);
      await emitDisputeEvent({
        disputeId: d.id,
        shopId: d.shop_id,
        eventType: ESCALATED_TO_CHARGEBACK,
        description: "Inquiry escalated to chargeback",
        eventAt: escalate,
        actorType: "shopify",
        sourceType: "shopify_sync",
        metadataJson: { repair_source: source },
        dedupeKey: `${d.id}:ESCALATED_TO_CHARGEBACK`,
      });
    }
  }
  console.log(`\n${disputes.length} disputes scanned, ${planned} cycle(s) ${APPLY ? "reconciled" : "planned (dry run)"}.`);
}

async function runLive() {
  const disputes = await loadDisputes("open_answered");
  const byShop = new Map<string, DisputeRow[]>();
  for (const d of disputes) byShop.set(d.shop_id, [...(byShop.get(d.shop_id) ?? []), d]);

  let confirmed = 0;
  for (const [shopId, rows] of byShop) {
    let session;
    try {
      session = await getShopBackgroundSession(shopId);
    } catch (err) {
      console.log(`[${shopId.slice(0, 8)}] skipped: no usable session (${err instanceof Error ? err.message : err})`);
      continue;
    }
    for (const d of rows) {
      const num = numericId(d.dispute_gid);
      if (!num) continue;
      const res = await fetch(
        `https://${session.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/disputes/${num}.json`,
        { headers: { "X-Shopify-Access-Token": session.accessToken } },
      );
      const live = ((await res.json()) as { dispute?: Record<string, string | null> }).dispute ?? {};
      const anchorKey = responseAnchorKey(d);
      const dueMs = live.evidence_due_by ? new Date(live.evidence_due_by).getTime() : NaN;
      const ok =
        live.status === "needs_response" &&
        hasRealDeadline(live.evidence_due_by) &&
        dueMs > Date.now() &&
        !live.evidence_sent_on &&
        anchorKey != null;

      const inLedger = anchorKey
        ? Boolean(
            (
              await sb
                .from("dispute_response_cycles")
                .select("id")
                .eq("dispute_id", d.id)
                .eq("anchor_key", anchorKey)
                .maybeSingle()
            ).data,
          )
        : false;
      const line =
        `${d.order_name ?? d.id} [${session.shopDomain}] ${d.phase} ours=${d.status}/${d.submission_state} ` +
        `shopify=${live.status ?? "?"} due=${live.evidence_due_by ?? "-"} sent=${live.evidence_sent_on ?? "-"} ` +
        `anchor=${anchorKey ?? "-"} inLedger=${inLedger}`;
      if (!ok) {
        console.log(`  leave  ${line}`);
        continue;
      }
      confirmed++;

      // startedAt: the earliest evidence of the reopen — the needs_response
      // webhook after the anchor, from the same planner history uses, so a
      // later history run lands on the same row. Otherwise "now" (recorded
      // once; a re-run hits the same anchor and changes nothing).
      const plan = planHistoryCyclesAgainstLedger(await webhookHistory(d), d, []);
      const fromHistory = plan.cycles.find((c) => c.anchorKey === anchorKey);
      const startedAt = fromHistory?.startedAt ?? new Date().toISOString();
      const trigger: ResponseCycleTrigger =
        fromHistory?.trigger ?? (d.escalated_from_inquiry_at && (d.response_cycle ?? 1) === 1 ? "escalation" : "reopen");

      if (!APPLY) {
        console.log(`  REPAIR ${line} start=${startedAt} (${trigger})`);
        continue;
      }
      d.status = live.status;
      d.due_at = live.evidence_due_by;
      console.log(
        `  REPAIR ${line} → ${await openCycle(d, { anchorKey: anchorKey!, startedAt, trigger }, "live_repair")}`,
      );
    }
  }
  console.log(`\n${disputes.length} open disputes still marked answered; ${confirmed} confirmed reopened by Shopify ${APPLY ? "and repaired" : "(dry run)"}.`);
}

(MODE === "history" ? runHistory() : runLive()).catch((err) => {
  console.error(err);
  process.exit(1);
});
