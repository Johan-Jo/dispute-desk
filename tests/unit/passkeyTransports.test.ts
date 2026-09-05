import { describe, it, expect } from "vitest";
import { filterTransports } from "@/lib/admin/passkeys";

/**
 * Regression guard for the double-prompt bug (2026-09-05): Chrome on Windows
 * reports Windows Hello credentials as ["hybrid","internal"]. Echoing `hybrid`
 * back in allowCredentials made Chrome open its cross-device / phone picker at
 * the same time as the Windows Hello dialog.
 */
describe("filterTransports", () => {
  it("drops hybrid so only the local authenticator prompt opens", () => {
    expect(filterTransports(["hybrid", "internal"])).toEqual(["internal"]);
  });

  it("keeps roaming-key transports that do not trigger the phone sheet", () => {
    expect(filterTransports(["usb", "nfc", "ble"])).toEqual(["usb", "nfc", "ble"]);
  });

  it("returns null when hybrid was the only transport", () => {
    // An empty array reads as 'no transport works' in some browsers — omit instead.
    expect(filterTransports(["hybrid"])).toBeNull();
  });

  it("passes null/undefined through as null", () => {
    expect(filterTransports(null)).toBeNull();
    expect(filterTransports(undefined)).toBeNull();
  });

  it("ignores unknown transport values", () => {
    expect(filterTransports(["internal", "smart-card"])).toEqual(["internal"]);
  });
});
