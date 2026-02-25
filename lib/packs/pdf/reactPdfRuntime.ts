/**
 * Dynamic import wrappers for @react-pdf/renderer.
 *
 * Keeps @react-pdf/renderer out of the webpack static analysis graph,
 * preventing build hangs from native deps (yoga-layout).
 *
 * Same pattern used in Estimate Pro (src/lib/pdf/estimate/reactPdfRuntime.ts).
 */

export async function getReactPdfRenderer() {
  const mod = await import("@react-pdf/renderer");
  return {
    ...mod,
    renderToBuffer: mod.renderToBuffer as (
      // Widen the type so wrapper components (not just <Document>) are accepted.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      element: React.ReactElement<any>
    ) => Promise<Uint8Array>,
  };
}

export async function getEvidencePackDocumentModule() {
  return import("@/lib/packs/pdf/EvidencePackDocument");
}
