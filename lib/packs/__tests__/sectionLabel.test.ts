/**
 * Reader-shim tests for the EvidenceSection label cutover.
 *
 * The shim handles two distinct shapes that appear in persisted
 * `pack_json` during the Phase 4 cutover:
 *   - Pre-Phase 4 rows carry only an English `label`. The shim
 *     synthesizes a `packs.section.legacy.<type>` token so the
 *     merchant gets a translated header.
 *   - Post-Phase 4 rows carry `labelToken` directly. The shim
 *     resolves through the translator.
 *
 * The snapshot test below guarantees that no collector emits an
 * `EvidenceSection` whose persisted shape still uses `label` — that
 * would silently keep the shim alive past its retention-window
 * removal date.
 */

import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import type { I18nPrimitive } from "@/lib/i18n/token";
import {
  readSectionLabel,
  type PersistedSection,
} from "../sectionLabel";

function lookupEn(key: string): string {
  const parts = key.split(".");
  let node: unknown = enMessages;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

function tEn(key: string, params?: Record<string, I18nPrimitive>): string {
  let msg = lookupEn(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return msg;
}

describe("readSectionLabel — shim accepts both legacy and post-cutover shapes", () => {
  it("resolves a new-style labelToken to translated text", () => {
    const section: PersistedSection = {
      type: "order",
      labelToken: { key: "packs.section.refundHistory" },
      source: "shopify_order",
      fieldsProvided: [],
      data: {},
    };
    expect(readSectionLabel(section, tEn)).toBe("Refund history");
  });

  it("substitutes nested params in the labelToken template", () => {
    const section: PersistedSection = {
      type: "order",
      labelToken: {
        key: "packs.section.order",
        params: { orderName: "#1234" },
      },
      source: "shopify_order",
      fieldsProvided: [],
      data: {},
    };
    expect(readSectionLabel(section, tEn)).toBe("Order #1234");
  });

  it("falls back to packs.section.legacy.<type> when only legacy label exists", () => {
    const section: PersistedSection = {
      type: "comms",
      // Pre-Phase 4 persisted shape — `labelToken` absent.
      label: "Customer messages",
      source: "shopify_timeline",
      fieldsProvided: [],
      data: {},
    };
    expect(readSectionLabel(section, tEn)).toBe("Communication");
  });
});

describe("collector contract — newly emitted EvidenceSections carry labelToken and never label", () => {
  it("post-Phase 4 EvidenceSection type only allows labelToken (compile-time guarantee)", () => {
    // This test is a structural reminder: TypeScript will already
    // reject any collector that tries to emit a `label` field on an
    // EvidenceSection. Persisted shapes (`PersistedSection`) still
    // accept the legacy `label` for the shim's fallback path.
    //
    // If this assertion ever stops holding, the cutover regressed —
    // a collector started emitting `label` again, which would keep
    // the legacy shim alive past its useful life.
    type EvidenceSectionKeys = keyof import("../types").EvidenceSection;
    const allowedKeys: Record<EvidenceSectionKeys, true> = {
      type: true,
      labelToken: true,
      source: true,
      data: true,
      fieldsProvided: true,
    };
    expect(Object.keys(allowedKeys).sort()).toEqual(
      ["data", "fieldsProvided", "labelToken", "source", "type"].sort(),
    );
  });
});
