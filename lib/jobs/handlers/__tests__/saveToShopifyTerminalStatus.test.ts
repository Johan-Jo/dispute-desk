/**
 * Track S — every return from the save handler leaves a terminal pack status.
 *
 * One test per return site. "Terminal" means the pack no longer claims
 * anything the world doesn't back: `save_failed` when the failure is
 * non-retriable or the job is out of attempts, `saving` while a retry is still
 * coming, a saved status on success. Before this, the PDF download / upload /
 * size paths returned `retriable` and left the enqueue's `saved_to_shopify`
 * stamp in place (whj8db-1q #23750: "saved" for nine days, Shopify answering
 * HTTP 422 to every upload).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/shopify/graphql", () => ({ requestShopifyGraphQL: vi.fn() }));
vi.mock("@/lib/shopify/sessions/getShopBackgroundSession", () => ({
  getShopBackgroundSession: vi.fn(),
  assertNotAuthInvalid: vi.fn(),
  ShopifyAuthInvalidError: class extends Error {
    sessionType: string;
    rawMessage: string;
    constructor(sessionType = "offline", rawMessage = "") {
      super(rawMessage);
      this.sessionType = sessionType;
      this.rawMessage = rawMessage;
    }
  },
}));
vi.mock("@/lib/shopify/disputeFileUpload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/disputeFileUpload")>(
    "@/lib/shopify/disputeFileUpload",
  );
  return { ...actual, uploadDisputeFile: vi.fn(), MAX_FILE_SIZE_BYTES: 2_000 };
});
vi.mock("@/lib/shopify/merchantEvidenceFile", () => ({ readUncategorizedFile: vi.fn() }));
vi.mock("@/lib/defence/merchantFileGuard", () => ({ guardMerchantFileSlot: vi.fn() }));
vi.mock("@/lib/defence/merchantFileAnnex", () => ({
  appendMerchantFile: vi.fn(),
  hasMerchantFileApproval: vi.fn(),
  merchantFileAnnexEnabled: false,
}));
vi.mock("@/lib/defence/storage", () => ({ downloadDefencePdf: vi.fn() }));
vi.mock("@/lib/defence/pdf/scanCoordinates", () => ({ findOutOfRangeOperand: vi.fn() }));
vi.mock("@/lib/defence/enqueue", () => ({ maybeEnqueueDefencePackage: vi.fn() }));
vi.mock("@/lib/defence/packageSafety", () => ({
  assessPackageCandidateSafety: vi.fn(),
  packageBlockSummary: () => "blocked",
}));
vi.mock("@/lib/defence/orderContext", () => ({ merchantNameFromDomain: () => "TestMerchant" }));
vi.mock("@/lib/disputes/bankClaim", () => ({
  bankClaimBlocksFiling: vi.fn(),
  bankClaimInputFromRow: () => ({}),
  bankClaimTrigger: () => "reopened",
}));
vi.mock("@/lib/shopify/verifyEvidenceReadback", () => ({ verifyEvidenceReadback: vi.fn() }));
vi.mock("../saveToShopifyEvents", () => ({ emitSaveToShopifyEvents: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/automation/rebuildOutcome", () => ({
  isRegenerateBuild: vi.fn(),
  stampRebuildOutcome: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pipeline/activation", () => ({ canonicalPipelineEnabled: vi.fn() }));
vi.mock("@/lib/automation/settings", () => ({ getShopSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/defence/package", () => ({ selectForSaveWorker: vi.fn() }));
vi.mock("@/lib/email/sendSaveFailedAdminAlert", () => ({
  sendSaveFailedAdminAlert: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  getShopBackgroundSession,
  assertNotAuthInvalid,
  ShopifyAuthInvalidError,
} from "@/lib/shopify/sessions/getShopBackgroundSession";
import { uploadDisputeFile, DisputeFileUploadError } from "@/lib/shopify/disputeFileUpload";
import { guardMerchantFileSlot } from "@/lib/defence/merchantFileGuard";
import { downloadDefencePdf } from "@/lib/defence/storage";
import { findOutOfRangeOperand } from "@/lib/defence/pdf/scanCoordinates";
import { maybeEnqueueDefencePackage } from "@/lib/defence/enqueue";
import { assessPackageCandidateSafety } from "@/lib/defence/packageSafety";
import { bankClaimBlocksFiling } from "@/lib/disputes/bankClaim";
import { verifyEvidenceReadback } from "@/lib/shopify/verifyEvidenceReadback";
import { canonicalPipelineEnabled } from "@/lib/pipeline/activation";
import { selectForSaveWorker } from "@/lib/defence/package";
import { sendSaveFailedAdminAlert } from "@/lib/email/sendSaveFailedAdminAlert";
import { handleSaveToShopify } from "../saveToShopifyJob";
import type { ClaimedJob } from "../../claimJobs";

const PACK_ID = "pack-1";
const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  shopId: SHOP_ID,
  jobType: "save_to_shopify",
  entityId: PACK_ID,
  attempts: 1,
  maxAttempts: 3,
  ...over,
});

interface Fixture {
  pack: Record<string, unknown>;
  dispute: Record<string, unknown> | null;
  dpkg: Record<string, unknown> | null;
  buildJobs: unknown[];
  /** audit_events rows visible to the handler's own dedupe queries. */
  audit: Array<Record<string, unknown>>;
}

