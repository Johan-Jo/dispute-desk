import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cronEnvGate } from "../envGate";

function makeRequest(opts: {
  url?: string;
  headers?: Record<string, string>;
}): Request {
  return new Request(opts.url ?? "https://disputedesk.app/api/cron/test", {
    method: "GET",
    headers: opts.headers ?? {},
  });
}

describe("cronEnvGate — CRON_ENABLED toggle", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.CRON_ENABLED;
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    process.env.CRON_ENABLED = original.CRON_ENABLED;
    process.env.CRON_SECRET = original.CRON_SECRET;
  });

  it("returns 204 when CRON_ENABLED is unset", async () => {
    const res = cronEnvGate(makeRequest({}));
    expect(res?.status).toBe(204);
  });
  it("returns 204 when CRON_ENABLED=false", async () => {
    process.env.CRON_ENABLED = "false";
    const res = cronEnvGate(makeRequest({}));
    expect(res?.status).toBe(204);
  });
  it("does NOT short-circuit when CRON_ENABLED=true and auth matches", async () => {
    process.env.CRON_ENABLED = "true";
    process.env.CRON_SECRET = "topsecret";
    const res = cronEnvGate(
      makeRequest({ headers: { authorization: "Bearer topsecret" } }),
    );
    expect(res).toBeNull();
  });
});

describe("cronEnvGate — auth shapes (CRON_ENABLED=true)", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.CRON_ENABLED = "true";
    process.env.CRON_SECRET = "topsecret";
  });
  afterEach(() => {
    process.env.CRON_ENABLED = original.CRON_ENABLED;
    process.env.CRON_SECRET = original.CRON_SECRET;
  });

  it("accepts Authorization: Bearer", () => {
    const res = cronEnvGate(
      makeRequest({ headers: { authorization: "Bearer topsecret" } }),
    );
    expect(res).toBeNull();
  });
  it("accepts x-cron-secret header", () => {
    const res = cronEnvGate(
      makeRequest({ headers: { "x-cron-secret": "topsecret" } }),
    );
    expect(res).toBeNull();
  });
  it("accepts ?secret= query string", () => {
    const res = cronEnvGate(
      makeRequest({ url: "https://disputedesk.app/api/cron/x?secret=topsecret" }),
    );
    expect(res).toBeNull();
  });
  it("rejects mismatched bearer", () => {
    const res = cronEnvGate(
      makeRequest({ headers: { authorization: "Bearer wrong" } }),
    );
    expect(res?.status).toBe(401);
  });
  it("rejects empty bearer / no headers", () => {
    const res = cronEnvGate(makeRequest({}));
    expect(res?.status).toBe(401);
  });
  it("rejects when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    const res = cronEnvGate(
      makeRequest({ headers: { authorization: "Bearer topsecret" } }),
    );
    expect(res?.status).toBe(401);
  });
});

describe("cronEnvGate presence on every cron route", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  const cronRoot = join(repoRoot, "app", "api", "cron");
  const workerRoute = join(repoRoot, "app", "api", "jobs", "worker", "route.ts");

  function findRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...findRouteFiles(full));
      else if (name === "route.ts") out.push(full);
    }
    return out;
  }

  it("every app/api/cron/**/route.ts imports and calls cronEnvGate", () => {
    const files = findRouteFiles(cronRoot);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const imports = /from\s+["'](?:@\/lib\/cron\/envGate|\.\.[\.\/]*lib\/cron\/envGate)["']/.test(src);
      const calls = /cronEnvGate\s*\(/.test(src);
      if (!imports || !calls) offenders.push(file.replace(repoRoot, ""));
    }
    expect(offenders, `routes missing cronEnvGate: ${offenders.join(", ")}`).toEqual([]);
  });

  it("app/api/jobs/worker/route.ts imports and calls cronEnvGate", () => {
    const src = readFileSync(workerRoute, "utf8");
    expect(/from\s+["']@\/lib\/cron\/envGate["']/.test(src), "worker must import from @/lib/cron/envGate").toBe(true);
    expect(/cronEnvGate\s*\(/.test(src), "worker must call cronEnvGate").toBe(true);
  });
});
