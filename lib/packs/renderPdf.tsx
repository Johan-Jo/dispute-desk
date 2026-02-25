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