let fx: Fixture;
let writes: Array<{ table: string; op: "update" | "insert"; patch: Record<string, unknown> }>;

function freshFixture(): Fixture {
  return {
    pack: { id: PACK_ID, shop_id: SHOP_ID, dispute_id: DISPUTE_ID, status: "saving", response_cycle: 1 },
    dispute: {
      id: DISPUTE_ID,
      dispute_evidence_gid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
      dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1234",
      reason: "fraudulent",
      amount: "10",
      currency_code: "USD",
      customer_display_name: "Test User",
      customer_email: "t@example.com",
      submission_state: "not_saved",
      response_cycle: 1,
      order_name: "#1",
      due_at: "2026-11-20T23:00:00Z",
    },
    dpkg: { id: "pkg-1", version: 3, status: "final", pdf_path: "s/d/v3.pdf", facts_json: {}, narrative_json: {} },
    buildJobs: [],
    audit: [],
  };
}

function installSupabase() {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    for (const m of ["select", "neq", "in", "order", "limit", "gte", "or", "is", "not"]) {
      b[m] = () => b;
    }
    b.eq = (col: string, val: unknown) => {
      filters.push([col, val]);
      return b;
    };
    const row = () => {
      if (table === "evidence_packs") return fx.pack;
      if (table === "disputes") return fx.dispute;
      if (table === "defence_packages") return fx.dpkg;
      if (table === "shops") return { shop_domain: "shop.myshopify.com" };
      return null;
    };
    b.single = async () => ({ data: row(), error: null });
    b.maybeSingle = async () => ({ data: row(), error: null });
    b.update = (patch: Record<string, unknown>) => {
      writes.push({ table, op: "update", patch });
      return b;
    };
    b.insert = (patch: Record<string, unknown>) => {
      writes.push({ table, op: "insert", patch });
      return b;
    };
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const matches = (r: Record<string, unknown>) =>
        filters.every(([col, val]) => {
          if (col.includes("->>")) {
            const key = col.split("->>")[1];
            return String((r.event_payload as Record<string, unknown> | undefined)?.[key]) === String(val);
          }
          return r[col] === val;
        });
      const list =
        table === "jobs"
          ? fx.buildJobs
          : table === "audit_events"
            ? fx.audit.filter(matches)
            : [];
      return Promise.resolve({ data: list, error: null }).then(res, rej);
    };
    return b;
  };
  vi.mocked(getServiceClient).mockReturnValue({ from } as never);
}

const packStatusWrites = () =>
  writes.filter((w) => w.table === "evidence_packs" && "status" in w.patch).map((w) => w.patch.status);
const lastPackStatus = () => packStatusWrites().at(-1);
const attentionWrite = () =>
  writes.find((w) => w.table === "disputes" && w.patch.attention_reason === "submission_failed");
const auditTypes = () => vi.mocked(logAuditEvent).mock.calls.map((c) => c[0].eventType);
const auditPayload = (type: string) =>
  vi.mocked(logAuditEvent).mock.calls.find((c) => c[0].eventType === type)?.[0].eventPayload as
    | Record<string, unknown>
    | undefined;

/** A deliberate refusal: pack back to `ready`, an audit row, and NOTHING that
 *  reads as a failure (no submission_failed banner, no admin email). */
