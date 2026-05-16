/**
 * Defence Package PDF render worker.
 *
 * Runs as a Node child process spawned by lib/defence/renderDefencePdf.ts.
 * Pure Node ESM — NOT bundled by webpack — so its `import React from
 * "react"` resolves via Node to node_modules/react@18.3.1, matching the
 * React instance @react-pdf/reconciler loads.
 *
 * This is how we escape the two-Reacts mismatch that blocks every
 * in-process PDF render in Next.js 15 (next/dist/compiled/react@19's
 * `Symbol.for("react.transitional.element")` $$typeof vs
 * node_modules/react@18.3.1's `Symbol.for("react.element")`).
 *
 * Protocol:
 *   - stdin: JSON-serialised `DefencePackageDocumentData`
 *   - stdout: raw PDF bytes
 *   - stderr: log lines + structured error messages
 *   - exit code 0 on success, 1 on render failure, 2 on input parse failure
 *
 * The DefencePackageDocument component tree is pre-bundled to a sibling
 * file (`./defence-package-document.bundle.mjs`) by
 * `scripts/build-pdf-worker.mjs` so this worker has zero TypeScript /
 * JSX dependency at runtime.
 */

// Plain Node ESM — no webpack. Use static `import` (or `await import`)
// throughout. `@react-pdf/renderer` is itself ESM so `require()` would
// fail with ERR_REQUIRE_ESM; React 18 is CJS but importing as ESM
// default works via Node's interop.

let inputJson;
const stdinChunks = [];
for await (const chunk of process.stdin) stdinChunks.push(chunk);
try {
  inputJson = JSON.parse(Buffer.concat(stdinChunks).toString("utf8"));
} catch (err) {
  process.stderr.write(
    `[pdf-worker] failed to parse stdin JSON: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
}

try {
  const ReactModule = await import("react");
  const React = ReactModule.default ?? ReactModule;
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { DefencePackageDocument } = await import(
    "./defence-package-document.bundle.mjs"
  );

  const buffer = await renderToBuffer(
    React.createElement(DefencePackageDocument, { data: inputJson }),
  );

  // Buffer-to-stdout. Use write callback to ensure the chunk is flushed
  // before exit, otherwise short PDFs can be truncated.
  process.stdout.write(Buffer.from(buffer), (err) => {
    if (err) {
      process.stderr.write(`[pdf-worker] stdout write error: ${err.message}\n`);
      process.exit(1);
    }
    process.exit(0);
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : "";
  process.stderr.write(`[pdf-worker] render failed: ${message}\n${stack}\n`);
  process.exit(1);
}
