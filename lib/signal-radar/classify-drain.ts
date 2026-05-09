import { getServiceClient } from "@/lib/supabase/server";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { classifySignal } from "./classify";
import { computeClusterMetrics } from "./cluster";
import {
  decideAlert,
  circuitBreakerTripped,
  checkCategoryDedup,
  checkClusterDedup,
  migrationCapReached,
} from "./alerts";

// Vercel route is configured maxDuration=300s; leave 30s buffer for Apify
// startup + DB upserts + cron route overhead.
const WALL_CLOCK_BUDGET_MS = 270_000;
const MAX_IN_FLIGHT = 4;
const MAX_ATTEMPTS = 3;
const STALE_LOCK_INTERVAL = "5 minutes";

interface SignalSourceRow {
  id: string;
  platform: "reddit" | "shopify_community" | "app_store";
  content_type: "submission" | "comment";
  subreddit: string | null;
  parent_external_id: string | null;
  title: string | null;
  content: string;
  author: string | null;
  cluster_key: string | null;
  url: string;
  analysis_attempts: number;
}

export interface ClassifyDrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
  alerted: number;
  budget_exceeded: boolean;
}

export async function classifyDrain(): Promise<ClassifyDrainResult> {
  const sb = getServiceClient();
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

  const result: ClassifyDrainResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    alerted: 0,
    budget_exceeded: false,
  };

  let inFlight = 0;
  const tasks: Promise<void>[] = [];

  while (Date.now() < deadline) {
    if (inFlight >= MAX_IN_FLIGHT) {
      await Promise.race(tasks.filter(Boolean));
      continue;
    }

    const claimed = await claimNextPending(sb);
    if (!claimed) {
      break;
    }

    inFlight++;
    result.attempted++;

    const task = processOne(sb, claimed)
      .then((outcome) => {
        if (outcome === "ok") result.succeeded++;
        else if (outcome === "alerted") {
          result.succeeded++;
          result.alerted++;
        } else result.failed++;
      })
      .catch(() => {
        result.failed++;
      })
      .finally(() => {
        inFlight--;
      });

    tasks.push(task);
  }

  if (Date.now() >= deadline) result.budget_exceeded = true;

  await Promise.allSettled(tasks);
  return result;
}

async function claimNextPending(
  sb: ReturnType<typeof getServiceClient>
): Promise<SignalSourceRow | null> {
  const { data: candidate } = await sb
    .from("signal_sources")
    .select(
      "id, platform, content_type, subreddit, parent_external_id, title, content, author, cluster_key, url, analysis_attempts, analysis_locked_at"
    )
    .eq("analysis_status", "pending")
    .lt("analysis_attempts", MAX_ATTEMPTS)
    .or(
      `analysis_locked_at.is.null,analysis_locked_at.lt.${new Date(Date.now() - 5 * 60 * 1000).toISOString()}`
    )
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const lockedAt = new Date().toISOString();
  const { data: locked, error } = await sb
    .from("signal_sources")
    .update({ analysis_locked_at: lockedAt })
    .eq("id", candidate.id)
    .eq("analysis_status", "pending")
    .select(
      "id, platform, content_type, subreddit, parent_external_id, title, content, author, cluster_key, url, analysis_attempts"
    )
    .maybeSingle();

  if (error || !locked) {
    void STALE_LOCK_INTERVAL;
    return null;
  }
  return locked as SignalSourceRow;
}

