/**
 * Render the Defence Package PDF to a Buffer.
 *
 * Renders via a Node child process — NOT inside the Next.js webpack
 * bundle. This sidesteps the two-Reacts mismatch that breaks
 * @react-pdf/renderer when invoked from Next.js 15 server code (the
 * compiled `next/dist/compiled/react@19` uses
 * `Symbol.for("react.transitional.element")` for $$typeof, while
 * @react-pdf/reconciler loads `node_modules/react@18.3.1` which uses
 * `Symbol.for("react.element")` — every element fails React #31).
 *
 * Architecture:
 *   1. scripts/pdf-worker/render-defence-pdf.mjs — pure Node ESM.
 *      Imports react + @react-pdf/renderer + a pre-bundled
 *      DefencePackageDocument. Reads JSON from stdin, writes PDF bytes
 *      to stdout.
 *   2. scripts/pdf-worker/defence-package-document.bundle.mjs —
 *      pre-built (by scripts/build-pdf-worker.mjs, wired to `prebuild`
 *      in package.json) so the worker has no TS/JSX at runtime.
 *   3. This function spawns the worker via child_process.spawn,
 *      pipes JSON in, collects PDF bytes out.
 *
 * Vercel ships both files with the function bundle via
 * `outputFileTracingIncludes` in next.config.js.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import type { DefencePackageDocumentData } from "./pdf/DefencePackageDocument";

export interface RenderDefencePdfResult {
  buffer: Buffer;
  contentType: "application/pdf";
}

const WORKER_RELATIVE_PATH = "scripts/pdf-worker/render-defence-pdf.mjs";

function resolveWorkerPath(): string {
  // Vercel functions run from /var/task with the file structure
  // mirrored from the repo. `process.cwd()` is /var/task in production
  // and the repo root locally. The worker is included in the function
  // bundle by next.config.js `outputFileTracingIncludes`.
  return path.resolve(process.cwd(), WORKER_RELATIVE_PATH);
}

export async function renderDefencePdf(
  data: DefencePackageDocumentData,
): Promise<RenderDefencePdfResult> {
  console.info("defence-pdf-render", {
    renderer: "react-pdf",
    via: "child-process",
    packageId: data.meta.packageId,
    version: data.meta.version,
    packageMode: data.meta.packageMode,
  });

  const workerPath = resolveWorkerPath();
  const payload = JSON.stringify(data);

  return new Promise<RenderDefencePdfResult>((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new Error(
            `pdf-worker exited with code ${code ?? "null"}: ${stderr.slice(0, 4000)}`,
          ),
        );
        return;
      }
      const buffer = Buffer.concat(stdoutChunks);
      // Sanity check the output starts with the PDF magic bytes — any
      // other prefix means the worker partially wrote a stack trace
      // before crashing.
      if (buffer.length < 5 || buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
        reject(
          new Error(
            `pdf-worker stdout did not start with %PDF- magic; first 200 bytes: ${buffer.slice(0, 200).toString("utf8")} | stderr: ${stderr.slice(0, 2000)}`,
          ),
        );
        return;
      }
      resolve({ buffer, contentType: "application/pdf" });
    });

    child.stdin.write(payload, (err) => {
      if (err) {
        reject(err);
        return;
      }
      child.stdin.end();
    });
  });
}
