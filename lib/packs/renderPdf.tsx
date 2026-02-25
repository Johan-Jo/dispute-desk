import type { PackPdfData } from "./pdf/EvidencePackDocument";

/**
 * Render an evidence pack PDF to a Buffer.
 *
 * Uses dynamic import to avoid webpack bundling @react-pdf/renderer
 * at build time (the package has native deps that hang the build).
 */
export async function renderPackPdf(data: PackPdfData): Promise<Buffer> {
  const React = (await import("react")).default;
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { EvidencePackDocument } = await import("./pdf/EvidencePackDocument");

  const element = React.createElement(EvidencePackDocument, { data });
  // @react-pdf/renderer's renderToBuffer expects DocumentProps but our
  // wrapper component returns a <Document> internally — safe to cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);
  return Buffer.from(buffer);
}
