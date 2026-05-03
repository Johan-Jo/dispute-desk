/**
 * Tests for `handleRenderPdf` (Phase 4.2).
 *
 * Verifies the PDF render → upload → DB-update orchestration. The
 * @react-pdf/renderer call is mocked (its actual rendering is heavy
 * and not the unit under test); Supabase Storage and the audit log are
 * also mocked. Tests cover:
 *   - happy path: pack loaded, PDF rendered, upload succeeds, pdf_path
 *     written + audit + dispute event emitted.
 *   - missing entityId: throws before any DB or render work.
 *   - storage upload failure: error rethrown, audit reflects job_failed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/packs/renderPdf", () => ({
  renderPackPdf: vi.fn(),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { renderPackPdf } from "@/lib/packs/renderPdf";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { handleRenderPdf } from "../renderPdfJob";
import type { ClaimedJob } from "../../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockRenderPackPdf = vi.mocked(renderPackPdf);
const mockEmitDisputeEvent = vi.mocked(emitDisputeEvent);

const PACK_ID = "pack-1";
const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

function makeJob(): ClaimedJob {
  return {
    id: "job-1",
    shopId: SHOP_ID,
    jobType: "render_pdf",
    entityId: PACK_ID,
    attempts: 0,
    maxAttempts: 3,
  };
}

interface SupabaseStub {
  uploadShouldFail?: boolean;
  packPdfPath?: string | null;
}

function makeSb(opts: SupabaseStub = {}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const tableHandler = (table: string) => {
    if (table === "evidence_packs") {
      const select = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: PACK_ID,
              shop_id: SHOP_ID,
              dispute_id: DISPUTE_ID,
              pack_json: { sections: [] },
              completeness_score: 75,
              checklist: [],
              blockers: [],
              recommended_actions: [],
              pdf_path: opts.packPdfPath ?? null,
              created_at: "2026-05-03T10:00:00Z",
            },
            error: null,
          }),
        }),
      });
      const update = vi.fn((patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
      });
      return { select, update };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { dispute_gid: "gid://shopify/Dispute/1", reason: "FRAUDULENT" },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { shop_domain: "test.myshopify.com" },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "audit_events") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unmocked table: ${table}`);
  };

  const sb = {
    from: vi.fn(tableHandler),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue(
          opts.uploadShouldFail
            ? { data: null, error: { message: "bucket misconfigured" } }
            : { data: { path: "stub" }, error: null },
        ),
      })),
    },
  };
  return { sb, updateCalls };
}

describe("handleRenderPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderPackPdf.mockResolvedValue({
      buffer: Buffer.from("PDF-1.4 mock"),
      contentType: "application/pdf",
    });
  });

  it("happy path: renders, uploads, writes pdf_path, audits, emits PDF_RENDERED", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    await handleRenderPdf(makeJob());

    // Renderer was called.
    expect(mockRenderPackPdf).toHaveBeenCalledTimes(1);

    // Storage upload was attempted into the evidence-packs bucket.
    expect(sb.storage.from).toHaveBeenCalledWith("evidence-packs");

    // pdf_path written on the pack row.
    const writePatch = updateCalls.find((p) => "pdf_path" in p);
    expect(writePatch).toBeDefined();
    expect(typeof writePatch?.pdf_path).toBe("string");
    expect(writePatch?.pdf_path).toMatch(new RegExp(`^${SHOP_ID}/${PACK_ID}/.*\\.pdf$`));

    // Audit event reflects pdf_rendered.
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("pdf_rendered");
    expect(auditTypes).not.toContain("job_failed");

    // Dispute event PDF_RENDERED emitted.
    const eventTypes = mockEmitDisputeEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("pdf_rendered");
  });

  it("throws when entity_id is missing (no pack to render)", async () => {
    mockGetServiceClient.mockReturnValue({} as unknown as ReturnType<typeof getServiceClient>);
    await expect(
      handleRenderPdf({ ...makeJob(), entityId: null }),
    ).rejects.toThrow(/missing entity_id/);
    expect(mockRenderPackPdf).not.toHaveBeenCalled();
  });

  it("storage upload failure: rethrows + audits job_failed", async () => {
    const { sb } = makeSb({ uploadShouldFail: true });
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    await expect(handleRenderPdf(makeJob())).rejects.toThrow(
      /Storage upload failed/,
    );

    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("job_failed");
    // pdf_rendered must NOT be logged when the upload failed.
    expect(auditTypes).not.toContain("pdf_rendered");
  });
});
