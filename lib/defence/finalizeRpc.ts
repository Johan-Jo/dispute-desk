/**
 * Strict parsing of the two transactional lifecycle RPCs.
 *
 * WHY THIS IS NOT INLINE `as` CASTS. All three callers used to read the RPC
 * reply as `(data ?? {}) as { outcome?: string }` and branch on two known
 * strings, so **anything else was success**: `null`, an array, `{}`, a
 * misspelled outcome, a `promoted` with no job when a job was required. Each
 * of those wrote finalization and supersession audits claiming work the
 * database may never have done.
 *
 * An unrecognised reply is not a success and not a refusal — it is an
 * *unknown*, and the only honest handling of an unknown is the same as a
 * transport failure: report unavailable, retry, write nothing.
 */

export interface FinalizePromoted {
  kind: "promoted";
  packageId: string;
  supersededId: string | null;
  supersededVersion: number | null;
  jobId: string | null;
}

export interface FinalizeAlreadyDone {
  kind: "already_done";
  packageId: string;
  jobId: string | null;
}

export interface RpcConflict {
  kind: "conflict";
  reason: string;
}

export interface RpcMalformed {
  kind: "malformed";
  detail: string;
}

export type FinalizeRpcResult =
  | FinalizePromoted
  | FinalizeAlreadyDone
  | RpcConflict
  | RpcMalformed;

export type EnqueueRpcResult =
  | { kind: "enqueued"; jobId: string }
  | { kind: "already_done"; jobId: string }
  | RpcConflict
  | RpcMalformed;

function asObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * `finalize_defence_package`.
 *
 * `expectEnqueue` is the caller's own contract: when it asked the transaction
 * to enqueue the save, a success that cannot NAME the job has not proven the
 * save exists, and is therefore malformed rather than success.
 */
export function parseFinalizeRpcResult(
  data: unknown,
  opts: { expectEnqueue: boolean },
): FinalizeRpcResult {
  const o = asObject(data);
  if (!o) return { kind: "malformed", detail: "reply is not an object" };

  const outcome = str(o.outcome);
  if (!outcome) return { kind: "malformed", detail: "missing outcome" };

  if (outcome === "conflict") {
    const reason = str(o.reason);
    return reason ? { kind: "conflict", reason } : { kind: "malformed", detail: "conflict without reason" };
  }

  if (outcome === "promoted" || outcome === "already_done") {
    const packageId = str(o.package_id);
    if (!packageId) return { kind: "malformed", detail: `${outcome} without package_id` };
    const jobId = str(o.job_id);
    if (opts.expectEnqueue && !jobId) {
      return { kind: "malformed", detail: `${outcome} did not prove the save job exists` };
    }
    return outcome === "promoted"
      ? {
          kind: "promoted",
          packageId,
          supersededId: str(o.superseded_id),
          supersededVersion: num(o.superseded_version),
          jobId,
        }
      : { kind: "already_done", packageId, jobId };
  }

  return { kind: "malformed", detail: `unknown outcome "${outcome}"` };
}

/** `enqueue_defence_package_save`. Both success shapes must name the job. */
export function parseEnqueueRpcResult(data: unknown): EnqueueRpcResult {
  const o = asObject(data);
  if (!o) return { kind: "malformed", detail: "reply is not an object" };

  const outcome = str(o.outcome);
  if (!outcome) return { kind: "malformed", detail: "missing outcome" };

  if (outcome === "conflict") {
    const reason = str(o.reason);
    return reason ? { kind: "conflict", reason } : { kind: "malformed", detail: "conflict without reason" };
  }

  if (outcome === "enqueued" || outcome === "already_done") {
    const jobId = str(o.job_id);
    if (!jobId) return { kind: "malformed", detail: `${outcome} without job_id` };
    return { kind: outcome, jobId };
  }

  return { kind: "malformed", detail: `unknown outcome "${outcome}"` };
}

/** The dedupe key the auto path uses, and the durable proof that its
 *  transaction committed. */
export function finalizeDedupeKey(packageId: string): string {
  return `dpkg-finalize:${packageId}`;
}
