import { describe, expect, it } from "vitest";
import { DisputeFileUploadError } from "@/lib/shopify/disputeFileUpload";
import { classifyUploadError } from "../classifyUploadError";

const err = (code: ConstructorParameters<typeof DisputeFileUploadError>[0], status?: number) =>
  new DisputeFileUploadError(code, "m", status, "req-1");

describe("classifyUploadError", () => {
  it("keeps a possible IP-allowlist 403 retriable, with its own class", () => {
    expect(classifyUploadError(err("possible_ip_allowlist_403", 403))).toEqual({
      errorClass: "shopify_ip_403",
      retriable: true,
      httpStatus: 403,
      requestId: "req-1",
    });
  });

  it("still treats a real file verdict (422) and other 4xx as non-retriable", () => {
    expect(classifyUploadError(err("shopify_rejection", 422)).retriable).toBe(false);
    expect(classifyUploadError(err("shopify_rejection", 404)).retriable).toBe(false);
    // A 403 that was a scope verdict never gets the allowlist code, so it stays non-retriable.
    expect(classifyUploadError(err("shopify_rejection", 403))).toMatchObject({
      errorClass: "shopify_upload_rejected",
      retriable: false,
    });
  });

  it("keeps timing and server errors retriable and validation errors terminal", () => {
    expect(classifyUploadError(err("shopify_rejection", 429)).retriable).toBe(true);
    expect(classifyUploadError(err("shopify_rejection", 503)).retriable).toBe(true);
    expect(classifyUploadError(err("validation_size")).retriable).toBe(false);
    expect(classifyUploadError(new Error("network down")).retriable).toBe(true);
  });
});
