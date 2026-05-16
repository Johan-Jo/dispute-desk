/**
 * Dynamic-import wrappers for the Defence Package PDF.
 *
 * Mirrors `lib/packs/pdf/reactPdfRuntime.ts`. Keeps `@react-pdf/renderer`
 * out of the webpack static analysis graph so the Next.js build doesn't
 * hang on native deps (yoga-layout) at compile time.
 */

export async function getReactPdfRenderer() {
  const mod = await import("@react-pdf/renderer");
  return {
    ...mod,
    renderToBuffer: mod.renderToBuffer as (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      element: React.ReactElement<any>,
    ) => Promise<Uint8Array>,
  };
}

export async function getDefencePackageDocumentModule() {
  return import("@/lib/defence/pdf/DefencePackageDocument");
}
