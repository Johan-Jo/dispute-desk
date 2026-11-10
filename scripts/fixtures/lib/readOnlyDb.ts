/**
 * Read-only database access for the fixture capture: every query goes through
 * `npm run db:query:prod -- --read-only` (which runs `guard-db-target.mjs prod`
 * first, per CLAUDE.md rules 0 and 2). A replacement `globalThis.fetch` turns
 * supabase-js GET requests into SELECTs; anything that is not a GET/HEAD throws.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSelectSql, FK_SQL, type ForeignKey } from "./postgrestSql";

export const SHIM_ORIGIN = "https://capture-shim.invalid";

const cacheDir = path.join(os.tmpdir(), "dd-fixture-capture-cache");
fs.mkdirSync(cacheDir, { recursive: true });

let active = 0;
const waiting: Array<() => void> = [];
const MAX = 4;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function runCli(sqlFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "db:query:prod", "--silent", "--", "--read-only", "--output", "json", "--file", sqlFile],
      { shell: true, cwd: process.cwd() },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`db:query:prod exited ${code}: ${(err || out).slice(0, 500)}`));
      else resolve(out);
    });
  });
}

/** Run one SELECT that returns a single column `j`; returns that value. */
export async function queryJ(sql: string): Promise<unknown> {
  if (!/^\s*select\b/i.test(sql)) throw new Error("readOnlyDb: only SELECT statements are allowed");
  const key = createHash("sha1").update(sql).digest("hex");
  const cacheFile = path.join(cacheDir, `${key}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const value = await slot(async () => {
    const f = path.join(os.tmpdir(), `dd-capture-${key}.sql`);
    fs.writeFileSync(f, sql);
    try {
      const out = await runCli(f);
      const start = out.indexOf("{");
      const parsed = JSON.parse(out.slice(start)) as { rows: Array<{ j: unknown }> };
      return parsed.rows[0]?.j ?? null;
    } finally {
      fs.rmSync(f, { force: true });
    }
  });
  fs.writeFileSync(cacheFile, JSON.stringify(value));
  return value;
}

let fksPromise: Promise<ForeignKey[]> | null = null;
const foreignKeys = () => (fksPromise ??= queryJ(FK_SQL) as Promise<ForeignKey[]>);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Replace fetch so supabase-js (pointed at SHIM_ORIGIN) reads through the guarded CLI. */
export function installReadOnlyFetch(): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    if (url.origin !== SHIM_ORIGIN) return real(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    // The ONE named exception: `getShopSettings` calls the upserting RPC `ensure_shop_settings`.
    // The capture answers it with a plain SELECT of the existing row and never executes the RPC.
    if (method === "POST" && url.pathname === "/rest/v1/rpc/ensure_shop_settings") {
      const body = JSON.parse(String(init?.body ?? (req ? await req.text() : "{}"))) as { p_shop_id?: string };
      if (!/^[0-9a-f-]{36}$/i.test(body.p_shop_id ?? "")) throw new Error("READ-ONLY capture: bad p_shop_id");
      const row = await queryJ(`select row_to_json(s) as j from shop_settings s where s.shop_id = '${body.p_shop_id}';`);
      return json(200, row ?? { shop_id: body.p_shop_id, returns_outside_shopify: false });
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`READ-ONLY capture: blocked ${method} ${url.pathname}`);
    }
    const m = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
    if (!m) throw new Error(`READ-ONLY capture: unsupported path ${url.pathname}`);
    const hdr = new Headers(init?.headers ?? req?.headers);
    const built = buildSelectSql(
      decodeURIComponent(m[1]),
      url.searchParams,
      { accept: hdr.get("accept"), range: hdr.get("range") },
      await foreignKeys(),
    );
    const rows = (await queryJ(built.sql)) as unknown[];
    const wantsCount = /count=/.test(hdr.get("prefer") ?? "");
    const total = wantsCount ? ((await queryJ(built.countSql)) as number) : null;
    const range: Record<string, string> = total !== null ? { "content-range": `0-${Math.max(rows.length - 1, 0)}/${total}` } : {};
    if (method === "HEAD") return new Response(null, { status: 200, headers: range });
    if (built.singleObject) {
      if (rows.length !== 1) {
        return json(406, {
          code: "PGRST116",
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        });
      }
      return json(200, rows[0], range);
    }
    return json(200, rows, range);
  }) as typeof fetch;
}