async function processOne(
  sb: ReturnType<typeof getServiceClient>,
  row: SignalSourceRow
): Promise<"ok" | "alerted" | "failed"> {
  let parentTitle: string | null = null;
  if (row.content_type === "comment" && row.parent_external_id) {
    const { data: parent } = await sb
      .from("signal_sources")
      .select("title")
      .eq("platform", row.platform)
      .eq("external_id", row.parent_external_id)
      .maybeSingle();
    parentTitle = parent?.title ?? null;
  }

  const result = await classifySignal({
    platform: row.platform,
    contentType: row.content_type,
    subreddit: row.subreddit,
    parentTitle,
    title: row.title,
    content: row.content,
    author: row.author,
  });

  if (!result.ok) {
    const nextAttempts = row.analysis_attempts + 1;
    const finalStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
    await sb
      .from("signal_sources")
      .update({
        analysis_status: finalStatus,
        analysis_attempts: nextAttempts,
        analysis_last_error: result.error.slice(0, 1000),
        analysis_locked_at: null,
      })
      .eq("id", row.id);
    return "failed";
  }

  const metrics = await computeClusterMetrics(sb, row.cluster_key);

  const { error: insertErr } = await sb.from("signal_analysis").insert({
    source_id: row.id,
    merchant_relevance: result.data.merchant_relevance,
    dispute_relevance: result.data.dispute_relevance,
    frustration_score: result.data.frustration_score,
    emotional_intensity_score: result.data.emotional_intensity_score,
    signal_score: result.data.signal_score,
    source_confidence_score: result.data.source_confidence_score,
    category: result.data.category,
    competitor: result.data.competitor,
    merchant_stage: result.data.merchant_stage,
    merchant_type: result.data.merchant_type,
    merchant_scale_signals: result.data.merchant_scale_signals,
    suggested_angle: result.data.suggested_angle,
    why_this_matters: result.data.why_this_matters,
    summary: result.data.summary,
    cluster_size_24h: row.cluster_key ? metrics.size_24h : null,
    cluster_growth_rate:
      row.cluster_key && metrics.growth_rate != null ? metrics.growth_rate : null,
    model: result.model,
    llm_raw: JSON.parse(result.raw),
  });

  if (insertErr) {
    console.error("[signal-radar] insert analysis error:", insertErr);
    await sb
      .from("signal_sources")
      .update({
        analysis_status: "pending",
        analysis_attempts: row.analysis_attempts + 1,
        analysis_last_error: `analysis_insert: ${insertErr.message}`.slice(0, 1000),
        analysis_locked_at: null,
      })
      .eq("id", row.id);
    return "failed";
  }

  await sb
    .from("signal_sources")
    .update({
      analysis_status: "classified",
      analysis_locked_at: null,
      analysis_last_error: null,
    })
    .eq("id", row.id);

  if (!result.data.merchant_relevance) return "ok";

  const decision = decideAlert({
    analysis: result.data,
    platform: row.platform,
    subreddit: row.subreddit,
    cluster_key: row.cluster_key,
  });

  if (decision.kind !== "immediate") return "ok";

  if (await circuitBreakerTripped(sb)) {
    console.warn("[signal-radar] alert storm — suppressing immediates");
    return "ok";
  }

  if (
    result.data.category === "migration_intent" &&
    (await migrationCapReached(sb))
  ) {
    return "ok";
  }

  if (await checkCategoryDedup(sb, decision)) return "ok";
  if (await checkClusterDedup(sb, decision)) return "ok";

  const recipient = process.env.ADMIN_NOTIFY_EMAIL ?? "oi@johan.com.br";
  await sendImmediateAlert({
    recipient,
    title: row.title ?? row.content.slice(0, 80),
    url: row.url,
    summary: result.data.summary,
    why_this_matters: result.data.why_this_matters,
    suggested_angle: result.data.suggested_angle,
    category: result.data.category,
    signal_score: result.data.signal_score,
    emotional_intensity_score: result.data.emotional_intensity_score,
    source_confidence_score: result.data.source_confidence_score,
    subreddit: row.subreddit,
    platform: row.platform,
  });

  await sb.from("signal_alerts").insert({
    source_id: row.id,
    alert_type: "immediate",
    category: result.data.category,
    dedup_key: decision.category_dedup_key,
    cluster_dedup_key: decision.cluster_dedup_key,
    recipient,
  });

  return "alerted";
}

interface AlertEmailInput {
  recipient: string;
  title: string;
  url: string;
  summary: string;
  why_this_matters: string;
  suggested_angle: string | null;
  category: string;
  signal_score: number;
  emotional_intensity_score: number;
  source_confidence_score: number;
  subreddit: string | null;
  platform: string;
}

async function sendImmediateAlert(input: AlertEmailInput): Promise<void> {
  const subject = `[Signal Radar] ${input.category}: ${input.title.slice(0, 60)}`;
  const dashboardBase =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.disputedesk.app";

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a">
      <h2 style="margin:0 0 8px 0;font-size:18px">${escapeHtml(input.title)}</h2>
      <p style="margin:0 0 12px 0;color:#64748b;font-size:13px">
        ${escapeHtml(input.platform)}${input.subreddit ? " · " + escapeHtml(input.subreddit) : ""} ·
        signal ${input.signal_score}/10 · emotion ${input.emotional_intensity_score}/10 ·
        confidence ${input.source_confidence_score}/10
      </p>
      <p style="margin:0 0 12px 0;font-weight:600">Why this matters</p>
      <p style="margin:0 0 16px 0">${escapeHtml(input.why_this_matters)}</p>
      <p style="margin:0 0 8px 0;font-weight:600">Summary</p>
      <p style="margin:0 0 16px 0">${escapeHtml(input.summary)}</p>
      ${
        input.suggested_angle
          ? `<p style="margin:0 0 8px 0;font-weight:600">Suggested angle</p>
             <p style="margin:0 0 16px 0">${escapeHtml(input.suggested_angle)}</p>`
          : ""
      }
      <p style="margin:24px 0 0 0">
        <a href="${escapeHtml(input.url)}" style="color:#2563eb">Open original</a>
        &nbsp;·&nbsp;
        <a href="${escapeHtml(dashboardBase)}/admin/signal-radar" style="color:#2563eb">Open Signal Radar</a>
      </p>
    </div>`;

  const text = [
    input.title,
    `${input.platform}${input.subreddit ? " · " + input.subreddit : ""} · signal ${input.signal_score}/10 · emotion ${input.emotional_intensity_score}/10 · confidence ${input.source_confidence_score}/10`,
    "",
    "Why this matters: " + input.why_this_matters,
    "",
    "Summary: " + input.summary,
    input.suggested_angle ? "\nSuggested angle: " + input.suggested_angle : "",
    "",
    "Open original: " + input.url,
    `Open Signal Radar: ${dashboardBase}/admin/signal-radar`,
  ].join("\n");

  await sendAdminEmail({
    subject,
    html,
    text,
    to: input.recipient,
    logTag: "signal-radar-immediate",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
