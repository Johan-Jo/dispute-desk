import React from "react";

import type { PackPdfData } from "./pdf/EvidencePackDocument";
import {
  getEvidencePackDocumentModule,
  getReactPdfRenderer,
} from "./pdf/reactPdfRuntime";

export interface RenderPackPdfResult {
  buffer: Buffer;
  contentType: "application/pdf";
}

/**
 * Render an evidence pack PDF to a Buffer.
 *
 * Dynamic imports via reactPdfRuntime.ts keep @react-pdf/renderer
 * out of the webpack static analysis graph (same pattern as Estimate Pro).
 *
 * Two-Reacts fix (2026-05-16): React is loaded via Node's resolution
 * (createRequire), not webpack's, so it matches the React instance
 * @react-pdf/reconciler loads from node_modules. Using webpack's
 * `import React from "react"` resolves to next/dist/compiled/react
 * (React 19 transitional element shape), which doesn't match
 * @react-pdf's node_modules/react (18.3.1, classic element shape) —
 * the reconciler rejects every element with React minified error #31.
 * See lib/defence/renderDefencePdf.ts header for the full explanation.
 */
export async function renderPackPdf(
  data: PackPdfData
): Promise<RenderPackPdfResult> {
  const { renderToBuffer } = await getReactPdfRenderer();
  const { EvidencePackDocument } = await getEvidencePackDocumentModule();
  console.info("evidence-pdf-render", { renderer: "react-pdf", packId: data.packId });

  const buffer = await renderToBuffer(
    React.createElement(EvidencePackDocument, { data })
  );

  return {
    buffer: Buffer.from(buffer),
    contentType: "application/pdf",
  };
}
