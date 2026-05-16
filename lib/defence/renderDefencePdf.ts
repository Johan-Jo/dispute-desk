/**
 * Render the Defence Package PDF to a Buffer.
 *
 * Mirrors `lib/packs/renderPdf.tsx` shape. Dynamic imports via `runtime.ts`
 * keep `@react-pdf/renderer` out of the webpack static analysis graph.
 */

import React from "react";

import type { DefencePackageDocumentData } from "./pdf/DefencePackageDocument";
import {
  getDefencePackageDocumentModule,
  getReactPdfRenderer,
} from "./pdf/runtime";

export interface RenderDefencePdfResult {
  buffer: Buffer;
  contentType: "application/pdf";
}

export async function renderDefencePdf(
  data: DefencePackageDocumentData,
): Promise<RenderDefencePdfResult> {
  const { renderToBuffer } = await getReactPdfRenderer();
  const { DefencePackageDocument } = await getDefencePackageDocumentModule();

  console.info("defence-pdf-render", {
    renderer: "react-pdf",
    packageId: data.meta.packageId,
    version: data.meta.version,
    packageMode: data.meta.packageMode,
  });

  const buffer = await renderToBuffer(
    React.createElement(DefencePackageDocument, { data }),
  );

  return {
    buffer: Buffer.from(buffer),
    contentType: "application/pdf",
  };
}
