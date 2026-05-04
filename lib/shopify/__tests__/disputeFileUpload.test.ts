/**
 * Unit tests for `uploadDisputeFile` — input validation + response parsing.
 *
 * Network is mocked via vitest's `vi.stubGlobal('fetch', ...)`. End-to-end
 * Shopify probes live in `scripts/phase-0-file-evidence.mjs` /
 * `scripts/phase-0-mime-limits.mjs`; their captured outputs are committed
 * under `docs/.shopify-evidence/phase-0-results/`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_MIME_TYPES,
  DisputeFileUploadError,
  DOCUMENT_TYPE_TO_MUTATION_FIELD,
  MAX_FILE_SIZE_BYTES,
  uploadDisputeFile,
} from "../disputeFileUpload";

const VALID_INPUT = {
  shopDomain: "shop.myshopify.com",
  accessToken: "shpat_xxx",
  disputeNumericId: "10488086585",
  documentType: "uncategorized_file" as const,
  filename: "evidence.pdf",
  mimeType: "application/pdf",
  fileBytes: Buffer.from("%PDF-1.4 not really but tests don't sniff"),
};

function mockShopify(status: number, body: unknown, requestId = "req-test-1") {
  const headers = new Headers({ "x-request-id": requestId });
  const init = { status, headers, statusText: status === 200 ? "OK" : "ERR" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), init),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploadDisputeFile — validation", () => {
  it("rejects missing shopDomain / accessToken / disputeNumericId", async () => {
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, shopDomain: "" }),
    ).rejects.toMatchObject({ code: "validation_input" });
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, accessToken: "" }),
    ).rejects.toMatchObject({ code: "validation_input" });
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, disputeNumericId: "" }),
    ).rejects.toMatchObject({ code: "validation_input" });
  });

  it("rejects non-numeric disputeNumericId (prevents accidental GID pass-through)", async () => {
    await expect(
      uploadDisputeFile({
        ...VALID_INPUT,
        disputeNumericId: "gid://shopify/ShopifyPaymentsDispute/10488086585",
      }),
    ).rejects.toMatchObject({ code: "validation_input" });
  });

  it("rejects unknown document_type", async () => {
    await expect(
      uploadDisputeFile({
        ...VALID_INPUT,
        // @ts-expect-error — exercising runtime guard
        documentType: "not_a_real_type",
      }),
    ).rejects.toMatchObject({ code: "validation_input" });
  });

  it("rejects MIME outside the accepted set", async () => {
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, mimeType: "application/zip" }),
    ).rejects.toMatchObject({ code: "validation_mime" });
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, mimeType: "image/heic" }),
    ).rejects.toMatchObject({ code: "validation_mime" });
  });

  it("accepts every MIME in ACCEPTED_MIME_TYPES (sanity)", () => {
    expect([...ACCEPTED_MIME_TYPES]).toEqual([
      "image/jpg",
      "image/jpeg",
      "image/png",
      "application/pdf",
    ]);
  });

  it("rejects empty fileBytes", async () => {
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, fileBytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: "validation_input" });
  });

  it("rejects files larger than MAX_FILE_SIZE_BYTES (2 MiB UI ceiling)", async () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(2_097_152);
    const oversize = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 0x42);
    await expect(
      uploadDisputeFile({ ...VALID_INPUT, fileBytes: oversize }),
    ).rejects.toMatchObject({ code: "validation_size" });
  });
});

describe("uploadDisputeFile — Shopify response handling", () => {
  it("returns fileId + fileGid + mutationField on 200", async () => {
    mockShopify(200, {
      dispute_file_upload: { id: 8421900345, dispute_evidence_id: 10517905465 },
    });
    const r = await uploadDisputeFile({
      ...VALID_INPUT,
      documentType: "shipping_documentation_file",
    });
    expect(r.fileId).toBe("8421900345");
    expect(r.fileGid).toBe(
      "gid://shopify/ShopifyPaymentsDisputeFileUpload/8421900345",
    );
    expect(r.mutationField).toBe("shippingDocumentationFile");
    expect(r.disputeEvidenceGid).toBe(
      "gid://shopify/ShopifyPaymentsDisputeEvidence/10517905465",
    );
    expect(r.requestId).toBe("req-test-1");
  });

  it("maps every document_type to its named *File field", async () => {
    for (const [docType, fieldName] of Object.entries(DOCUMENT_TYPE_TO_MUTATION_FIELD)) {
      mockShopify(200, { dispute_file_upload: { id: 1 } });
      const r = await uploadDisputeFile({
        ...VALID_INPUT,
        // @ts-expect-error — keys typed loose for the loop
        documentType: docType,
      });
      expect(r.mutationField).toBe(fieldName);
    }
  });

  it("throws shopify_rejection with requestId + body on non-2xx", async () => {
    mockShopify(
      422,
      {
        errors: {
          dispute_file_upload: [
            "You can upload up to 4MB and your last file uploaded surpassed this limit.",
          ],
        },
      },
      "req-422-x",
    );
    try {
      await uploadDisputeFile(VALID_INPUT);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DisputeFileUploadError);
      const e = err as DisputeFileUploadError;
      expect(e.code).toBe("shopify_rejection");
      expect(e.httpStatus).toBe(422);
      expect(e.requestId).toBe("req-422-x");
      expect(e.responseBody).toMatchObject({ errors: expect.any(Object) });
    }
  });

  it("throws missing_id_in_response when 200 has no id", async () => {
    mockShopify(200, { dispute_file_upload: {} });
    await expect(uploadDisputeFile(VALID_INPUT)).rejects.toMatchObject({
      code: "missing_id_in_response",
    });
  });

  it("returns null disputeEvidenceGid when REST omits dispute_evidence_id", async () => {
    mockShopify(200, { dispute_file_upload: { id: 555 } });
    const r = await uploadDisputeFile(VALID_INPUT);
    expect(r.disputeEvidenceGid).toBeNull();
    expect(r.fileGid).toBe(
      "gid://shopify/ShopifyPaymentsDisputeFileUpload/555",
    );
  });
});
