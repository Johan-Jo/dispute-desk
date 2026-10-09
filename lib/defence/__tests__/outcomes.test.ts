import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factCountsByCategory, failureSignature, llmErrorClass, SKIP_REASON } from "../outcomes";

describe("non-letter outcome records", () => {
  it("builds a signature that ignores rule order and drops absent parts", () => {
    const a = failureSignature({
      code: "no_counsel_letter",
      moduleKey: "credit_not_processed",
      brief: "general",
      paymentFamily: "klarna",
      rules: ["grounding.unsupported_specific", "copy.specific_repeated", "copy.specific_repeated"],
    });
    const b = failureSignature({
      code: "no_counsel_letter",
      moduleKey: "credit_not_processed",
      brief: "general",
      paymentFamily: "klarna",
      rules: ["copy.specific_repeated", "grounding.unsupported_specific"],
    });
    expect(a).toBe(b);
    expect(a).toBe("no_counsel_letter · credit_not_processed · general · klarna · copy.specific_repeated,grounding.unsupported_specific");
    expect(failureSignature({ code: "pdf_render_failed", moduleKey: null })).toBe("pdf_render_failed");
    expect(failureSignature({ code: "no_bank_eligible_facts", moduleKey: "inr_product_not_received", detail: "record_context_only" })).toBe(
      "no_bank_eligible_facts · inr_product_not_received · record_context_only",
    );
  });

  it("classes the model errors seen in production", () => {
    expect(llmErrorClass("counsel v2 error: Expected ',' or ']' after array element in JSON at position 113 (line 3 column 97)")).toBe("json_parse");
    expect(llmErrorClass('counsel v2 error: Unexpected token \'a\', ..."eather!", and the fu"... is not valid JSON')).toBe("json_parse");
    expect(llmErrorClass("JSON parse failed on attempt 2: I need to carefully analyze the approved facts")).toBe("json_parse");
    expect(llmErrorClass('Claude API error 400: {"type":"error","error":{"type":"invalid_request_error"}}')).toBe("api_4xx");
    expect(llmErrorClass("Claude API error 529: overloaded")).toBe("api_5xx");
    expect(llmErrorClass("counsel v2 error: request timed out")).toBe("timeout");
    expect(llmErrorClass("counsel v2 error: empty model reply")).toBe("other");
  });

  it("counts approved facts by category, in a stable order", () => {
    expect(factCountsByCategory([{ category: "shipping_tracking" }, { category: "delivery_proof" }, { category: "shipping_tracking" }])).toEqual({
      delivery_proof: 1,
      shipping_tracking: 2,
    });
    expect(Object.keys(factCountsByCategory([{ category: "b" }, { category: "a" }]))).toEqual(["a", "b"]);
  });

  /* Five skips used to store one sentence. Each exit in the job and at
   * enqueue names itself; a `markSkipped` call without an exit does not
   * compile, and this pins that every job site passes a distinct one. */
  it("every skip site in the build job names its exit", () => {
    const src = readFileSync(join(__dirname, "..", "..", "jobs", "handlers", "buildDefencePackageJob.ts"), "utf8");
    const calls = src.match(/await markSkipped\([\s\S]*?\);/g) ?? [];
    expect(calls).toHaveLength(5);
    const exits = ["classifier_ineligible", "fatal_loss", "no_safe_argument", "record_context_only", "claim_scoped_empty"] as const;
    for (const e of exits) expect(calls.filter((c) => c.includes(`"${e}"`)), e).toHaveLength(1);
    for (const e of [...exits, "covered_shopify" as const]) expect(SKIP_REASON[e].length).toBeGreaterThan(20);
    expect(new Set(Object.values(SKIP_REASON)).size).toBe(Object.keys(SKIP_REASON).length);
  });

  it("the package route never returns the writer's replay input", () => {
    const route = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "defence-packages", "[id]", "route.ts"), "utf8");
    expect(route).toMatch(/counsel_replay_json: _replay, \.\.\.pkg/);
    expect(route).toMatch(/NextResponse\.json\(\{ package: pkg \}\)/);
    const workspace = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "disputes", "[id]", "workspace", "route.ts"), "utf8");
    expect(workspace).not.toMatch(/counsel_replay_json/);
    expect(workspace).not.toMatch(/from\("defence_packages"\)\s*\.select\("\*"\)/);
  });
});
