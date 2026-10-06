import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Visa's Dispute Monitoring Program (VDMP) was replaced by VAMP on 2025-04-01.
 * The lead-facing quiz and its email must never present it as current. Scans the
 * raw source with whitespace collapsed, because JSX copy wraps across lines
 * ("…published Dispute\n Monitoring Program" slipped past a single-line grep).
 */
const FILES = ["components/marketing/WinnabilityTest.tsx", "lib/marketing/winnability/resultEmail.ts"];

describe("winnability quiz copy", () => {
  for (const f of FILES) {
    it(`${f} does not name the retired Dispute Monitoring Program`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), "utf8").replace(/\s+/g, " ");
      expect(src).not.toMatch(/Dispute Monitoring/i);
      expect(src).not.toMatch(/\bVDMP\b/);
    });
  }
});