function expectRefusal(errorClass: string) {
  expect(lastPackStatus()).toBe("ready");
  expect(auditPayload("save_refused")?.error_class).toBe(errorClass);
  expect(auditTypes()).not.toContain("job_failed");
  expect(attentionWrite()).toBeUndefined();
  expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(logAuditEvent).mockResolvedValue(undefined);
  fx = freshFixture();
  writes = [];
  installSupabase();
  vi.mocked(canonicalPipelineEnabled).mockReturnValue(false);
  vi.mocked(bankClaimBlocksFiling).mockResolvedValue(false);
  vi.mocked(assessPackageCandidateSafety).mockReturnValue({ safe: true, reasons: [], retiredKeys: [] } as never);
  vi.mocked(downloadDefencePdf).mockResolvedValue(Buffer.from("%PDF-small"));
  vi.mocked(findOutOfRangeOperand).mockResolvedValue(null);
  vi.mocked(maybeEnqueueDefencePackage).mockResolvedValue({
    enqueued: true, reason: "new_draft", packageId: "pkg-2", version: 4, status: "draft",
  });
  vi.mocked(getShopBackgroundSession).mockResolvedValue({
    accessToken: "tok", shopDomain: "shop.myshopify.com", sessionType: "offline", userId: null,
  } as never);
  vi.mocked(guardMerchantFileSlot).mockImplementation((async (bytes: Buffer) => ({
    action: "proceed", pdfBytes: bytes,
  })) as never);
  vi.mocked(sendSaveFailedAdminAlert).mockResolvedValue(undefined);
});

/* ── pack-level guard: NOT a started job, must not touch the pack ───────── */

describe("status guard", () => {
  it("refuses a pack that is already saved without rewriting it", async () => {
    fx.pack.status = "saved_to_shopify_verified";
    const r = await handleSaveToShopify(job());
    expect(r).toMatchObject({ ok: false, retriable: false });
    expect(packStatusWrites()).toEqual([]);
  });

  it("accepts a save_failed pack — it is re-savable", async () => {
    fx.pack.status = "save_failed";
    fx.dpkg = null; // stop at the next site; the point is that the guard let it in
    const r = await handleSaveToShopify(job());
    expect(r).toMatchObject({ ok: false });
    expect(auditPayload("job_failed")?.error_class).toBe("no_defence_package");
  });
});

/* ── one test per failing return site ───────────────────────────────────── */

