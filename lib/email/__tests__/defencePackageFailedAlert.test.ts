/**
 * The failed-package alert says what happens next, truthfully.
 * #104457 (2026-10-16): Shopify showed a response at 11:32; the 16:23 alert
 * still said "Shopify submits its own scrape at the deadline", three weeks out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendAdminEmail = vi.fn();
vi.mock("../adminEmail", () => ({ sendAdminEmail: (...a: unknown[]) => sendAdminEmail(...a) }));

import { sendDefencePackageFailedAlert } from "../sendDefencePackageFailedAlert";

const BASE = {
  shopDomain: "6a8848-dd.myshopify.com",
  orderName: "#104457",
  disputeId: "41ce9a75",
  packageId: "800b3853",
  version: 2,
  failureCode: "no_counsel_letter",
  failureReason: "No letter",
  dueAt: "2026-11-04T10:00:00+00:00",
};
const NOW = new Date("2026-10-16T16:23:21Z");
const sent = () => sendAdminEmail.mock.calls[0][0] as { subject: string; text: string; html: string };

describe("sendDefencePackageFailedAlert", () => {
  beforeEach(() => sendAdminEmail.mockReset());

  it("already responded: says a response was sent, never the deadline scrape", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, alreadyResponded: true }, NOW);
    const { subject, text, html } = sent();
    expect(subject).toContain("already responded");
    expect(text).toContain("A response was already sent through Shopify");
    expect(text).not.toMatch(/scrape at the deadline/);
    expect(html).not.toMatch(/scrape at the deadline/);
    expect(text).not.toMatch(/Shopify automatic response/i);
  });

  it("already responded beats the near-deadline urgency marker", async () => {
    await sendDefencePackageFailedAlert(
      { ...BASE, dueAt: "2026-10-17T10:00:00+00:00", alreadyResponded: true },
      NOW,
    );
    expect(sent().subject).not.toMatch(/due in/);
  });

  it("not yet responded: DisputeDesk files nothing, Shopify scrapes at the deadline unless a response is sent first", async () => {
    await sendDefencePackageFailedAlert({ ...BASE }, NOW);
    const { text } = sent();
    expect(text).toContain("DisputeDesk files nothing");
    expect(text).toContain("Unless a response is sent through Shopify first");
  });

  it("an earlier built version still wins when not responded", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, earlierBuiltVersion: 1 }, NOW);
    expect(sent().text).toContain("v1 was built earlier");
  });
});
