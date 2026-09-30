import { describe, expect, it } from "vitest";
import { selectPending } from "../runPendingAnalyses";

describe("selectPending", () => {
  const submitted = new Set(["a", "b", "c", "d"]);

  it("picks a decided dispute with a filed package and no analysis", () => {
    expect(selectPending([{ id: "a", final_outcome: "won" }], submitted, [])).toEqual(["a"]);
  });

  it("skips a dispute with no submitted package (nothing of ours to analyse)", () => {
    expect(selectPending([{ id: "z", final_outcome: "lost" }], submitted, [])).toEqual([]);
  });

  it("never re-analyses a dispute whose outcome is unchanged", () => {
    expect(
      selectPending(
        [{ id: "b", final_outcome: "lost" }],
        submitted,
        [{ dispute_id: "b", final_outcome_snapshot: "lost" }],
      ),
    ).toEqual([]);
  });

  it("re-analyses when the outcome changed since the current analysis (reopened, decided again)", () => {
    expect(
      selectPending(
        [{ id: "c", final_outcome: "won" }],
        submitted,
        [{ dispute_id: "c", final_outcome_snapshot: "lost" }],
      ),
    ).toEqual(["c"]);
  });

  it("keeps the caller's order", () => {
    expect(
      selectPending(
        [
          { id: "d", final_outcome: "won" },
          { id: "a", final_outcome: "lost" },
        ],
        submitted,
        [],
      ),
    ).toEqual(["d", "a"]);
  });
});
