import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(files) {
  const env = {};
  for (const f of files) {
    try {
      for (const raw of readFileSync(f, "utf8").split("\n")) {
        const line = raw.replace(/\r$/, "");
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return env;
}

const local = loadEnv([".env.local"]);
const fresh = loadEnv([".vercel/prod-fresh.env"]);

const SRC_URL = local.SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL;
const SRC_KEY = local.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = fresh.SUPABASE_URL;
const DST_KEY = fresh.SUPABASE_SERVICE_ROLE_KEY;

if (!/sddzuglxdnkhcnjmcpbj/.test(SRC_URL || "")) throw new Error("SRC not legacy: " + SRC_URL);
if (!/aokhplydttxtebvbeuzc/.test(DST_URL || "")) throw new Error("DST not prod: " + DST_URL);
console.log("SRC", SRC_URL, "len", SRC_KEY.length, "| DST", DST_URL, "len", DST_KEY.length);

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } });

const rows = JSON.parse(readFileSync(".vercel/dangling.json", "utf8")).rows;
const DRY = process.argv.includes("--dry");
console.log(`${rows.length} objects to recover${DRY ? " (DRY RUN)" : ""}`);

let ok = 0, srcMiss = 0, fail = 0;
for (const { bucket, pdf_path } of rows) {
  const { data: blob, error: dErr } = await src.storage.from(bucket).download(pdf_path);
  if (dErr || !blob) { srcMiss++; console.log("  SRC-MISSING", pdf_path); continue; }
  const buf = Buffer.from(await blob.arrayBuffer());
  if (DRY) { ok++; console.log("  WOULD COPY", pdf_path, `(${buf.length}b)`); continue; }
  const { error: uErr } = await dst.storage.from(bucket).upload(pdf_path, buf, {
    contentType: "application/pdf", upsert: true,
  });
  if (uErr) { fail++; console.log("  UPLOAD-FAIL", pdf_path, uErr.message); continue; }
  ok++; console.log("  COPIED", pdf_path, `(${buf.length}b)`);
}
console.log(`\nDone: copied=${ok} src-missing=${srcMiss} upload-fail=${fail}`);