describe("every failing return after start leaves a terminal pack status", () => {
  it("stale response cycle → REFUSED: pack ready, no submission_failed, no email", async () => {
    fx.pack.response_cycle = 1;
    fx.dispute!.response_cycle = 2;
    const r = await handleSaveToShopify(job());
    expect(r).toMatchObject({ ok: false, retriable: false });
    expectRefusal("stale_response_cycle");
  });

  it("bank claim missing → REFUSED", async () => {
    vi.mocked(bankClaimBlocksFiling).mockResolvedValue(true);
    const r = await handleSaveToShopify(job());
    expect(r).toMatchObject({ ok: false, retriable: false });
    expectRefusal("bank_claim_missing");
  });

  it("no evidence GID → save_failed", async () => {
    fx.dispute!.dispute_evidence_gid = null;
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("no numeric dispute id → save_failed", async () => {
    fx.dispute!.dispute_gid = "not-a-gid";
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("canonical selector refuses → REFUSED", async () => {
    vi.mocked(canonicalPipelineEnabled).mockReturnValue(true);
    vi.mocked(selectForSaveWorker).mockResolvedValue({
      selection: { outcome: "none", reason: "stale" }, unsafeContent: false, judged: null,
    } as never);
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expectRefusal("defence_package_not_fileable");
  });

  it("canonical selector returns an unpromoted draft → retriable wait, pack saving, no alert", async () => {
    vi.mocked(canonicalPipelineEnabled).mockReturnValue(true);
    vi.mocked(selectForSaveWorker).mockResolvedValue({
      selection: { outcome: "selected", package: { requiresFinalize: true } }, unsafeContent: false, judged: null,
    } as never);
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
    expect(attentionWrite()).toBeUndefined();
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
  });

  it("no defence package → save_failed", async () => {
    fx.dpkg = null;
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("package not final, no build running → save_failed", async () => {
    fx.dpkg!.status = "draft";
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("package not final, build in flight → retriable, pack stays saving", async () => {
    fx.dpkg!.status = "draft";
    fx.buildJobs = [{ id: "bj-1" }];
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
    expect(attentionWrite()).toBeUndefined();
  });

  it("final package without a PDF path → save_failed", async () => {
    fx.dpkg!.pdf_path = null;
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("unsafe candidate → REFUSED", async () => {
    vi.mocked(assessPackageCandidateSafety).mockReturnValue({
      safe: false, reasons: ["retired_delivery_fact"], retiredKeys: [],
    } as never);
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expectRefusal("defence_package_unsafe_claim");
  });

  it("PDF download fails, attempts remain → retriable, pack saving (not saved)", async () => {
    vi.mocked(downloadDefencePdf).mockRejectedValue(new Error("storage 503"));
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
    expect(attentionWrite()).toBeUndefined();
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
  });

  it("PDF download fails on the LAST attempt → save_failed + submission_failed + admin email", async () => {
    vi.mocked(downloadDefencePdf).mockRejectedValue(new Error("storage 503"));
    const r = await handleSaveToShopify(job({ attempts: 3, maxAttempts: 3 }));
    expect(r).toMatchObject({ ok: false });
    expect(lastPackStatus()).toBe("save_failed");
    expect(attentionWrite()?.patch).toMatchObject({ needs_attention: true });
    expect(sendSaveFailedAdminAlert).toHaveBeenCalledTimes(1);
    expect(auditTypes()).toContain("save_failed_admin_alerted");
  });

  it("PDF too large → save_failed", async () => {
    vi.mocked(downloadDefencePdf).mockResolvedValue(Buffer.alloc(5_000));
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
    expect(auditPayload("job_failed")).toMatchObject({ error_class: "defence_pdf_too_large", size_bytes: 5_000 });
  });

  it("stale PDF → NOT uploaded, rebuild queued, audit row, retriable, pack saving", async () => {
    vi.mocked(findOutOfRangeOperand).mockResolvedValue({ page: 4, value: 1.45e10 });
    const r = await handleSaveToShopify(job({ attempts: 1 }));
    expect(r).toMatchObject({ ok: false, retriable: true });
    expect(uploadDisputeFile).not.toHaveBeenCalled();
    expect(maybeEnqueueDefencePackage).toHaveBeenCalledWith(PACK_ID);
    expect(auditPayload("save_deferred_stale_pdf")).toMatchObject({
      page: 4, operand: 1.45e10, rebuild_enqueued: true, rebuild_package_id: "pkg-2",
    });
    expect(lastPackStatus()).toBe("saving");
  });

  it("stale PDF with no attempts left → save_failed", async () => {
    vi.mocked(findOutOfRangeOperand).mockResolvedValue({ page: 4, value: 1.45e10 });
    await handleSaveToShopify(job({ attempts: 3, maxAttempts: 3 }));
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("a PDF the scan cannot read is still uploaded (Shopify is the judge)", async () => {
    vi.mocked(findOutOfRangeOperand).mockRejectedValue(new Error("not a pdf"));
    vi.mocked(uploadDisputeFile).mockRejectedValue(new Error("stop here"));
    await handleSaveToShopify(job());
    expect(uploadDisputeFile).toHaveBeenCalledTimes(1);
  });

  it("merchant-file slot guard refuses (non-retriable) → save_failed", async () => {
    vi.mocked(guardMerchantFileSlot).mockResolvedValue({
      action: "refuse", retriable: false, reason: "merchant_file_would_be_replaced",
    } as never);
    expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("Shopify 422 on the file upload is non-retriable → save_failed on the FIRST attempt", async () => {
    vi.mocked(uploadDisputeFile).mockRejectedValue(
      new DisputeFileUploadError("shopify_rejection", "Shopify HTTP 422 …", 422, "req-1"),
    );
    const r = await handleSaveToShopify(job({ attempts: 1 }));
    expect(r).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
    expect(auditPayload("job_failed")).toMatchObject({
      error_class: "shopify_upload_rejected", http_status: 422, shopify_request_id: "req-1",
    });
    expect(attentionWrite()).toBeDefined();
  });

  it("Shopify 5xx on the file upload retries → pack saving", async () => {
    vi.mocked(uploadDisputeFile).mockRejectedValue(
      new DisputeFileUploadError("shopify_rejection", "Shopify HTTP 503", 503),
    );
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
  });

  it("Shopify 429 on the file upload retries (timing, not a verdict on the file)", async () => {
    vi.mocked(uploadDisputeFile).mockRejectedValue(
      new DisputeFileUploadError("shopify_rejection", "Shopify HTTP 429", 429),
    );
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
  });

  it("a non-Shopify upload error (network) retries → pack saving", async () => {
    vi.mocked(uploadDisputeFile).mockRejectedValue(new Error("ECONNRESET"));
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
  });

  describe("after a successful upload", () => {
    beforeEach(() => {
      vi.mocked(uploadDisputeFile).mockResolvedValue({
        fileId: "9", fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/9",
        mutationField: "uncategorizedFile", disputeEvidenceGid: null, requestId: null,
      });
    });

    it("auth invalid → save_failed", async () => {
      vi.mocked(requestShopifyGraphQL).mockResolvedValue({ data: {}, errors: [{ message: "401" }] } as never);
      vi.mocked(assertNotAuthInvalid).mockImplementation(() => {
        // The module is mocked with a two-argument stand-in; the real class has three.
        const MockedAuthError = ShopifyAuthInvalidError as unknown as new (a: string, b: string) => Error;
        throw new MockedAuthError("offline", "token revoked");
      });
      expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
      expect(lastPackStatus()).toBe("save_failed");
      expect(auditPayload("job_failed")?.error_class).toBe("shopify_auth_invalid");
    });

    it("GraphQL errors with attempts left → retriable, pack saving (not save_failed)", async () => {
      vi.mocked(requestShopifyGraphQL).mockResolvedValue({ errors: [{ message: "throttled" }] } as never);
      expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
      expect(lastPackStatus()).toBe("saving");
    });

    it("GraphQL errors on the last attempt → save_failed", async () => {
      vi.mocked(requestShopifyGraphQL).mockResolvedValue({ errors: [{ message: "throttled" }] } as never);
      await handleSaveToShopify(job({ attempts: 3, maxAttempts: 3 }));
      expect(lastPackStatus()).toBe("save_failed");
    });

    it("userErrors → save_failed", async () => {
      vi.mocked(requestShopifyGraphQL).mockResolvedValue({
        data: { disputeEvidenceUpdate: { userErrors: [{ message: "nope" }] } },
      } as never);
      expect(await handleSaveToShopify(job())).toMatchObject({ ok: false, retriable: false });
      expect(lastPackStatus()).toBe("save_failed");
      expect(auditPayload("job_failed")?.user_errors).toEqual([{ message: "nope" }]);
    });

    it("success → saved status, submission_state saved, submission_failed cleared", async () => {
      vi.mocked(requestShopifyGraphQL).mockResolvedValue({
        data: { disputeEvidenceUpdate: { userErrors: [], disputeEvidence: { id: "e1" } } },
      } as never);
      vi.mocked(verifyEvidenceReadback).mockResolvedValue({
        diff: { verified: true }, evidenceNode: {},
      } as never);
      const r = await handleSaveToShopify(job());
      expect(r).toEqual({ ok: true });
      expect(lastPackStatus()).toBe("saved_to_shopify_verified");
      expect(
        writes.find((w) => w.table === "disputes" && w.patch.submission_state === "saved_to_shopify"),
      ).toBeDefined();
      const cleared = writes.find(
        (w) => w.table === "disputes" && w.patch.attention_reason === null && w.patch.needs_attention === false,
      );
      expect(cleared).toBeDefined();
    }, 15000);
  });

  it("an exception thrown mid-handler is settled before it propagates (pack saving, not stamped)", async () => {
    vi.mocked(getShopBackgroundSession).mockRejectedValue(new Error("session store down"));
    await expect(handleSaveToShopify(job({ attempts: 1 }))).rejects.toThrow("session store down");
    expect(lastPackStatus()).toBe("saving");
    expect(auditPayload("job_failed")?.error_class).toBe("unhandled_exception");
  });
});

/* ── submission_failed + the once-a-day admin email ─────────────────────── */

describe("submission_failed and the ops alert", () => {
  it("does not email twice for the same dispute within a day", async () => {
    fx.dpkg = null;
    fx.audit = [{ event_type: "save_failed_admin_alerted", dispute_id: DISPUTE_ID, shop_id: SHOP_ID, event_payload: { error_class: "no_defence_package", suppressed: false } }];
    await handleSaveToShopify(job());
    expect(lastPackStatus()).toBe("save_failed");
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
  });

  it("emails once when none was sent in the last day", async () => {
    fx.dpkg = null;
    await handleSaveToShopify(job());
    expect(sendSaveFailedAdminAlert).toHaveBeenCalledTimes(1);
    expect(sendSaveFailedAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: DISPUTE_ID, errorClass: "no_defence_package", orderName: "#1" }),
    );
  });

  it("never overwrites another attention reason (only null or submission_failed)", async () => {
    fx.dpkg = null;
    await handleSaveToShopify(job());
    // The conditional is expressed in the query (`.or(...)`); the write itself
    // must carry the structured payload the banner needs.
    expect(attentionWrite()?.patch).toMatchObject({
      attention_reason: "submission_failed",
      attention_payload: expect.objectContaining({ pack_id: PACK_ID, job_id: "job-1", error_class: "no_defence_package" }),
    });
  });
});

/* ── canonical pipeline ON (production) ─────────────────────────────────── */

describe("canonical pipeline on", () => {
  beforeEach(() => {
    vi.mocked(canonicalPipelineEnabled).mockReturnValue(true);
  });
  const selected = (requiresFinalize = false) =>
    vi.mocked(selectForSaveWorker).mockResolvedValue({
      selection: { outcome: "selected", package: { requiresFinalize } }, unsafeContent: false, judged: null,
    } as never);

  it("stale PDF: ONE rebuild, the retry waits on the unbuilt draft, then ONE successful save", async () => {
    // 1. the stored v3 PDF is out of range -> deferred, one rebuild queued
    selected();
    vi.mocked(findOutOfRangeOperand).mockResolvedValue({ page: 4, value: 1.45e10 });
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(maybeEnqueueDefencePackage).toHaveBeenCalledTimes(1);
    expect(lastPackStatus()).toBe("saving");

    // 2. retry while the new draft (pkg-2) builds: the canonical selector would
    //    judge the unbuilt draft and refuse it; the in-flight check runs first.
    fx.dpkg = { id: "pkg-2", version: 4, status: "draft", pdf_path: null };
    fx.buildJobs = [{ id: "bj-1" }];
    vi.mocked(selectForSaveWorker).mockClear();
    const r2 = await handleSaveToShopify(job({ attempts: 2 }));
    expect(r2).toMatchObject({ ok: false, retriable: true });
    expect(selectForSaveWorker).not.toHaveBeenCalled();
    expect(lastPackStatus()).toBe("saving");
    expect(attentionWrite()).toBeUndefined();
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();

    // 3. the rebuilt package is final with a clean PDF: one successful save
    fx.dpkg = { id: "pkg-2", version: 4, status: "final", pdf_path: "s/d/v4.pdf", facts_json: {}, narrative_json: {} };
    fx.buildJobs = [];
    vi.mocked(findOutOfRangeOperand).mockResolvedValue(null);
    vi.mocked(uploadDisputeFile).mockResolvedValue({
      fileId: "9", fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/9",
      mutationField: "uncategorizedFile", disputeEvidenceGid: null, requestId: null,
    });
    vi.mocked(requestShopifyGraphQL).mockResolvedValue({
      data: { disputeEvidenceUpdate: { userErrors: [], disputeEvidence: { id: "e1" } } },
    } as never);
    vi.mocked(verifyEvidenceReadback).mockResolvedValue({ diff: { verified: true }, evidenceNode: {} } as never);
    expect(await handleSaveToShopify(job({ attempts: 3 }))).toEqual({ ok: true });
    expect(uploadDisputeFile).toHaveBeenCalledTimes(1);
    expect(maybeEnqueueDefencePackage).toHaveBeenCalledTimes(1);
    expect(lastPackStatus()).toBe("saved_to_shopify_verified");
  }, 15000);

  it("review-mode approved at the deadline: a validated draft awaiting finalize waits instead of failing", async () => {
    fx.dpkg = { id: "pkg-2", version: 4, status: "draft", pdf_path: "s/d/v4.pdf", facts_json: {}, narrative_json: {} };
    selected(true); // validated draft; the cron's finalize RPC is about to promote it
    expect(await handleSaveToShopify(job({ attempts: 1 }))).toMatchObject({ ok: false, retriable: true });
    expect(lastPackStatus()).toBe("saving");
    expect(attentionWrite()).toBeUndefined();
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
    expect(uploadDisputeFile).not.toHaveBeenCalled();
  });

  it("an awaited draft that never finalizes ends save_failed on the LAST attempt only", async () => {
    selected(true);
    await handleSaveToShopify(job({ attempts: 3, maxAttempts: 3 }));
    expect(lastPackStatus()).toBe("save_failed");
    expect(sendSaveFailedAdminAlert).toHaveBeenCalledTimes(1);
  });
});

/* ── bounded stale-PDF rebuild ──────────────────────────────────────────── */

describe("stale PDF rebuild is bounded to one per package version", () => {
  it("a version already deferred once is uploaded as-is (Shopify decides)", async () => {
    vi.mocked(findOutOfRangeOperand).mockResolvedValue({ page: 4, value: 1.45e10 });
    fx.audit = [{ event_type: "save_deferred_stale_pdf", pack_id: PACK_ID, event_payload: { packageId: "pkg-1" } }];
    vi.mocked(uploadDisputeFile).mockRejectedValue(
      new DisputeFileUploadError("shopify_rejection", "Shopify HTTP 422", 422),
    );
    const r = await handleSaveToShopify(job({ attempts: 2 }));
    expect(maybeEnqueueDefencePackage).not.toHaveBeenCalled();
    expect(uploadDisputeFile).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, retriable: false });
    expect(lastPackStatus()).toBe("save_failed");
  });

  it("a different, earlier-deferred version does not count", async () => {
    vi.mocked(findOutOfRangeOperand).mockResolvedValue({ page: 4, value: 1.45e10 });
    fx.audit = [{ event_type: "save_deferred_stale_pdf", pack_id: PACK_ID, event_payload: { packageId: "pkg-OLD" } }];
    await handleSaveToShopify(job({ attempts: 1 }));
    expect(maybeEnqueueDefencePackage).toHaveBeenCalledTimes(1);
    expect(uploadDisputeFile).not.toHaveBeenCalled();
  });
});

/* ── regenerate requested mid-save is not lost ──────────────────────────── */

describe("rebuild_pending is consumed by the terminal settle", () => {
  const buildPackInserted = () =>
    writes.some((w) => w.table === "jobs" && w.op === "insert" && w.patch.job_type === "build_pack");

  it("a final failure enqueues the pending regenerate", async () => {
    fx.pack.rebuild_pending = true;
    fx.dpkg = null; // no_defence_package -> final failure
    await handleSaveToShopify(job());
    expect(lastPackStatus()).toBe("save_failed");
    expect(buildPackInserted()).toBe(true);
  });

  it("a deliberate refusal enqueues the pending regenerate too", async () => {
    fx.pack.rebuild_pending = true;
    vi.mocked(bankClaimBlocksFiling).mockResolvedValue(true);
    await handleSaveToShopify(job());
    expect(buildPackInserted()).toBe(true);
  });

  it("a non-final (retrying) failure leaves it pending for the settle that follows", async () => {
    fx.pack.rebuild_pending = true;
    vi.mocked(downloadDefencePdf).mockRejectedValue(new Error("503"));
    await handleSaveToShopify(job({ attempts: 1 }));
    expect(buildPackInserted()).toBe(false);
  });
});

/* ── admin alert is capped per shop and error class ─────────────────────── */

describe("admin alert cap", () => {
  it("a second dispute of the same shop failing the same way is recorded but not emailed", async () => {
    fx.dpkg = null;
    fx.audit = [
      { event_type: "save_failed_admin_alerted", dispute_id: "dispute-OTHER", shop_id: SHOP_ID,
        event_payload: { error_class: "no_defence_package", suppressed: false } },
    ];
    await handleSaveToShopify(job());
    expect(sendSaveFailedAdminAlert).not.toHaveBeenCalled();
    expect(auditPayload("save_failed_admin_alerted")).toMatchObject({ suppressed: true });
    expect(attentionWrite()).toBeDefined(); // the dispute is still marked
  });

  it("a different error class for the same shop is still emailed", async () => {
    fx.dpkg = null;
    fx.audit = [
      { event_type: "save_failed_admin_alerted", dispute_id: "dispute-OTHER", shop_id: SHOP_ID,
        event_payload: { error_class: "shopify_auth_invalid", suppressed: false } },
    ];
    await handleSaveToShopify(job());
    expect(sendSaveFailedAdminAlert).toHaveBeenCalledTimes(1);
  });
});
