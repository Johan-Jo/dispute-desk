/**
 * Regression: the chained `build_defence_package` job must carry the
 * caller-supplied priority (buildPackJob passes its own claimed job's
 * priority; merchant-facing routes pass JOB_PRIORITY_INTERACTIVE).
 *
 * 2026-07-22 incident: a bulk pack backfill chained ~40 defence rebuilds
 * at the default priority, and a merchant "Rebuild defence package"
 * click — enqueued at the same priority behind them — sat ~1.5 h in a
 * queue that drains at 1 job / 2 min per shop. The UI spinner "never
 * terminated". Interactive chains now stay ahead of bulk work.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/featureFlags", () => ({
  isDefencePackageBuilderEnabled: vi.fn().mockReturnValue(true),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { maybeEnqueueDefencePackage } from "../enqueue";
import { JOB_PRIORITY_INTERACTIVE, JOB_PRIORITY_DEFAULT } from "@/lib/jobs/priorities";

const mockGetServiceClient = vi.mocked(getServiceClient);

function mockSb() {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

  function fromTable(table: string) {
    const chain: Record<string, unknown> & {
      [k: string]: unknown;
    } = {};
    let insertedValues: Record<string, unknown> | null = null;

    const dataFor = () => {
      if (table === "evidence_packs") {
        return {
          id: "pack-1",
          shop_id: "shop-1",
          dispute_id: "dispute-1",
          status: "ready",
          pack_json: {},
          completeness_score: 50,
          checklist_v2: [],
        };
      }
      if (table === "disputes") {
        return { id: "dispute-1", network_reason_code: null, reason: "fraudulent" };
      }
      if (table === "evidence_items") return [];
      if (table === "defence_packages") {
        // maybeSingle (latest lookup) answers null; single after an
        // insert answers the inserted row.
        return insertedValues ? { id: "dp-new", version: 1 } : null;
      }
      return null;
    };

    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.update = () => chain;
    chain.insert = (values: Record<string, unknown>) => {
      insertedValues = values;
      inserts.push({ table, values });
      return chain;
    };
    chain.single = async () => ({ data: dataFor(), error: null });
    chain.maybeSingle = async () => ({
      data: insertedValues ? { id: "dp-new", version: 1 } : null,
      error: null,
    });
    chain.then = (cb: (v: unknown) => unknown) => cb({ data: dataFor(), error: null });
    return chain;
  }

  return { from: fromTable, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maybeEnqueueDefencePackage job priority", () => {
  it("chained build_defence_package job inherits the given priority", async () => {
    const sb = mockSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    const result = await maybeEnqueueDefencePackage("pack-1", {
      priority: JOB_PRIORITY_INTERACTIVE,
    });

    expect(result.enqueued).toBe(true);
    const jobInsert = sb.inserts.find((i) => i.table === "jobs");
    expect(jobInsert).toBeDefined();
    expect(jobInsert?.values.job_type).toBe("build_defence_package");
    expect(jobInsert?.values.priority).toBe(JOB_PRIORITY_INTERACTIVE);
  });

  it("defaults the chained job to JOB_PRIORITY_DEFAULT when no priority is given", async () => {
    const sb = mockSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    const result = await maybeEnqueueDefencePackage("pack-1");

    expect(result.enqueued).toBe(true);
    const jobInsert = sb.inserts.find((i) => i.table === "jobs");
    expect(jobInsert?.values.priority).toBe(JOB_PRIORITY_DEFAULT);
  });
});
