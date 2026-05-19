import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LIST,
  getLocaleDisplay,
  isLocale,
  localeToLegacyCode,
  normalizeLocale,
  resolveLocale,
  type Locale,
} from "@/lib/i18n/locales";
import { toBcp47, toBcp47Loose } from "@/lib/i18n/bcp47";
import { getPolarisTranslations } from "@/lib/i18n/polarisLocales";
import {
  hubLocaleToPathSegment,
  pathLocaleToHubLocale,
} from "@/lib/resources/localeMap";
import type { HubContentLocale } from "@/lib/resources/constants";

// ─── Canonical Locale = short codes ─────────────────────────────

describe("LOCALE_LIST", () => {
  it("contains exactly the 6 supported short-code locales", () => {
    expect([...LOCALE_LIST].sort()).toEqual(
      ["de", "en", "es", "fr", "pt", "sv"]
    );
  });

  it("has DEFAULT_LOCALE = 'en'", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("LOCALES metadata entries align 1:1 with LOCALE_LIST", () => {
    expect(LOCALES.map((l) => l.locale).sort()).toEqual(
      [...LOCALE_LIST].sort()
    );
  });

  it("every LOCALES entry has a label and nativeName", () => {
    for (const entry of LOCALES) {
      expect(entry.label).toBeTruthy();
      expect(entry.nativeName).toBeTruthy();
      expect(entry.short).toMatch(/^[A-Z]{2}$/);
    }
  });
});

// ─── isLocale ───────────────────────────────────────────────────

describe("isLocale", () => {
  it.each(LOCALE_LIST)("accepts short code %s", (code) => {
    expect(isLocale(code)).toBe(true);
  });

  it("rejects BCP-47 forms (those go through normalizeLocale)", () => {
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale("de-DE")).toBe(false);
    expect(isLocale("pt-BR")).toBe(false);
  });

  it("rejects unsupported codes", () => {
    expect(isLocale("ja")).toBe(false);
    expect(isLocale("zh-CN")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false); // case sensitive
  });
});

// ─── normalizeLocale ────────────────────────────────────────────

describe("normalizeLocale", () => {
  it("returns null for nullish/empty input", () => {
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("   ")).toBeNull();
  });

  it.each([
    ["en", "en"],
    ["de", "de"],
    ["es", "es"],
    ["fr", "fr"],
    ["pt", "pt"],
    ["sv", "sv"],
  ])("passes short code %s through unchanged", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it.each([
    ["en-US", "en"],
    ["en-GB", "en"],
    ["de-DE", "de"],
    ["de-AT", "de"],
    ["de-CH", "de"],
    ["es-ES", "es"],
    ["es-MX", "es"],
    ["es-AR", "es"],
    ["fr-FR", "fr"],
    ["fr-CA", "fr"],
    ["pt-BR", "pt"],
    ["pt-PT", "pt"],
    ["sv-SE", "sv"],
  ])("collapses BCP-47 %s → %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it("accepts underscore variants (pt_BR, de_DE)", () => {
    expect(normalizeLocale("pt_BR")).toBe("pt");
    expect(normalizeLocale("de_DE")).toBe("de");
  });

  it("is case-insensitive", () => {
    expect(normalizeLocale("EN-US")).toBe("en");
    expect(normalizeLocale("PT-br")).toBe("pt");
    expect(normalizeLocale("DE")).toBe("de");
  });

  it("falls back to base subtag for unmapped regional codes", () => {
    expect(normalizeLocale("en-AU")).toBe("en"); // not in BCP47_TO_SHORT, but base 'en' matches
    expect(normalizeLocale("sv-FI")).toBe("sv");
  });

  it("returns null for unsupported languages", () => {
    expect(normalizeLocale("ja")).toBeNull();
    expect(normalizeLocale("zh-CN")).toBeNull();
    expect(normalizeLocale("ru")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(normalizeLocale("  de-DE  ")).toBe("de");
  });
});

// ─── resolveLocale (cascading fallback) ────────────────────────

