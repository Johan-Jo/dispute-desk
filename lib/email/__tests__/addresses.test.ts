/**
 * Pins the canonical email addresses, and the invariant that no sender
 * re-declares them.
 *
 * Before `lib/email/addresses.ts` the same two literals were duplicated across
 * seventeen senders. Reply-To therefore stayed on `notifications@mail.…`, an
 * unmonitored sending mailbox, while several emails invited a reply in their
 * copy ("just reply to this email — it reaches a person"). Centralizing it is
 * what makes that promise true; this test stops the duplication returning.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

const EMAIL_DIR = join(__dirname, "..");

describe("canonical email addresses", () => {
  it("replies go to the monitored support inbox, not the sending mailbox", () => {
    expect(DEFAULT_REPLY_TO).toContain("support@disputedesk.app");
    expect(DEFAULT_REPLY_TO).not.toContain("notifications@");
  });

  it("sends from the verified Resend subdomain", () => {
    expect(DEFAULT_FROM_EMAIL).toContain("notifications@mail.disputedesk.app");
  });

  it("never uses a no-reply address (hurts deliverability)", () => {
    expect(DEFAULT_REPLY_TO.toLowerCase()).not.toContain("no-reply");
    expect(DEFAULT_REPLY_TO.toLowerCase()).not.toContain("noreply");
  });

  it("no sender re-declares the address literals", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(EMAIL_DIR)) {
      if (!file.endsWith(".ts") || file === "addresses.ts") continue;
      const src = readFileSync(join(EMAIL_DIR, file), "utf8");
      // A sender must not hardcode the sending address or read the env vars
      // directly — both routes bypass the single source of truth.
      if (
        src.includes("notifications@mail.disputedesk.app") ||
        src.includes("process.env.EMAIL_REPLY_TO") ||
        src.includes("process.env.EMAIL_FROM")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
