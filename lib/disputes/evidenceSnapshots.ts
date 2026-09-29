/**
 * Observe-only snapshots of what Shopify holds on open disputes
 * (retained-evidence plan §1, Rollout 3). Written by the hourly sync AFTER
 * applyDisputeSnapshot, so a row is never tagged with the previous cycle once
 * a reopen has been reconciled.
 *
 * A new row only when the status or the content changes; otherwise
 * `last_confirmed_at` moves. Read at most once a day per dispute unless its
 * status changed since the last row. Nothing here decides anything yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearableFieldHashes,
  evidenceContentHash,
  type EvidenceRecordRead,
} from "@/lib/shopify/evidenceRecord";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads per sync run. The sync job already runs close to the worker's 300 s
 * limit on the largest shops; the first prod run (2026-09-29) read 50
 * disputes on one shop and two shops only finished on their last attempt.
 * Anything over the cap is read on the next hourly run.
 */
export const MAX_READS_PER_RUN = 15;
const OPEN_STATUSES = new Set(["needs_response", "under_review"]);

export function evidenceSnapshotsEnabled(): boolean {
  return process.env.EVIDENCE_SNAPSHOTS !== "off";
}

export interface SnapshotCandidate {
  disputeId: string;
  status: string | null;
}

interface LatestRow {
  id: string;
  dispute_id: string;
  observed_status: string;
  content_hash: string;
  cycle: number;
  last_confirmed_at: string;
}

/** Read when the status moved since the last row, or the last read is a day old. */
export function needsRead(latest: LatestRow | undefined, status: string, now: number): boolean {
  if (!latest) return true;
  if (latest.observed_status !== status) return true;
  return now - new Date(latest.last_confirmed_at).getTime() >= DAY_MS;
}

export interface SnapshotDeps {
  read: (disputeEvidenceGid: string) => Promise<EvidenceRecordRead>;
  now?: () => number;
}

export async function recordEvidenceSnapshots(
  sb: SupabaseClient,
  shopId: string,
  candidates: SnapshotCandidate[],
  deps: SnapshotDeps,
): Promise<{ read: number; inserted: number; confirmed: number; errors: string[] }> {
  const out = { read: 0, inserted: 0, confirmed: 0, errors: [] as string[] };
  const open = candidates.filter((c) => c.status && OPEN_STATUSES.has(c.status));
  if (open.length === 0) return out;
  const now = (deps.now ?? Date.now)();
  const ids = open.map((c) => c.disputeId);

  const { data: disputes, error: dErr } = await sb
    .from("disputes")
    .select("id, status, response_cycle, dispute_evidence_gid")
    .in("id", ids);
  if (dErr) {
    out.errors.push(`evidence_snapshots: ${dErr.message}`);
    return out;
  }

  const { data: rows, error: sErr } = await sb
    .from("shopify_evidence_snapshots")
    .select("id, dispute_id, observed_status, content_hash, cycle, last_confirmed_at, read_at")
    .in("dispute_id", ids)
    .order("read_at", { ascending: false });
  if (sErr) {
    out.errors.push(`evidence_snapshots: ${sErr.message}`);
    return out;
  }
  const latest = new Map<string, LatestRow>();
  for (const r of (rows ?? []) as LatestRow[]) {
    if (!latest.has(r.dispute_id)) latest.set(r.dispute_id, r);
  }

  // Priority: status moved (a reopen needs its row now), then never
  // snapshotted, then oldest confirmation.
  const due: { d: Record<string, unknown>; gid: string; status: string; prev: LatestRow | undefined; rank: number; age: number }[] = [];
  for (const d of disputes ?? []) {
    const status = String(d.status ?? "").toLowerCase();
    const gid = d.dispute_evidence_gid as string | null;
    if (!gid || !OPEN_STATUSES.has(status)) continue;
    const prev = latest.get(d.id as string);
    if (!needsRead(prev, status, now)) continue;
    const rank = prev && prev.observed_status !== status ? 0 : !prev ? 1 : 2;
    const age = prev ? new Date(prev.last_confirmed_at).getTime() : 0;
    due.push({ d, gid, status, prev, rank, age });
  }
  due.sort((a, b) => a.rank - b.rank || a.age - b.age);

  for (const { d, gid, status, prev } of due.slice(0, MAX_READS_PER_RUN)) {
    const res = await deps.read(gid);
    out.read++;
    if (!res.ok) {
      out.errors.push(`${d.id}: evidence read failed: ${res.error}`);
      continue;
    }
    const cycle = (d.response_cycle as number | null) ?? 1;
    const contentHash = evidenceContentHash(res.record);
    const nowIso = new Date(now).toISOString();

    if (prev && prev.observed_status === status && prev.content_hash === contentHash && prev.cycle === cycle) {
      await sb.from("shopify_evidence_snapshots").update({ last_confirmed_at: nowIso }).eq("id", prev.id);
      out.confirmed++;
      continue;
    }
    const { error: insErr } = await sb.from("shopify_evidence_snapshots").insert({
      shop_id: shopId,
      dispute_id: d.id,
      cycle,
      observed_status: status,
      text_fields: res.record.text,
      file_slots: res.record.files,
      field_hashes: clearableFieldHashes(res.record),
      content_hash: contentHash,
      read_at: nowIso,
      last_confirmed_at: nowIso,
    });
    if (insErr) out.errors.push(`${d.id}: snapshot insert failed: ${insErr.message}`);
    else out.inserted++;
  }
  return out;
}

