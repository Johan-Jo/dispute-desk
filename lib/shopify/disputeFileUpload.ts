/**
 * Dispute evidence file upload pipeline.
 *
 * Flow:
 * 1. stagedUploadsCreate with resource: DISPUTE_FILE_UPLOAD
 * 2. Upload file to Google Cloud Storage via multipart POST
 * 3. Return resourceUrl for use in disputeEvidenceUpdate file fields
 *
 * No additional scopes required beyond write_shopify_payments_dispute_evidences.
 */

import { requestShopifyGraphQL } from "./graphql";

const STAGED_UPLOAD_MUTATION = `
  mutation StagedUploadCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

interface StagedUploadResult {
  stagedUploadsCreate: {
    stagedTargets: StagedTarget[];
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

/**
 * Upload a file buffer to Shopify for dispute evidence.
 *
 * @returns The resource URL to use in disputeEvidenceUpdate file fields,
 *          or null if the upload failed.
 */
export async function uploadDisputeFile(
  session: { shopDomain: string; accessToken: string },
  filename: string,
  mimeType: string,
  fileBuffer: Buffer,
  correlationId?: string,
): Promise<string | null> {
  // Step 1: Create staged upload target
  const result = await requestShopifyGraphQL<StagedUploadResult>({
    session,
    query: STAGED_UPLOAD_MUTATION,
    variables: {
      input: [{
        resource: "DISPUTE_FILE_UPLOAD",
        filename,
        mimeType,
        httpMethod: "POST",
      }],
    },
    correlationId: correlationId ? `staged-${correlationId}` : undefined,
  });

  const target = result.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const userErrors = result.data?.stagedUploadsCreate?.userErrors ?? [];

  if (userErrors.length > 0) {
    console.error(
      `[disputeFileUpload] Staged upload error: ${userErrors.map(e => e.message).join(", ")}`,
    );
    return null;
  }

  if (!target) {
    console.error("[disputeFileUpload] No staged target returned");
    return null;
  }

  // Step 2: Upload file to Google Cloud Storage
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename);

  try {
    const uploadRes = await fetch(target.url, {
      method: "POST",
      body: formData,
    });

    if (!uploadRes.ok && uploadRes.status !== 201) {
      console.error(
        `[disputeFileUpload] Upload failed: ${uploadRes.status} ${uploadRes.statusText}`,
      );
      return null;
    }

    console.log(
      `[disputeFileUpload] File uploaded: ${filename} → ${target.resourceUrl.slice(0, 80)}...`,
    );

    return target.resourceUrl;
  } catch (err) {
    console.error(
      "[disputeFileUpload] Upload error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
