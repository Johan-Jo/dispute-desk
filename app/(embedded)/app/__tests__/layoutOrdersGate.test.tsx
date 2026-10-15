/**
 * The `/app/*` layout is the single choke point for the no-orders gate
 * (docs/plans/no-orders-install-gate.plan.md). Pins: locked shops get ONLY the
 * lock screen (no nav, no children), and every other case passes through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let headerValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerValues[k] ?? null }),
}));

const resolveOrdersGate = vi.fn();
vi.mock("@/lib/shopify/ordersGate", () => ({
  resolveOrdersGate: (...a: unknown[]) => resolveOrdersGate(...a),
}));

const afterMock = vi.fn((cb: () => unknown) => cb());
vi.mock("next/server", () => ({ after: (cb: () => unknown) => afterMock(cb) }));
const notifyOrdersGateBlock = vi.fn();
vi.mock("@/lib/shopify/notifyOrdersGateBlock", () => ({
  notifyOrdersGateBlock: (...a: unknown[]) => notifyOrdersGateBlock(...a),
}));

const sendDeferredInstallEmail = vi.fn();
vi.mock("@/lib/shopify/deferredInstallEmail", () => ({
  sendDeferredInstallEmail: (...a: unknown[]) => sendDeferredInstallEmail(...a),
}));

vi.mock("@/lib/shopify/recordLastLogin", () => ({ recordLastLogin: vi.fn() }));
vi.mock("@/lib/shopify/recordPageView", () => ({ recordPageView: vi.fn() }));
vi.mock("@/lib/shopify/sessionToken", () => ({ verifySessionToken: () => null }));
vi.mock("../AppNavSidebar", () => ({ AppNavSidebar: () => null }));
vi.mock("@/components/embedded/EmbeddedAppChrome", () => ({
  EmbeddedAppChrome: () => null,
}));
vi.mock("@/components/embedded/PageViewBeacon", () => ({ PageViewBeacon: () => null }));
vi.mock("@/components/embedded/NoOrdersScreen", () => ({
  NoOrdersScreen: function NoOrdersScreen() {
    return null;
  },
}));

import EmbeddedAppLayout from "../layout";
import { NoOrdersScreen } from "@/components/embedded/NoOrdersScreen";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";

const CHILD = "child-marker";

async function render(): Promise<{ type?: unknown }> {
  return (await EmbeddedAppLayout({ children: CHILD as never })) as { type?: unknown };
}

describe("EmbeddedAppLayout no-orders gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headerValues = { "x-dd-shop-id": "shop-1" };
  });

  it("locked shop: renders ONLY the lock screen", async () => {
    resolveOrdersGate.mockResolvedValue("locked");
    const out = await render();
    expect(out.type).toBe(NoOrdersScreen);
    expect(JSON.stringify(out)).not.toContain(CHILD);
  });

  it("open shop: renders the normal shell with the page children", async () => {
    resolveOrdersGate.mockResolvedValue("open");
    const out = await render();
    expect(out.type).not.toBe(NoOrdersScreen);
    expect(JSON.stringify(out)).toContain(CHILD);
  });

  it("impersonation sees the lock screen (gated on x-shop-id) but sends nothing", async () => {
    headerValues = { [IMPERSONATION_MODE_HEADER]: "read", "x-shop-id": "shop-imp" };
    resolveOrdersGate.mockResolvedValue("locked");
    const out = await render();
    expect(out.type).toBe(NoOrdersScreen);
    expect(resolveOrdersGate.mock.calls[0][0]).toBe("shop-imp");
    expect(resolveOrdersGate.mock.calls[0][1]).toEqual({ onVerified: undefined });
    expect(notifyOrdersGateBlock).not.toHaveBeenCalled();
    expect(sendDeferredInstallEmail).not.toHaveBeenCalled();
  });

  it("impersonation of an open shop renders the normal shell", async () => {
    headerValues = { [IMPERSONATION_MODE_HEADER]: "read", "x-shop-id": "shop-imp" };
    resolveOrdersGate.mockResolvedValue("open");
    const out = await render();
    expect(out.type).not.toBe(NoOrdersScreen);
    expect(JSON.stringify(out)).toContain(CHILD);
  });

  it("no shop id forwarded: passes through without asking", async () => {
    headerValues = {};
    const out = await render();
    expect(out.type).not.toBe(NoOrdersScreen);
    expect(resolveOrdersGate).not.toHaveBeenCalled();
  });
});
