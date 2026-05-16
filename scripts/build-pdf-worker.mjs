/**
 * Build step: pre-bundle `lib/defence/pdf/DefencePackageDocument.tsx`
 * (and its TS/JSX dependencies — styles, evidenceBasisRows, types) into
 * a single plain Node ESM file that the PDF worker process can `import`.
 *
 * react and @react-pdf/renderer are kept external so the worker resolves
 * them at runtime via Node — same instance @react-pdf/reconciler loads,
 * avoiding the two-Reacts mismatch that breaks in-process Next.js
 * renders.
 *
 * Output: `scripts/pdf-worker/defence-package-document.bundle.mjs`.
 *
 * Run via `npm run build` (wired up as the `prebuild` script).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

await build({
  entryPoints: [
    path.resolve(repoRoot, "lib/defence/pdf/DefencePackageDocument.tsx"),
  ],
  outfile: path.resolve(
    repoRoot,
    "scripts/pdf-worker/defence-package-document.bundle.mjs",
  ),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  // Keep React + @react-pdf external — they must resolve via Node at
  // runtime so the worker and @react-pdf share the same instances.
  external: ["react", "react-dom", "@react-pdf/renderer", "@react-pdf/*"],
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
  },
  logLevel: "info",
});

console.log(
  "[build-pdf-worker] wrote scripts/pdf-worker/defence-package-document.bundle.mjs",
);
