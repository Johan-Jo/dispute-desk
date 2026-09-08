/**
 * Batched artifact gathering — plan §5.
 * Verifies the batching constraint and the read-failure contract.
 */
import { describe, expect, it, vi } from "vitest";
import { gatherArtifactFacts } from "../gatherArtifacts";

interface Row {
  id: string;
  dispute_id: string;
  version: number;
  source_pack_id: string | null;
  content_revision: string | null;
  pdf_path: string | null;
  status: string;
  validation_status: string | null;
  failure_code: string | null;
}

function row(over: Partial<Row> & { dispute_id: string; id: string }): Row {
  return {
    version: 1,
    source_pack_id: "pack-1",
    content_revision: "rev-1",
    pdf_path: "a/b.pdf",
    status: "final",
    validation_status: "ok",
    failure_code: null,
    ...over,
  };
}

/** Minimal Supabase stub recording how many queries were issued. */
function stub(rows: Row[], error: unknown = null) {
  const calls = { count: 0 };
  const sb = {
    from() {
      calls.count += 1;
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve({ data: error ? null : rows, error }),
      };
      return chain;
    },
  };
  return { sb: sb as never, calls };
}

describe("gatherArtifactFacts", () => {
  it("issues ONE query for the whole batch (plan §5: no N+1)", async () => {
    const { sb, calls } = stub([
      row({ id: "p1", dispute_id: "d1" }),
      row({ id: "p2", dispute_id: "d2" }),
      row({ id: "p3", dispute_id: "d3" }),
    ]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1", "d2", "d3"]);
    expect(calls.count).toBe(1);
    expect(out.size).toBe(3);
  });

  it("a failed read makes EVERY dispute unknown, never absent", async () => {
    const { sb } = stub([], { message: "connection reset" });
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1", "d2"]);
    for (const id of ["d1", "d2"]) {
      expect(out.get(id)!.artifact).toEqual({ state: "unknown", reason: "read_failed" });
      expect(out.get(id)!.attempt.state).toBe("unknown");
    }
  });

  it("a dispute with no rows is absent when the read succeeded", async () => {
    const { sb } = stub([row({ id: "p1", dispute_id: "d1" })]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1", "d2"]);
    expect(out.get("d2")!.artifact.state).toBe("absent");
    expect(out.get("d2")!.attempt.state).toBe("none");
  });

  it("validation_failed with no pdf -> absent artifact, failed attempt", async () => {
    // PROD: the cohort's shape before repair.
    const { sb } = stub([
      row({ id: "p2", dispute_id: "d1", version: 2, pdf_path: null, status: "failed", validation_status: "failed", failure_code: "validation_failed" }),
      row({ id: "p1", dispute_id: "d1", version: 1, status: "stale" }),
    ]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1"]);
    expect(out.get("d1")!.artifact.state).toBe("absent");
    expect(out.get("d1")!.attempt.state).toBe("failed");
    expect(out.get("d1")!.attempt.cause).toBe("validation_failed");
  });

  it("skipped/no_bank_eligible_facts -> declined, not a readiness claim", async () => {
    const { sb } = stub([
      row({ id: "p1", dispute_id: "d1", pdf_path: null, status: "skipped", validation_status: null, failure_code: "no_bank_eligible_facts" }),
    ]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1"]);
    expect(out.get("d1")!.attempt.state).toBe("declined");
    expect(out.get("d1")!.artifact.state).toBe("absent");
  });

  it("without job observations no in-flight claim is licensed", async () => {
    const { sb } = stub([
      row({ id: "p1", dispute_id: "d1", pdf_path: null, status: "draft", validation_status: null }),
    ]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1"]);
    // jobReadOk false => cannot claim queued/running from silence.
    expect(["unknown"]).toContain(out.get("d1")!.attempt.state);
  });

  it("freshness defaults to unknown rather than being guessed", async () => {
    const { sb } = stub([row({ id: "p1", dispute_id: "d1" })]);
    const out = await gatherArtifactFacts(sb, "shop-1", ["d1"]);
    const a = out.get("d1")!.artifact;
    expect(a.state).toBe("present");
    if (a.state !== "present") throw new Error("unreachable");
    expect(a.freshness).toBe("unknown");
  });

  it("an empty dispute list issues no query at all", async () => {
    const { sb, calls } = stub([]);
    const out = await gatherArtifactFacts(sb, "shop-1", []);
    expect(calls.count).toBe(0);
    expect(out.size).toBe(0);
  });

  it("does not select narrative or plan payloads", async () => {
    // Plan §5: a list row must not pull an LLM payload to compute status.
    const selectSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: selectSpy,
      eq: () => chain,
      in: () => chain,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    const sb = { from: () => chain } as never;
    await gatherArtifactFacts(sb, "shop-1", ["d1"]);
    const cols = String(selectSpy.mock.calls[0]?.[0] ?? "");
    expect(cols).not.toMatch(/narrative_json|plan_json|facts_json/);
    expect(cols).toMatch(/pdf_path/);
  });
});
