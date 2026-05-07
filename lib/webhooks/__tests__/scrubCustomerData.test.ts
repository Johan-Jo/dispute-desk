/**
 * Tests for `scrubCustomerData` — pure helper for `customers/redact`.
 *
 * Verifies:
 *   - Email match (case-insensitive, exact) → replaced with [redacted]
 *   - Name match (case-insensitive, exact whole-string) → replaced
 *   - Substring matches NOT replaced (avoid false positives)
 *   - Recursive walking through nested objects + arrays
 *   - Non-scrubbable keys preserved even when value matches
 *   - Empty target → input returned unchanged
 *   - Original input not mutated
 */

import { describe, it, expect } from "vitest";
import { scrubCustomerData } from "../scrubCustomerData";

describe("scrubCustomerData", () => {
  it("replaces email matches at scrubbable keys with [redacted]", () => {
    const input = {
      customer_email: "Alice@Example.COM",
      orderName: "#1234",
    };
    const out = scrubCustomerData(input, { email: "alice@example.com", name: null });
    expect(out.customer_email).toBe("[redacted]");
    expect(out.orderName).toBe("#1234");
  });

  it("replaces name matches at scrubbable keys with [redacted]", () => {
    const input = {
      customer_display_name: "Jane Smith",
      product_title: "Jane Smith Edition T-Shirt",
    };
    const out = scrubCustomerData(input, { email: null, name: "jane smith" });
    expect(out.customer_display_name).toBe("[redacted]");
    // product_title is not a scrubbable key — preserved even though
    // it contains the customer name as a substring.
    expect(out.product_title).toBe("Jane Smith Edition T-Shirt");
  });

  it("does NOT replace substring email matches (only exact whole-string)", () => {
    const input = {
      customer_email: "alice@example.com.attacker.com",
    };
    const out = scrubCustomerData(input, { email: "alice@example.com", name: null });
    expect(out.customer_email).toBe("alice@example.com.attacker.com");
  });

  it("walks arrays recursively", () => {
    const input = {
      sections: [
        { type: "order", data: { customerEmail: "alice@example.com" } },
        { type: "comms", data: { fromName: "alice@example.com" } }, // not a scrubbable key
      ],
    };
    const out = scrubCustomerData(input, { email: "alice@example.com", name: null });
    expect(out.sections[0].data.customerEmail).toBe("[redacted]");
    expect(out.sections[1].data.fromName).toBe("alice@example.com");
  });

  it("walks nested objects recursively", () => {
    const input = {
      pack: {
        billing: { email: "Bob@Example.com", city: "Austin" },
        shipping: { email: "different@example.com" },
      },
    };
    const out = scrubCustomerData(input, { email: "bob@example.com", name: null });
    expect(out.pack.billing.email).toBe("[redacted]");
    expect(out.pack.billing.city).toBe("Austin");
    expect(out.pack.shipping.email).toBe("different@example.com");
  });

  it("returns input unchanged when both email and name are null", () => {
    const input = { customer_email: "alice@example.com" };
    const out = scrubCustomerData(input, { email: null, name: null });
    expect(out).toBe(input); // reference equality — fast-path skipped
  });

  it("does not mutate the input object", () => {
    const input = {
      customer_email: "alice@example.com",
      sections: [{ data: { firstName: "Alice" } }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    scrubCustomerData(input, { email: "alice@example.com", name: "alice" });
    expect(input).toEqual(snapshot);
  });

  it("scrubs across all documented scrubbable keys", () => {
    const input = {
      email: "a@b.com",
      customerEmail: "a@b.com",
      customer_email: "a@b.com",
      billingEmail: "a@b.com",
      shippingEmail: "a@b.com",
      name: "Alice",
      customerName: "Alice",
      customer_name: "Alice",
      customerDisplayName: "Alice",
      customer_display_name: "Alice",
      fullName: "Alice",
      first_name: "Alice",
      last_name: "Alice",
      firstName: "Alice",
      lastName: "Alice",
    };
    const out = scrubCustomerData(input, { email: "a@b.com", name: "alice" }) as Record<string, string>;
    for (const [k, v] of Object.entries(out)) {
      expect(v, `key ${k} should be redacted`).toBe("[redacted]");
    }
  });

  it("preserves non-string values at scrubbable keys (defensive)", () => {
    const input = {
      email: 12345, // numeric — not a candidate for match anyway
      name: null,
    };
    const out = scrubCustomerData(input, { email: "12345", name: null });
    // valueMatches requires string; numeric value doesn't match.
    expect(out.email).toBe(12345);
  });
});
