/**
 * Defence Package PDF storage.
 *
 * Path scheme: `{shopId}/{packId}/defence/v{version}/{iso}.pdf` in the
 * existing `evidence-packs` bucket. New versions never overwrite priors.
 */

import { getServiceClient } from "@/lib/supabase/server";

const BUCKET = "evidence-packs";

export async function uploadDefencePdf(input: {
  shopId: string;
  packId: string;
  version: number;
  buffer: Buffer;
}): Promise<{ path: string; bucket: string }> {
  const sb = getServiceClient();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${input.shopId}/${input.packId}/defence/v${input.version}/${timestamp}.pdf`;
  const { error } = await sb.storage.from(BUCKET).upload(path, input.buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) {
    throw new Error(`Defence PDF upload failed: ${error.message}`);
  }
  return { path, bucket: BUCKET };
}

/**
 * Download a stored defence-package PDF as a Buffer. Used by
 * saveToShopifyJob when swapping the `uncategorizedFile` buffer.
 */
export async function downloadDefencePdf(path: string): Promise<Buffer> {
  const sb = getServiceClient();
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(
      `Defence PDF download failed: ${error?.message ?? "no data"} (${path})`,
    );
  }
  const arr = new Uint8Array(await data.arrayBuffer());
  return Buffer.from(arr);
}
