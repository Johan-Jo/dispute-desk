/**
 * Shape tests for the PDF "Customer communication history" section.
 *
 * CommsSection is a plain function component over @react-pdf primitives;
 * calling it returns a React element tree we can walk for text content —
 * no PDF rendering needed. Pins: approved excerpts render (never full
 * bodies — the snapshot only carries excerpts), explanations + category
 * labels render, sender roles are distinguished, truncation is disclosed,
 * the legacy shape still renders, and emoji survive.
 */

import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { CommsSection } from "../EvidencePackDocument";

/** Recursively collect every string in the element tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.props) collectText(el.props.children, out);
  return out;
}

const enrichedData = {
  provider: "gorgias",
  enriched: true,
  conversations: [
    {
      ticketId: 42,
      subject: "Where is my order? 📦",
      channel: "email",
      matchConfidence: "high",
      messages: [
        {
          senderType: "customer",
          senderName: "Anna",
          sentAt: "2026-03-10T10:00:00Z",
          channel: "email",
          excerpt: "I got order #1066 yesterday 🎉",
          relevanceExplanation:
            "The customer confirms receiving the disputed order.",
          evidenceCategory: "delivery_recognition",
          contentTruncated: true,
        },
        {
          senderType: "merchant",
          sentAt: "2026-03-10T11:00:00Z",
          excerpt: "Glad to hear it — enjoy!",
          relevanceExplanation: null,
          evidenceCategory: null,
          contentTruncated: false,
        },
      ],
    },
  ],
};

describe("CommsSection — enriched (approved snapshot)", () => {
  it("renders excerpts, explanation, category, sender roles, truncation note", () => {
    const text = collectText(CommsSection({ data: enrichedData })).join("\n");
    expect(text).toContain("Customer Communication History");
    expect(text).toContain("I got order #1066 yesterday 🎉"); // emoji-safe
    expect(text).toContain("The customer confirms receiving the disputed order.");
    expect(text).toContain("delivery recognition"); // category label
    expect(text).toContain("Customer");
    expect(text).toContain("Merchant");
    expect(text).toContain("excerpt of a longer message"); // truncation disclosed
    expect(text).toContain("Where is my order? 📦");
  });

  it("returns null with no conversations", () => {
    expect(
      CommsSection({ data: { enriched: true, conversations: [] } }),
    ).toBeNull();
  });
});

describe("CommsSection — legacy shape", () => {
  it("renders plain messages without categories", () => {
    const text = collectText(
      CommsSection({
        data: {
          provider: "gorgias",
          enriched: false,
          conversations: [
            {
              ticketId: 7,
              channel: "chat",
              messages: [
                {
                  fromAgent: false,
                  text: "hello from the customer",
                  sentAt: "2026-03-01T00:00:00Z",
                },
              ],
            },
          ],
        },
      }),
    ).join("\n");
    expect(text).toContain("hello from the customer");
    expect(text).toContain("Customer");
  });
});