describe("resolveLocale", () => {
  it("picks userLocale when valid", () => {
    expect(
      resolveLocale({
        userLocale: "de-DE",
        shopLocale: "fr",
        shopifyLocale: "sv-SE",
      })
    ).toBe("de");
  });

  it("falls through to shopLocale when userLocale is invalid", () => {
    expect(
      resolveLocale({
        userLocale: "ja",
        shopLocale: "fr-FR",
        shopifyLocale: "sv-SE",
      })
    ).toBe("fr");
  });

  it("falls through to shopifyLocale when userLocale and shopLocale are invalid", () => {
    expect(
      resolveLocale({
        userLocale: null,
        shopLocale: undefined,
        shopifyLocale: "pt-BR",
      })
    ).toBe("pt");
  });

  it("defaults to en when nothing matches", () => {
    expect(
      resolveLocale({
        userLocale: "ja",
        shopLocale: "ko",
        shopifyLocale: "zh-CN",
      })
    ).toBe("en");
  });

  it("defaults to en when all inputs are nullish", () => {
    expect(resolveLocale({})).toBe("en");
  });
});

// ─── getLocaleDisplay ───────────────────────────────────────────

describe("getLocaleDisplay", () => {
  it("returns label, nativeName, and short for each locale", () => {
    expect(getLocaleDisplay("en")).toMatchObject({
      label: "English (US)",
      nativeName: "English",
      short: "EN",
    });
    expect(getLocaleDisplay("de")).toMatchObject({
      label: "German",
      nativeName: "Deutsch",
      short: "DE",
    });
    expect(getLocaleDisplay("pt")).toMatchObject({
      nativeName: "Português",
      short: "PT",
    });
  });
});

// ─── localeToLegacyCode (identity after consolidation) ─────────

describe("localeToLegacyCode", () => {
  it.each(LOCALE_LIST)("is identity for %s", (code) => {
    expect(localeToLegacyCode(code)).toBe(code);
  });
});

// ─── toBcp47 (boundary shim) ───────────────────────────────────

describe("toBcp47", () => {
  it.each([
    ["en", "en-US"],
    ["de", "de-DE"],
    ["es", "es-ES"],
    ["fr", "fr-FR"],
    ["pt", "pt-BR"],
    ["sv", "sv-SE"],
  ])("maps %s → %s", (short, bcp47) => {
    expect(toBcp47(short as Locale)).toBe(bcp47);
  });

  it("round-trip through normalizeLocale → toBcp47 → normalizeLocale is stable", () => {
    for (const code of LOCALE_LIST) {
      const bcp = toBcp47(code);
      expect(normalizeLocale(bcp)).toBe(code);
    }
  });
});

// ─── toBcp47Loose (untyped boundary) ────────────────────────────

describe("toBcp47Loose", () => {
  it.each([
    ["en", "en-US"],
    ["de", "de-DE"],
    ["es", "es-ES"],
    ["fr", "fr-FR"],
    ["pt", "pt-BR"],
    ["sv", "sv-SE"],
  ])("maps recognized short %s → BCP-47 %s", (input, expected) => {
    expect(toBcp47Loose(input)).toBe(expected);
  });

  it("falls back to en-US for unrecognized input", () => {
    expect(toBcp47Loose("ja")).toBe("en-US");
    expect(toBcp47Loose("en-US")).toBe("en-US"); // BCP-47 in is not a Locale; falls back
    expect(toBcp47Loose("")).toBe("en-US");
    expect(toBcp47Loose("garbage")).toBe("en-US");
  });
});

// ─── Polaris locale resolution ─────────────────────────────────

describe("getPolarisTranslations", () => {
  it.each(LOCALE_LIST)("loads Polaris translations for %s without throwing", async (code) => {
    const result = await getPolarisTranslations(code);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
  });
});

// ─── Resources Hub locale bidirectional map ────────────────────

describe("pathLocaleToHubLocale / hubLocaleToPathSegment", () => {
  it.each([
    ["en", "en-US"],
    ["de", "de-DE"],
    ["es", "es-ES"],
    ["fr", "fr-FR"],
    ["pt", "pt-BR"],
    ["sv", "sv-SE"],
  ])("path %s ↔ hub %s", (path, hub) => {
    expect(pathLocaleToHubLocale(path as Locale)).toBe(hub);
    expect(hubLocaleToPathSegment(hub as HubContentLocale)).toBe(path);
  });

  it("round-trips through both directions", () => {
    for (const code of LOCALE_LIST) {
      expect(hubLocaleToPathSegment(pathLocaleToHubLocale(code))).toBe(code);
    }
  });
});
