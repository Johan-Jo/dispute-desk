import { describe, expect, it } from "vitest";
import {
  mapActionTypeToOtpType,
  parseConfirmParamsFromRedirectTo,
} from "../confirmEmailLink";

describe("parseConfirmParamsFromRedirectTo", () => {
  it("defaults when empty", () => {
    expect(parseConfirmParamsFromRedirectTo("")).toEqual({
      redirectPath: "/portal/dashboard",
      localeParam: null,
    });
  });

  it("extracts redirect and locale from nested confirm URL", () => {
    const u =
      "https://disputedesk.app/api/auth/confirm?type=magiclink&redirect=/portal/settings&locale=pt-BR";
    expect(parseConfirmParamsFromRedirectTo(u)).toEqual({
      redirectPath: "/portal/settings",
      localeParam: "pt-BR",
    });
  });

  it("uses pathname for direct reset-password URL", () => {
    const u = "https://disputedesk.app/auth/reset-password";
    expect(parseConfirmParamsFromRedirectTo(u)).toEqual({
      redirectPath: "/auth/reset-password",
      localeParam: null,
    });
  });

  it("maps signup nested confirm", () => {
    const u =
      "https://disputedesk.app/api/auth/confirm?redirect=/portal/dashboard&type=signup";
    expect(parseConfirmParamsFromRedirectTo(u)).toEqual({
      redirectPath: "/portal/dashboard",
      localeParam: null,
    });
  });
});

describe("mapActionTypeToOtpType", () => {
  it("maps email change variants", () => {
    expect(mapActionTypeToOtpType("email_change_new")).toBe("email_change");
    expect(mapActionTypeToOtpType("email_change_current")).toBe("email_change");
  });

  it("returns null for unknown", () => {
    expect(mapActionTypeToOtpType("unknown")).toBeNull();
  });
});
