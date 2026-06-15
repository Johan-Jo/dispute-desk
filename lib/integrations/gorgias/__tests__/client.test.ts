/**
 * Gorgias REST client tests — mocked fetch (no live API / sandbox).
 *
 * Covers cursor pagination, 429/Retry-After backoff, defensive parsing,
 * and the case-insensitive email verification on customer resolution.
 */

import { describe, expect, it, vi } from "vitest";
import { createGorgiasClient, type GorgiasCredentials } from "../client";

const creds: GorgiasCredentials = {
  subdomain: "acme",
  email: "ops@acme.com",
  apiKey: "secret",
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

const noSleep = () => Promise.resolve();

describe("createGorgiasClient — auth + base URL", () => {
  it("calls the account subdomain with Basic auth", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ data: [] }),
    );
    const client = createGorgiasClient(creds, { fetchImpl });
    await client.listCustomerTickets(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("https://acme.gorgias.com/api/tickets");
    const auth = (init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from("ops@acme.com:secret").toString("base64")}`);
  });
});

describe("createGorgiasClient — pagination", () => {
  it("follows next_cursor and concatenates pages", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("cursor=")) {
        return jsonResponse({ data: [{ id: 2 }], meta: { next_cursor: null } });
      }
      return jsonResponse({ data: [{ id: 1 }], meta: { next_cursor: "abc" } });
    });
    const client = createGorgiasClient(creds, { fetchImpl, sleepImpl: noSleep });
    const tickets = await client.listCustomerTickets(99);
    expect(tickets.map((t) => t.id)).toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops at maxPages to avoid unbounded fan-out", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: 1 }], meta: { next_cursor: "endless" } }),
    );
    const client = createGorgiasClient(creds, {
      fetchImpl,
      sleepImpl: noSleep,
      maxPages: 3,
    });
    await client.listCustomerTickets(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("createGorgiasClient — rate limiting", () => {
  it("retries on 429 honouring Retry-After, then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } });
      }
      return jsonResponse({ data: [{ id: 7 }], meta: { next_cursor: null } });
    });
    const client = createGorgiasClient(creds, { fetchImpl, sleepImpl: sleep });
    const tickets = await client.listCustomerTickets(1);
    expect(tickets.map((t) => t.id)).toEqual([7]);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("throws after exhausting retries", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 429 }));
    const client = createGorgiasClient(creds, { fetchImpl, sleepImpl: noSleep });
    await expect(client.listCustomerTickets(1)).rejects.toThrow(/429/);
  });
});

describe("createGorgiasClient — defensive parsing", () => {
  it("returns [] when data is null/missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: null }));
    const client = createGorgiasClient(creds, { fetchImpl });
    expect(await client.listCustomerTickets(1)).toEqual([]);
  });
});

describe("createGorgiasClient — resolveCustomerByEmail", () => {
  it("returns the case-insensitive exact match", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: 5, email: "Buyer@Example.com" }] }),
    );
    const client = createGorgiasClient(creds, { fetchImpl });
    const c = await client.resolveCustomerByEmail("buyer@example.com");
    expect(c?.id).toBe(5);
  });

  it("returns null when no row matches the email exactly", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: 5, email: "someone-else@example.com" }] }),
    );
    const client = createGorgiasClient(creds, { fetchImpl });
    expect(await client.resolveCustomerByEmail("buyer@example.com")).toBeNull();
  });

  it("returns null for an empty email without calling the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const client = createGorgiasClient(creds, { fetchImpl });
    expect(await client.resolveCustomerByEmail("   ")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
